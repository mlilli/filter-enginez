/**
 * `createSignalsEngineFromAsync` — the adapter that wraps a `FilterEngineAsync<T>` (a
 * worker-hosted engine produced by `@filter-enginez/worker-bridge`'s `wrapInWorker(...)`)
 * in a `SignalsEngine<T>` reactive facade, so consumer code written against the sync
 * engine works unchanged when the engine moves into a Web Worker.
 *
 * @remarks
 * Per `docs/architecture.md` §15. The async-twin of `createSignalsEngine`.
 * Same return-type contract (`SignalsEngine<T>`); the underlying engine round-trips every
 * call through a Comlink postMessage boundary rather than executing in-process.
 *
 * **Why this exists.** The reactive surface and React hooks (`useFilterEngine`, `useResults`,
 * `useExclusion`, etc.) are written against `SignalsEngine<T>`. If a consumer chooses to host
 * the engine in a Web Worker for performance (chosen by `bootSignalsEngine` when the dataset
 * exceeds its size threshold), they should be able to swap one factory
 * call without rewriting any of their hook usage or component code. This adapter is what
 * makes that drop-in possible.
 *
 * **The `core` problem.** `SignalsEngine<T>.core` is typed as `FilterEngine<T>` — a SYNC
 * engine. The actual underlying engine here is async. The adapter solves this by exposing
 * a sync FilterEngine SHIM:
 *
 *   - Sync getters (`getSourceData`, `getRules`, `getResults`, etc.) read from local mirror
 *     state populated via the subscribe loop — sub-microsecond cost.
 *   - Sync mutations (`addRule`, `removeRule`, `clearRules`, etc.) dispatch to the async
 *     engine fire-and-forget; the change event flows back via subscribe and updates the
 *     local mirror.
 *   - `simulate(...)` is not served by the sync shim — callers use
 *     `engine.asyncEngine.simulate(...)`, or read bundled chip exclusion data from
 *     `applyFiltersAndQuery`.
 *   - The `devtools` surface is mirrored locally; `store` exposes only a last-change mirror.
 *   - Advanced facilities (`dispatcher`, `bitmapIndex`, `exclusionGraph`, `simulationCache`)
 *     throw a clear error if accessed — they have no postMessage-safe surface. The suggestion
 *     trio is not on `FilterEngine` at all (it ships from `@filter-enginez/core/suggestions`),
 *     and `attachSuggestions(engine.core)` works here because the trio reads nothing from the
 *     engine.
 *
 * See `createAsyncCoreShim.ts` for the shim itself.
 *
 * **Initial seeding.** The factory is async — `await createSignalsEngineFromAsync(asyncEngine)`
 * resolves once the initial state has been pulled from the worker (one parallel batch of
 * getters). After that, the subscribe loop keeps mirror state current. This matches the
 * shape of `wrapInWorker` itself, which is also async.
 *
 * @packageDocumentation
 */

import type {
	ChangeEvent,
	CompositeRule,
	FilterGroup,
	FilterRule,
	RuleId,
	Unsubscribe,
} from '@filter-enginez/core';

import {
	proxy as comlinkProxy,
	type FilterEngineAsync,
	type WireActionLogEntry,
	type WireDevtoolsState,
} from '@filter-enginez/worker-bridge';
import { batch, computed, type ReadonlySignal, signal } from '@preact/signals-core';

import type { SignalsEngine } from './SignalsEngine.js';

import { createAsyncCoreShim } from './createAsyncCoreShim.js';
import { createAsyncMirrorRefreshers } from './createAsyncMirrorRefreshers.js';

/**
 * Options for `createSignalsEngineFromAsync`.
 */
export interface CreateSignalsEngineFromAsyncOptions {
	/**
	 * If `true`, the adapter eagerly creates per-rule signals for every currently-registered
	 * rule on construction (and on every `rule:added` event). Default `false` — per-rule
	 * signals are lazily created on first `engine.rule(id)` call. Matches `createSignalsEngine`'s
	 * shape so consumers can swap factories without changing options.
	 */
	readonly eagerPerRuleSignals?: boolean;

	/**
	 * Accepted for options-shape compatibility; the value is ignored.
	 *
	 * **No-op.** This adapter keeps no simulate cache: chip exclusion data arrives in
	 * `applyFiltersAndQuery`'s bundled response, and one-off simulations go through
	 * `engine.asyncEngine.simulate(...)`.
	 */
	readonly simulateCacheMax?: number;
}

/**
 * Wrap a `FilterEngineAsync<T>` (typically from `wrapInWorker(...)`) in a `SignalsEngine<T>`
 * reactive facade. Resolves once initial state has been pulled from the worker.
 *
 * @typeParam T - The item type the underlying engine operates over
 * @param asyncEngine - The worker-hosted engine to adapt (from `@filter-enginez/worker-bridge`)
 * @param options - Optional adapter configuration
 * @returns A `SignalsEngine<T>` whose surface matches `createSignalsEngine(coreEngine)`
 *   — drop-in for any consumer already coded against the sync version.
 *
 * @example
 *   import { wrapInWorker } from '@filter-enginez/worker-bridge';
 *   import { createSignalsEngineFromAsync } from '@filter-enginez/reactive-signals';
 *
 *   const asyncEngine = await wrapInWorker<Wine>({
 *     worker: new Worker(new URL('./wine.worker.ts', import.meta.url), { type: 'module' }),
 *     factoryName: 'wineEngine',
 *   });
 *   const engine = await createSignalsEngineFromAsync(asyncEngine);
 *
 *   // From here on, identical to the sync createSignalsEngine surface.
 *   <FilterEngineProvider engine={engine}><WineApp /></FilterEngineProvider>
 */
export async function createSignalsEngineFromAsync<T>(
	asyncEngine: FilterEngineAsync<T>,
	options: CreateSignalsEngineFromAsyncOptions = {},
): Promise<SignalsEngine<T>> {
	// ─── Initial state pull — sourceData ONCE, then derived state ──────────
	// **The bandwidth contract.** `getSourceData()` is the only call that ships the full
	// corpus across the postMessage boundary — paid exactly once at boot (~110MB of
	// structuredClone for a 130k-record dataset). Every subsequent rule/expression
	// event refresh ships indices (Uint32Array, ≤520KB upper bound, postMessage-transferred
	// zero-copy) rather than re-shipping the full filtered objects. The main thread joins
	// indices against the bootstrapped `initialSourceData` to hydrate the results signal —
	// a sub-millisecond projection over already-resident memory.
	//
	// `getResults()` is still called once at boot so the initial paint can happen before any
	// indices arrive (sub-millisecond on the initial-state path because results === source
	// when no rules are active). After boot the adapter pivots to indices-only.
	const initialSourceData = await asyncEngine.getSourceData();
	const [
		initialResultCount,
		initialActiveRuleIds,
		initialExpression,
		initialGroups,
		initialActiveRulesSerialized,
		initialResults,
		initialActionLog,
		initialDevtoolsState,
	] = await Promise.all([
		asyncEngine.getResultCount(),
		asyncEngine.getActiveRuleIds(),
		asyncEngine.getExpression(),
		asyncEngine.getGroups(),
		asyncEngine.getRules(),
		asyncEngine.getResults(),
		// Devtools mirror state — fetched at boot so the panel can render the initial
		// (typically empty or near-empty) action log without an awaitable mount delay.
		asyncEngine.getActionLogSnapshot(),
		asyncEngine.getDevtoolsState(),
	]);

	// ─── Writable mirror signals — seeded from the initial pull ────────────
	const resultsSignal = signal<readonly T[]>(initialResults);
	const resultCountSignal = signal<number>(initialResultCount);
	const sourceDataSignal = signal<readonly T[]>(initialSourceData);
	// The async engine doesn't currently expose `workingSet` distinctly — mirror sourceData
	// until the subscribe loop tells us otherwise (workingSet events refresh both).
	const workingSetSignal = signal<readonly T[]>(initialSourceData);
	// Seeded empty, then reseeded from `initialActiveRulesSerialized` once the refreshers'
	// `deserializeRules` is available (a few lines below). This is synchronous + pre-subscriber,
	// so no consumer ever observes the transient empty map.
	const activeRulesSignal = signal<ReadonlyMap<RuleId, FilterRule>>(new Map());
	const activeRuleIdsSignal = signal<readonly RuleId[]>(initialActiveRuleIds);
	const expressionSignal = signal<CompositeRule | null>(initialExpression);
	const groupsSignal = signal<readonly FilterGroup[]>(initialGroups);
	const modeSignal = signal<'expression' | 'flat-map'>(
		initialExpression !== null ? 'expression' : 'flat-map',
	);
	const lastChangeRuleIdSignal = signal<RuleId | null>(null);
	const lastChangeTimestampSignal = signal<number | null>(null);
	const lastChangeEventSignal = signal<ChangeEvent | null>(null);

	// ─── Devtools mirror signals ───────────────────────────────────────────
	// The worker is the source of truth for the action log + time-travel
	// cursor. These signals hold the main-thread view, refreshed after every engine event
	// via `refreshDevtools()` so React renders are always synchronous reads against the
	// latest known state.
	const actionLogSignal = signal<readonly WireActionLogEntry[]>(initialActionLog);
	const devtoolsStateSignal = signal<WireDevtoolsState>(initialDevtoolsState);

	// ─── Per-rule signal cache (memoized lazy derivations) ─────────────────
	const perRuleSignals = new Map<RuleId, ReadonlySignal<FilterRule | undefined>>();
	const buildRuleSignal = (ruleId: RuleId): ReadonlySignal<FilterRule | undefined> => {
		let cached = perRuleSignals.get(ruleId);

		if (!cached) {
			cached = computed(() => activeRulesSignal.value.get(ruleId));
			perRuleSignals.set(ruleId, cached);
		}

		return cached;
	};

	let isDisposed = false;
	// Read `isDisposed` through an accessor so TypeScript can't narrow it to a literal `false`
	// across the `await` boundaries below. The flag is flipped by `dispose()` (often DURING an
	// in-flight refresh's await), so every post-await re-check is a real runtime guard against
	// writing to torn-down signals — not the always-false condition a naive flow analysis sees.
	const getIsDisposed = (): boolean => isDisposed;

	// **No simulate fanout, so no simulate cache.** A per-chip `useExclusion` fanout would cost
	// ~50 worker round-trips per filter event. Instead, `FilterEngine.applyFiltersAndQuery`
	// returns chip exclusion data alongside slider bounds in a SINGLE worker round-trip per
	// filter event, so this adapter needs no SWR cache, dedup set or coalesced flush. Consumers
	// needing one-off `simulate()` calls outside the bundle call
	// `engine.asyncEngine.simulate(...)` directly and await the Promise themselves.

	// ─── The subscribe loop — Comlink-proxied listener over postMessage ────
	// The asyncEngine.subscribe returns Promise<Unsubscribe>; we need to keep the unsubscribe
	// reference for dispose(). Until the promise resolves we hold a placeholder; this rarely
	// matters in practice since subscribe round-trips in microseconds.
	// **Event-type-aware refresh.** Naively refreshing all 7 signals on every engine event
	// floods the postMessage channel during slider drag — each drag tick is a `rule:changed`
	// event, each event posted 7 getter calls (each carrying potentially-megabyte payloads
	// like the results array). Instead, dispatch by event type and pull only what changed:
	// a rule mutation refetches rules + results + count, an expression change refetches
	// expression + results + count, etc. `reset` is the only path that re-pulls everything.
	let unsubscribePromise: Promise<Unsubscribe> | null = null;

	// ─── Mirror-refresh helpers ─────────────────────────────────────────────
	// The event-type-aware refreshers + the two pure transforms (`deserializeRules`,
	// `projectResults`) live in `createAsyncMirrorRefreshers` to keep this file under the line
	// cap. They close over the writable mirror signals above + the async engine + `getIsDisposed`.
	const {
		deserializeRules,
		refreshDevtools,
		refreshEverything,
		refreshExpressionAndResults,
		refreshResultsAndCount,
		refreshRulesAndResults,
		refreshSourceAndDerived,
	} = createAsyncMirrorRefreshers<T>({
		actionLogSignal,
		activeRuleIdsSignal,
		activeRulesSignal,
		asyncEngine,
		devtoolsStateSignal,
		expressionSignal,
		getIsDisposed,
		groupsSignal,
		modeSignal,
		resultCountSignal,
		resultsSignal,
		sourceDataSignal,
		workingSetSignal,
	});

	// Reseed the active-rules mirror now that `deserializeRules` exists. Synchronous +
	// pre-subscriber, so the transient empty seed above is never observed by any consumer.
	const initialActiveRules = deserializeRules(initialActiveRulesSerialized);

	activeRulesSignal.value = initialActiveRules;

	if (options.eagerPerRuleSignals) {
		for (const id of initialActiveRules.keys()) {
			buildRuleSignal(id);
		}
	}

	const handleEvent = (event: ChangeEvent): void => {
		if (getIsDisposed()) {
			return;
		}

		// Route to the smallest refresh that satisfies this event's contract. Mirrors
		// `createSignalsEngine`'s switch so consumers swapping adapters see identical
		// mirror-update semantics.
		let refresh: Promise<void>;

		switch (event.type) {
			case 'expression':
				refresh = refreshExpressionAndResults();
				break;
			case 'results':
				refresh = refreshResultsAndCount();
				break;
			case 'rule:added':
			case 'rule:changed':
			case 'rule:removed':
				refresh = refreshRulesAndResults();
				break;
			case 'sourceData':
			case 'workingSet':
				refresh = refreshSourceAndDerived();
				break;
			case 'reset':
			default:
				refresh = refreshEverything();
				break;
		}

		// **Critical ordering**: refresh the main mirrors AND the devtools mirrors in parallel
		// BEFORE bumping `lastChange`. The obvious ordering (devtools after lastChange) means
		// consumers like `<DevtoolsPanel />` that re-render on `useLastChange` see a stale
		// action log on their first render — the devtools mirror updates one microtask later,
		// but the panel isn't subscribed to that signal directly. Parallel refresh + single
		// lastChange tick post-resolve = consumers see a consistent state slice on every
		// render.
		void Promise.all([refresh, refreshDevtools()]).then(() => {
			if (getIsDisposed()) {
				return;
			}
			batch(() => {
				lastChangeEventSignal.value = event;
				if (event.type === 'rule:added' || event.type === 'rule:removed' || event.type === 'rule:changed') {
					lastChangeRuleIdSignal.value = event.ruleId;
				}
				lastChangeTimestampSignal.value = Date.now();
				if (event.type === 'rule:added' && options.eagerPerRuleSignals) {
					buildRuleSignal(event.ruleId);
				}
			});
		});
	};

	// Kick off the subscribe — listener is Comlink-proxied so the worker can invoke it back
	// on the main thread.
	unsubscribePromise = asyncEngine.subscribe(comlinkProxy(handleEvent));

	// ─── The `.core` sync FilterEngine shim ───────────────────────────────
	// Built in `createAsyncCoreShim` (a separate module to keep this file under the line cap). It
	// implements the sync methods consumers call from React render, mirrors the devtools surface
	// locally, and throws a clear error for advanced facilities that have no postMessage-safe
	// main-thread surface.
	const coreShim = createAsyncCoreShim<T>({
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
	});

	// ─── The SignalsEngine surface ─────────────────────────────────────────
	const facade: SignalsEngine<T> = {
		activeRuleIds: activeRuleIdsSignal,
		activeRules: activeRulesSignal,
		// Direct reference to the underlying `FilterEngineAsync<T>` — escape hatch for
		// consumer code that needs to call async-only methods (e.g.,
		// `getFilteredFieldValuesExcept` for off-main-thread bounds derivation). Optional on
		// the SignalsEngine surface for the same reason `swrRevision` is — third-party
		// adapters wrapping non-worker backends may not expose anything async.
		asyncEngine,
		core: coreShim,
		dispose: () => {
			if (getIsDisposed()) {
				return;
			}
			isDisposed = true;
			void unsubscribePromise.then((unsub) => {
				try {
					unsub();
				} catch { /* tolerate worker already torn down */ }
			});
			perRuleSignals.clear();
		},
		expression: expressionSignal,
		groups: groupsSignal,
		get isDisposed(): boolean {
			return getIsDisposed();
		},
		lastChangeEvent: lastChangeEventSignal,
		lastChangeRuleId: lastChangeRuleIdSignal,
		lastChangeTimestamp: lastChangeTimestampSignal,
		mode: modeSignal,
		resultCount: resultCountSignal,
		results: resultsSignal,
		rule: (ruleId: RuleId) => buildRuleSignal(ruleId),
		sourceData: sourceDataSignal,
		workingSet: workingSetSignal,
	};

	return facade;
}
