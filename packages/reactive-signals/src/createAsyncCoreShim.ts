/**
 * `createAsyncCoreShim` — builds the synchronous `FilterEngine<T>` shim that
 * `createSignalsEngineFromAsync` exposes as its `.core` property.
 *
 * @remarks
 * `SignalsEngine<T>.core` is typed as `FilterEngine<T>` — a SYNC engine — but the underlying
 * engine on a worker-backed adapter is async. This module constructs the shim that bridges the
 * two:
 *
 *   - Sync getters (`getSourceData`, `getRules`, `getResults`, …) read from the adapter's local
 *     mirror signals — sub-microsecond cost.
 *   - Sync mutations (`addRule`, `removeRule`, `clearRules`, …) dispatch to the async engine
 *     fire-and-forget; the change event flows back via the adapter's subscribe loop and updates
 *     the local mirror.
 *   - The `devtools` surface is mirrored locally (action log + cursor) so reads are synchronous;
 *     time-travel mutations fire-and-forget across the postMessage boundary.
 *   - Members with no main-thread mirror throw `MODE_WORKER_UNSUPPORTED` (through worker-bridge's
 *     shared `unsupportedOnWorker`), naming the async call that answers instead where there is
 *     one: the advanced facilities (`dispatcher`, `bitmapIndex`, `exclusionGraph`,
 *     `simulationCache`), and the synchronous queries `applyFiltersAndQuery`, `computeResults`,
 *     `getResultIndices`, `getFilteredFieldValuesExcept`, `precomputeExclusions`, `simulate`,
 *     `snapshot` and `exportConfig`. Every public member of `FilterEngine` is present — the shim is
 *     typed against the engine's public surface, so a new engine member fails the build here until
 *     the shim answers it.
 *   - The `store` surface returns a minimal last-change mirror shim; any other store access
 *     throws.
 *   - **Similarity and suggestions are not shimmed here.** Both live in opt-in subpaths rather
 *     than on `FilterEngine`, so there is no property to guard. `attachSuggestions(core)` works
 *     against this shim — the trio needs nothing from the engine, so a main-thread trio over a
 *     worker-backed engine is correct rather than a loophole. `attachSimilarity(core)` still
 *     fails, but through the `store` guard below rather than a bespoke one, because it reads
 *     `store.sourceData`.
 *
 * The factory takes a context of the adapter's signals + the async engine + a `getIsDisposed`
 * accessor + the two refresh helpers it needs for time-travel.
 *
 * @packageDocumentation
 */

import {
	type ChangeEvent,
	type CompositeRule,
	type FilterEngine,
	type FilterEngineConfig,
	type FilterGroup,
	type FilterRule,
	type RuleId,
	type Unsubscribe,
} from '@filter-enginez/core';
import {
	createAsyncDevtoolsShim,
	type FilterEngineAsync,
	unsupportedOnWorker,
	type WireActionLogEntry,
	type WireDevtoolsState,
} from '@filter-enginez/worker-bridge';
import { batch, computed, type ReadonlySignal, type Signal } from '@preact/signals-core';

/**
 * The adapter-owned state + collaborators the core shim reads from and writes through.
 *
 * @typeParam T - The item type the underlying engine operates over
 */
export interface AsyncCoreShimContext<T> {
	/** The worker-hosted engine the shim dispatches mutations to. */
	readonly asyncEngine: FilterEngineAsync<T>;
	/** Live read of the adapter's `isDisposed` flag (routed through an accessor to defeat narrowing). */
	readonly getIsDisposed: () => boolean;
	/** Re-pull every mirror from the worker — used by time-travel. */
	readonly refreshEverything: () => Promise<void>;
	/** Re-pull the devtools action log + cursor mirrors. */
	readonly refreshDevtools: () => Promise<void>;
	// ─── Mirror signals (read sync; written by the adapter's subscribe loop) ───
	readonly actionLogSignal: ReadonlySignal<readonly WireActionLogEntry[]>;
	readonly activeRuleIdsSignal: ReadonlySignal<readonly RuleId[]>;
	readonly activeRulesSignal: ReadonlySignal<ReadonlyMap<RuleId, FilterRule>>;
	readonly devtoolsStateSignal: Signal<WireDevtoolsState>;
	readonly expressionSignal: ReadonlySignal<CompositeRule | null>;
	readonly groupsSignal: ReadonlySignal<readonly FilterGroup[]>;
	readonly lastChangeEventSignal: Signal<ChangeEvent | null>;
	readonly lastChangeRuleIdSignal: Signal<RuleId | null>;
	readonly lastChangeTimestampSignal: Signal<number | null>;
	readonly resultCountSignal: ReadonlySignal<number>;
	readonly resultsSignal: ReadonlySignal<readonly T[]>;
	readonly sourceDataSignal: ReadonlySignal<readonly T[]>;
}

/**
 * Build the synchronous `FilterEngine<T>` `.core` shim for a worker-backed signals adapter.
 *
 * @typeParam T - The item type the underlying engine operates over
 * @param ctx - The adapter's signals + async engine + helpers
 * @returns A `FilterEngine<T>` whose sync surface bridges to the async worker engine
 */
export function createAsyncCoreShim<T>(ctx: AsyncCoreShimContext<T>): FilterEngine<T> {
	const {
		actionLogSignal,
		activeRuleIdsSignal,
		activeRulesSignal,
		asyncEngine,
		devtoolsStateSignal,
		expressionSignal,
		getIsDisposed,
		groupsSignal,
		lastChangeEventSignal,
		lastChangeRuleIdSignal,
		lastChangeTimestampSignal,
		refreshDevtools,
		refreshEverything,
		resultCountSignal,
		resultsSignal,
		sourceDataSignal,
	} = ctx;

	// ─── The `.core` sync FilterEngine shim ───────────────────────────────
	// Implements the methods consumers call synchronously from React render. Members with no
	// main-thread mirror throw with a pointer to the async surface.
	const unsupported = (member: string, ...instead: readonly string[]): never =>
		unsupportedOnWorker('createSignalsEngineFromAsync', member, ...instead);
	// Set by `destroy()`, read by `isDestroyed`: the shim reports its own teardown synchronously, the
	// way the core does, without a round trip to ask the worker.
	let isDestroyed = false;

	// **Time-travel refresh helper** — used by the devtools shim's undo/redo/jumpTo.
	// Refreshes every mirror in parallel + bumps `lastChange` so consumers using
	// `useLastChange` re-render with the restored state. See the shim methods for the full
	// rationale.
	const bumpAfterTimeTravel = async (): Promise<void> => {
		await Promise.all([refreshEverything(), refreshDevtools()]);
		if (getIsDisposed()) {
			return;
		}
		batch(() => {
			lastChangeTimestampSignal.value = Date.now();
			lastChangeEventSignal.value = { type: 'reset' };
		});
	};

	// ─── Devtools shim — see the `get devtools()` getter on coreShim below ────
	//
	// The surface itself lives in `@filter-enginez/worker-bridge`'s `createAsyncDevtoolsShim`,
	// shared with `reactive-rxjs`; this adapter supplies the four collaborators it needs. Reads
	// come straight off the mirror signals (synchronous from a React render's POV — React
	// re-renders when consumers subscribe via `useSyncExternalStore`); the mutation methods
	// fire-and-forget to the worker and land via the next engine event → `refreshDevtools()` →
	// signal update.
	//
	// **`applyOptimisticCursor` is why this is not two setters.** All three time-travel mutators
	// write the cursor AND `lastChangeTimestamp`, and the `batch()` here is what makes a
	// `useLastChange` consumer re-render ONCE with the new cursor already visible. `batch` is
	// `@preact/signals-core`'s and cannot cross into `worker-bridge`, so the boundary sits one
	// level up: the shared module decides WHAT the next cursor is, this adapter decides HOW the
	// pair is applied. Two separate setters would land the cursor and the tick in different
	// frames and flicker the panel's row tint on exactly the tier slow enough to see it.
	const devtoolsShim = createAsyncDevtoolsShim<T>({
		adapterName: 'createSignalsEngineFromAsync',
		applyOptimisticCursor: (next: WireDevtoolsState): void => {
			batch(() => {
				devtoolsStateSignal.value = next;
				lastChangeTimestampSignal.value = Date.now();
			});
		},
		asyncEngine,
		getActionLog: () => actionLogSignal.value,
		getDevtoolsState: () => devtoolsStateSignal.value,
		// `void`ed rather than passed directly: `onTimeTravelSettled` is declared `() => void`
		// because the shared shim never awaits it — the settle is fire-and-forget, exactly as the
		// `void asyncEngine.jumpToDevtoolsIndex(...)` above it is. Handing an async function to a
		// void-returning slot would drop the promise implicitly, which is what
		// `no-misused-promises` exists to catch; dropping it explicitly says the same thing out
		// loud. Rejections are impossible here — `bumpAfterTimeTravel` awaits refreshers that
		// resolve or throw synchronously into the adapter's own error path.
		onTimeTravelSettled: (): void => {
			void bumpAfterTimeTravel();
		},
	});

	// ─── Minimal `.store` shim (belt-and-suspenders) ───────────────────────
	// `@filter-enginez/redux-bridge`'s `attachEngineToStore` does not read `engine.store`
	// (it derives last-change from the `ChangeEvent` stream), so the bridge works against this
	// worker-backed core regardless. This shim is the second belt: ANY consumer reaching for
	// `engine.core.store.lastChangeRuleId` / `.lastChangeTimestamp` gets the live local mirror
	// signals instead of a throw. The rest of the
	// internal store surface (the writable result/source signals, the dispatcher, the bitmap
	// index, etc.) has no postMessage-safe main-thread mirror, so accessing it still throws a
	// clear, actionable error rather than silently returning `undefined`.
	const storeShim = new Proxy(
		{
			lastChangeRuleId: lastChangeRuleIdSignal,
			lastChangeTimestamp: lastChangeTimestampSignal,
		},
		{
			get(target, prop, receiver): unknown {
				// Pass symbols (Symbol.toPrimitive, Symbol.iterator, inspection hooks) and the two
				// mirrored keys straight through; throw a clear error for any other named access.
				if (typeof prop === 'symbol' || prop in target) {
					return Reflect.get(target, prop, receiver);
				}

				return unsupported(`store.${String(prop)}`);
			},
		},
	) as unknown as FilterEngine<T>['store'];

	const coreShim: PublicSurface<FilterEngine<T>> = {
		addGroup: (group: FilterGroup) => {
			void asyncEngine.addGroup(group);
		},
		addRule: (ruleId: RuleId, rule: FilterRule) => {
			// Serialize the rule before crossing the postMessage boundary — instances hold
			// function fields (`action`, custom matchers) that aren't structuredClone-safe.
			// The worker-side `addRule` deserializes via `ruleRegistry.deserialize` before
			// handing the rule to the actual engine. The typed `FilterEngineAsync.addRule`
			// nominally expects a `FilterRule`, but the wire boundary actually carries the
			// `SerializedRule` shape; cast through `unknown` to bridge the serialization seam
			// (the same convention worker-bridge's own wire layer uses).
			void asyncEngine.addRule(ruleId, rule.serialize() as unknown as FilterRule);
		},
		applyFiltersAndQuery: () =>
			unsupported('applyFiltersAndQuery()', 'engine.asyncEngine.applyFiltersAndQuery(query)'),
		get bitmapIndex() {
			return unsupported('bitmapIndex');
		},
		clearRules: () => {
			void asyncEngine.clearRules();
		},
		computeResults: () => unsupported('computeResults()', 'engine.asyncEngine.getResultIndices()'),
		destroy: async () => {
			isDestroyed = true;
			await asyncEngine.destroy();
		},
		// **Devtools shim** — bridges the synchronous `engine.core.devtools` interface that
		// consumers use against the underlying async worker. The action log + cursor state
		// are mirrored locally (refreshed via `refreshDevtools()` after every engine event)
		// so reads are synchronous; mutations (jumpTo / undo / redo) fire-and-forget across
		// the postMessage boundary, with confirmations flowing back through the subscribe
		// channel that triggers the next mirror refresh.
		//
		// Gives worker-backed consumers a working devtools surface without forcing every call
		// site to branch on backend type.
		get devtools() {
			// `AsyncDevtoolsShim` describes what the main thread can serve; core's `Devtools` is a class
			// whose members without a main-thread mirror the shim does not implement, hence the cast here.
			return devtoolsShim as unknown as FilterEngine<T>['devtools'];
		},
		get dispatcher() {
			return unsupported('dispatcher');
		},
		get exclusionGraph() {
			return unsupported('exclusionGraph');
		},
		exportConfig: () => unsupported('exportConfig()', 'engine.asyncEngine.exportConfig()'),
		getActiveRuleIds: () => activeRuleIdsSignal.value,
		getExpression: () => expressionSignal.value,
		getFilteredFieldValuesExcept: () => unsupported(
			'getFilteredFieldValuesExcept()',
			'engine.asyncEngine.getFilteredFieldValuesExcept(ruleId, fieldKey)',
		),
		getGroups: () => groupsSignal.value,
		getResultCount: () => resultCountSignal.value,
		getResultIndices: () => unsupported('getResultIndices()', 'engine.asyncEngine.getResultIndices()'),
		getResults: () => resultsSignal.value,
		getRule: (ruleId: RuleId) => activeRulesSignal.value.get(ruleId),
		getRules: () => activeRulesSignal.value,
		getSourceData: () => sourceDataSignal.value,
		get isDestroyed() {
			return isDestroyed;
		},

		// ─── JSON config ────────────────────────────────────────────────────
		loadConfig: (config: FilterEngineConfig) => {
			void asyncEngine.loadConfig(config);
		},

		// A warm-up hint for the synchronous exclusion path, which runs in the worker here.
		precomputeExclusions: () => unsupported('precomputeExclusions()'),

		removeGroup: (groupId: string) => {
			void asyncEngine.removeGroup(groupId);
		},

		removeRule: (ruleId: RuleId) => {
			void asyncEngine.removeRule(ruleId);
		},
		reset: () => {
			void asyncEngine.reset();
		},

		resetWorkingSet: () => {
			void asyncEngine.resetWorkingSet();
		},

		setExpression: (expr: CompositeRule | null) => {
			// Same serialization rationale as `addRule` — CompositeRule's nested children
			// include FilterRule instances that don't cross structuredClone cleanly. Cast
			// through `unknown` at the wire boundary (the serialized payload reconstructs into
			// a CompositeRule worker-side via `ruleRegistry.deserialize`).
			void asyncEngine.setExpression(
				expr === null ? null : (expr.serialize() as unknown as CompositeRule),
			);
		},

		// ─── Sync getters from local mirror signals ────────────────────────
		setSourceData: (items: readonly T[]) => {
			void asyncEngine.setSourceData(items);
		},

		setWorkingSet: (items: readonly T[]) => {
			void asyncEngine.setWorkingSet(items);
		},
		// ─── Simulate — unsupported on the sync surface ─────────────────────
		// A sync result would have to hide the async worker call behind a placeholder, so the
		// shim does not serve `simulate()`. Chip exclusion data ships in `applyFiltersAndQuery`'s
		// response — consumers read it from the bundle rather than calling
		// `engine.core.simulate()` per candidate.
		// Direct callers needing one-off simulations on a worker-backed engine should call
		// `engine.asyncEngine.simulate(...)` and await the Promise themselves.
		simulate: () => unsupported(
			'simulate()',
			'engine.asyncEngine.simulate(modification)',
			'engine.asyncEngine.applyFiltersAndQuery({ chipGroups })',
		),
		get simulationCache() {
			return unsupported('simulationCache');
		},
		snapshot: () => unsupported('snapshot()'),
		// ─── Advanced facilities — unsupported on async-backed engines ──────
		// `store` returns the minimal last-change mirror shim (see `storeShim` above) rather than
		// throwing wholesale; `dispatcher` and the rest stay unsupported.
		get store() {
			return storeShim;
		},
		// `subscribe` on the shim wraps a local listener around the same events the adapter
		// itself receives. The adapter is the single subscriber on the underlying async
		// engine; consumer subscribers fan out from the local lastChangeEvent signal.
		subscribe: (listener: (event: ChangeEvent) => void): Unsubscribe => {
			const local = computed(() => lastChangeEventSignal.value);
			const teardown = local.subscribe((evt) => {
				if (evt !== null) {
					listener(evt);
				}
			});

			return teardown;
		},
	};

	// `PublicSurface` checks every public member is present; the cast is only for the class's private
	// members, which no object literal can supply and no caller can reach.
	return coreShim as unknown as FilterEngine<T>;
}

/**
 * A class type's public members as a plain object type.
 *
 * @remarks
 * `keyof` sees only public members, so an object literal typed with this must supply every one of
 * them — which a direct `FilterEngine<T>` annotation cannot check, since the class's private
 * members make it unimplementable by a literal at all.
 *
 * @typeParam Engine - The class type.
 */
type PublicSurface<Engine> = {[Member in keyof Engine]: Engine[Member] };
