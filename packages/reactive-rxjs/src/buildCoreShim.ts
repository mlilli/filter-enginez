/**
 * `buildCoreShim` — constructs the sync `FilterEngine<T>` shim that `createRxJsEngineFromAsync`
 * exposes as `engine.core`, backed by local `BehaviorSubject` mirror state and fire-and-forget
 * dispatch to the worker-hosted async engine.
 *
 * @remarks
 The shim closes over the adapter's mirror subjects and the async engine; reads come from the
 * mirror subjects and mutations dispatch fire-and-forget to the worker-hosted async engine.
 *
 * **Members with no main-thread mirror throw `MODE_WORKER_UNSUPPORTED`** through worker-bridge's
 * shared `unsupportedOnWorker`, naming the async call that answers instead where there is one:
 * `simulate`, `applyFiltersAndQuery`, `computeResults`, `getResultIndices`,
 * `getFilteredFieldValuesExcept`, `precomputeExclusions`, `snapshot`, `exportConfig` and the
 * advanced facilities. Chip-exclusion data ships in `applyFiltersAndQuery`'s bundled response (one
 * worker round trip per filter action), so there is no per-candidate `simulate()` fan-out. The
 * shim is typed against the engine's public surface, so a new engine member fails the build here
 * until the shim answers it — the same contract as the signals shim (`createAsyncCoreShim`).
 *
 * @packageDocumentation
 */

import type { BehaviorSubject, Subject } from 'rxjs';

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

/**
 * Dependency bag for {@link buildCoreShim}. Carries the adapter's mirror subjects + the async
 * engine the shim's mutations dispatch to.
 *
 * @typeParam T - The item type the underlying engine operates over
 */
export interface CoreShimDeps<T> {
	readonly activeRuleIdsSubject: BehaviorSubject<readonly RuleId[]>;
	readonly activeRulesSubject: BehaviorSubject<ReadonlyMap<RuleId, FilterRule>>;
	/** Write the optimistic devtools cursor + the last-change tick together. */
	readonly applyOptimisticCursor: (next: WireDevtoolsState) => void;
	readonly asyncEngine: FilterEngineAsync<T>;
	readonly eventsSubject: Subject<ChangeEvent>;
	readonly expressionSubject: BehaviorSubject<CompositeRule | null>;
	/** Live read of the adapter's action-log mirror. */
	readonly getActionLog: () => readonly WireActionLogEntry[];
	/** Live read of the adapter's devtools-cursor mirror. */
	readonly getDevtoolsState: () => WireDevtoolsState;
	readonly groupsSubject: BehaviorSubject<readonly FilterGroup[]>;
	/** Reconcile every mirror once a time-travel round trip confirms. */
	readonly onTimeTravelSettled: () => void;
	readonly resultCountSubject: BehaviorSubject<number>;
	readonly resultsSubject: BehaviorSubject<readonly T[]>;
	readonly sourceDataSubject: BehaviorSubject<readonly T[]>;
}

/**
 * Build the `engine.core` sync `FilterEngine<T>` shim for `createRxJsEngineFromAsync`.
 *
 * @typeParam T - The item type the underlying engine operates over
 * @param deps - The adapter's mirror subjects, devtools collaborators, and live-scalar getters
 * @returns A `FilterEngine<T>` whose reads come from the mirror subjects and whose mutations
 *   dispatch fire-and-forget to the worker-hosted async engine
 */
export function buildCoreShim<T>(deps: CoreShimDeps<T>): FilterEngine<T> {
	const {
		activeRuleIdsSubject,
		activeRulesSubject,
		applyOptimisticCursor,
		asyncEngine,
		eventsSubject,
		expressionSubject,
		getActionLog,
		getDevtoolsState,
		groupsSubject,
		onTimeTravelSettled,
		resultCountSubject,
		resultsSubject,
		sourceDataSubject,
	} = deps;

	// The devtools surface is SHARED with the signals adapter — see
	// `@filter-enginez/worker-bridge`'s `createAsyncDevtoolsShim`. `get devtools()` must not throw:
	// a consumer that reads `engine.core.devtools` in a FIELD INITIALIZER (as Angular's
	// `<fe-time-travel-controls>` does) has no seam to catch it, so a throw would fail the whole
	// view at construction rather than degrading.
	const devtoolsShim = createAsyncDevtoolsShim<T>({
		adapterName: 'createRxJsEngineFromAsync',
		applyOptimisticCursor,
		asyncEngine,
		getActionLog,
		getDevtoolsState,
		onTimeTravelSettled,
	});

	const unsupported = (member: string, ...instead: readonly string[]): never =>
		unsupportedOnWorker('createRxJsEngineFromAsync', member, ...instead);
	// Set by `destroy()`, read by `isDestroyed`: the shim reports its own teardown synchronously, the
	// way the core does, without a round trip to ask the worker.
	let isDestroyed = false;

	const coreShim: PublicSurface<FilterEngine<T>> = {
		addGroup: (group: FilterGroup) => {
			void asyncEngine.addGroup(group);
		},
		addRule: (ruleId: RuleId, rule: FilterRule) => {
			// `FilterEngineAsync.addRule` is declared to take a `FilterRule`, but rule instances
			// aren't structuredClone-safe across the postMessage boundary — the worker host
			// expects the serialized JSON form and reconstructs via `ruleRegistry.deserialize`.
			// Cast the `SerializedRule` to the declared `FilterRule` param (the documented
			// internal wire-format-vs-declared-type mismatch) rather than going through `any`.
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
		get devtools() {
			// Cast at the property rather than over the whole shim: `AsyncDevtoolsShim` is an
			// honest description of what the main thread can actually serve, and core's `Devtools`
			// is a class type whose not-mirrored members this deliberately does not implement (they
			// throw). Narrowing the cast to this one getter keeps every other member of `coreShim`
			// type-checked against `FilterEngine<T>`'s public surface.
			return devtoolsShim as unknown as FilterEngine<T>['devtools'];
		},
		get dispatcher() {
			return unsupported('dispatcher');
		},
		get exclusionGraph() {
			return unsupported('exclusionGraph');
		},
		exportConfig: () => unsupported('exportConfig()', 'engine.asyncEngine.exportConfig()'),
		getActiveRuleIds: () => activeRuleIdsSubject.value,
		getExpression: () => expressionSubject.value,
		getFilteredFieldValuesExcept: () => unsupported(
			'getFilteredFieldValuesExcept()',
			'engine.asyncEngine.getFilteredFieldValuesExcept(ruleId, fieldKey)',
		),
		getGroups: () => groupsSubject.value,
		getResultCount: () => resultCountSubject.value,
		getResultIndices: () => unsupported('getResultIndices()', 'engine.asyncEngine.getResultIndices()'),
		getResults: () => resultsSubject.value,
		getRule: (ruleId: RuleId) => activeRulesSubject.value.get(ruleId),
		getRules: () => activeRulesSubject.value,
		getSourceData: () => sourceDataSubject.value,
		get isDestroyed() {
			return isDestroyed;
		},
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
			// Same wire-format mismatch as `addRule`: the expression tree crosses the boundary as
			// serialized JSON (the worker host reconstructs it), but the declared param is
			// `CompositeRule | null`. Cast the `SerializedRule` to the declared type rather than
			// using `any`.
			void asyncEngine.setExpression(
				expr === null ? null : (expr.serialize() as unknown as CompositeRule),
			);
		},
		setSourceData: (items: readonly T[]) => {
			void asyncEngine.setSourceData(items);
		},
		setWorkingSet: (items: readonly T[]) => {
			void asyncEngine.setWorkingSet(items);
		},
		// ─── Simulate — unsupported on the worker-backed shim ───────────────
		// A sync result would have to hide the async worker call behind a placeholder, so the shim
		// does not serve `simulate()`. Chip exclusion data ships in `applyFiltersAndQuery`'s
		// response — consumers read it from the bundle rather than fanning out per-candidate
		// `simulate()` calls.
		simulate: () => unsupported(
			'simulate()',
			'engine.asyncEngine.simulate(modification)',
			'engine.asyncEngine.applyFiltersAndQuery({ chipGroups })',
		),
		get simulationCache() {
			return unsupported('simulationCache');
		},
		snapshot: () => unsupported('snapshot()'),
		get store() {
			return unsupported('store');
		},
		subscribe: (listener: (event: ChangeEvent) => void): Unsubscribe => {
			const sub = eventsSubject.subscribe((evt) => listener(evt));

			return () => sub.unsubscribe();
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
