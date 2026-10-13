/**
 * `FilterEngine` — the main consumer-facing class. The Facade that ties together the internal
 * store, dispatcher, devtools, acceleration stack, and JSON-config layer
 * into a single ergonomic surface (`engine.addRule`, `engine.results`, `engine.subscribe`, etc.).
 *
 * @remarks
 * Per `docs/architecture.md` §2 (Public API surface) and §4 (Engine lifecycle). This class is
 * deliberately framework-agnostic — no React, no Vue, no signals adapter peeking through. The
 * reactive surface adapters (`@filter-enginez/reactive-signals`, `@filter-enginez/reactive-rxjs`)
 * sit downstream and lift `engine.subscribe(listener)` into signal/observable streams.
 *
 * **Composition over inheritance.** The class itself is a thin coordinator — every meaningful
 * piece of behavior lives in a composed sub-object (store, dispatcher, devtools, the acceleration
 * stack). Subclassing `FilterEngine` is not a supported extension path; consumers extend via
 * custom rule classes (registered through `ruleRegistry`) and custom reactive adapters.
 *
 * **Two subsystems are deliberately NOT composed in here** — similarity (MinHash + LSH) and
 * suggestions (session tracker + Bayesian model). Composing them here would put them in every
 * consumer's bundle, so they live behind opt-in subpaths: `@filter-enginez/core/similarity` and
 * `@filter-enginez/core/suggestions`. See `attachSimilarity` and `attachSuggestions`.
 *
 * @packageDocumentation
 */

import type { FilterGroup, FilterGroupInput } from './composition/FilterGroup.js';
import type { FilterEngineConfig } from './config/FilterEngineConfig.js';
import type { AccelerationOptions, FilterEngineOptions } from './FilterEngineOptions.js';
import type { BitmapIndex } from './internals/BitmapIndex.js';
import type { ExclusionGraph, ExclusionGraphMode } from './internals/ExclusionGraph.js';
import type { SimulationCache } from './internals/SimulationCache.js';
import type { FilterBundle, FilterBundleQuery } from './queryBundle.js';
import type { FilterRule } from './rules/FilterRule.js';
import type { Action } from './store/Action.js';
import type {
	ChangeEvent,
	ChangeListener,
	RuleId,
	SimulationModification,
	SimulationResult,
	Unsubscribe,
} from './types.js';

import { runFilterBundleQuery } from './applyFiltersAndQuery.js';
import { isConjunctive } from './composition/composeFlatExpression.js';
import { exportConfig, type ExportConfigOptions } from './config/exportConfig.js';
import { loadConfig, type LoadConfigOptions } from './config/loadConfig.js';
import { Devtools } from './devtools/Devtools.js';
import { FilterEngineModeError } from './errors/index.js';
import { filteredFieldValuesExcept } from './filteredFieldValuesExcept.js';
import { createAccelerationStack } from './internals/createAccelerationStack.js';
import { invalidateForAction } from './internals/invalidateForAction.js';
import { rejectCallsAfterDestroy } from './internals/rejectCallsAfterDestroy.js';
import { type CompositeRule } from './rules/CompositeRule.js';
import { Dispatcher } from './store/Dispatcher.js';
import { InternalStore } from './store/InternalStore.js';
import { captureSnapshot, type EngineSnapshot } from './store/snapshots.js';

/**
 * The main engine instance.
 *
 * @typeParam T - The item type the engine operates over (e.g., `Wine`, `Listing`, `Book`)
 */
export class FilterEngine<T = unknown> {
	/** The internal signal-tree state container — exposed for advanced consumers + adapters. */
	readonly store: InternalStore<T>;

	/** The Command-pattern dispatcher — exposed for advanced consumers + adapters. */
	readonly dispatcher: Dispatcher<T>;

	/** Devtools surface — action log, time-travel, replay, diff, Redux DevTools bridge. */
	readonly devtools: Devtools<T>;

	/** Roaring-Bitmap acceleration index. Auto-engages at sourceData.length ≥ 500 (default mode). */
	readonly bitmapIndex: BitmapIndex<T>;

	/** Mutual-exclusion graph for "would this filter empty the result set?" short-circuiting. */
	readonly exclusionGraph: ExclusionGraph<T>;

	/** LRU-memoized simulation cache backing `engine.simulate()`. */
	readonly simulationCache: SimulationCache<T>;

	/**
	 * Active change-event subscribers. Notified synchronously, in subscription order, after every
	 * store mutation (and after every time-travel restore or replay).
	 */
	private readonly _subscribers = new Set<ChangeListener>();

	/** Backs {@link FilterEngine.isDestroyed}; set once by the first `destroy()` call. */
	private _destroyed = false;

	/**
	 * The configured exclusion-graph build strategy. Retained so `_maybeWarmExclusionGraph`
	 * can re-precompute after each invalidation when the consumer opted into `'eager'`.
	 */
	private readonly _exclusionGraphMode: ExclusionGraphMode;

	// #region docs:devtools-construction
	constructor(options: FilterEngineOptions<T> = {}) {
		this.store = new InternalStore<T>(options.sourceData ?? []);
		this.dispatcher = new Dispatcher<T>(this.store);
		this.devtools = new Devtools<T>(
			this.store,
			this.dispatcher,
			options.devtools,
			(event) => {
				this._maybeWarmExclusionGraph();
				this._emit(event);
			},
			() => {
				this._clearAccelerationCaches();
			},
		);
		// #endregion docs:devtools-construction
		const accelerationStack = createAccelerationStack<T>(this.store, options.acceleration ?? {});

		this.bitmapIndex = accelerationStack.bitmapIndex;
		this.exclusionGraph = accelerationStack.exclusionGraph;
		this.simulationCache = accelerationStack.simulationCache;
		this._exclusionGraphMode = accelerationStack.exclusionGraphMode;
		// Results come from the bitmap AND whenever it can give the exact answer; the predicate
		// evaluator otherwise. Same results either way — see `BitmapIndex.tryComputeResults`.
		this.store.setResultsAccelerator(() => this.bitmapIndex.tryComputeResults());
		// Connect the Redux DevTools extension and start loading any persisted log BEFORE the
		// initial config is applied, so the config's actions appear as the first actions after
		// the extension's initial state.
		void this.devtools.init(this.snapshot());

		// Apply initial JSON config if provided.
		if (options.config) {
			this.loadConfig(options.config);
		}

		// Eager mode: warm the exclusion graph once construction (incl. any config-load) settles,
		// so the first interaction doesn't pay the build cost. No-op when the bitmap layer isn't
		// ready yet (e.g., 'auto' below the size threshold, or WASM not yet initialized).
		this._maybeWarmExclusionGraph();
	}

	// ─── Source data + working set ─────────────────────────────────────────

	/**
	 * Replace the source data the engine filters over. Bumps `sourceDataVersion`, which
	 * invalidates the bitmap-index, exclusion-graph and simulation caches, and resets the working
	 * set to the new data.
	 */
	setSourceData(items: readonly T[]): void {
		const previous = this.store.sourceData.value;

		this._dispatchAndEmit(
			{ payload: { items }, type: 'SOURCE_DATA_SET' },
			{ next: items, previous, type: 'sourceData' },
		);
	}

	/** Current source data. */
	getSourceData(): readonly T[] {
		return this.store.sourceData.value;
	}

	/**
	 * Substitute the working set — a pre-filtered subset of source data. Use when an upstream
	 * filter (e.g., a permission check or a coarse server-side filter) has already narrowed the
	 * dataset.
	 */
	setWorkingSet(items: readonly T[]): void {
		const previous = this.store.workingSet.value;

		this._dispatchAndEmit(
			{ payload: { items }, type: 'WORKING_SET_SET' },
			{ next: items, previous, type: 'workingSet' },
		);
	}

	/** Reset the working set to mirror the full source data. */
	resetWorkingSet(): void {
		const previous = this.store.workingSet.value;

		this._dispatchAndEmit(
			{ type: 'WORKING_SET_RESET' },
			{ next: this.store.sourceData.value, previous, type: 'workingSet' },
		);
	}

	// ─── Rules (flat-map mode) ─────────────────────────────────────────────

	/**
	 * Add (or replace) a rule. Two calls with the same `ruleId` are equivalent to a remove +
	 * add (the second call wins).
	 *
	 * @throws `FilterEngineModeError` (`MODE_EXPRESSION_ACTIVE`) while an expression is set: flat-map
	 *   rules are ignored in expression mode, so accepting the rule would change nothing visible
	 */
	addRule(ruleId: RuleId, rule: FilterRule): void {
		if (this.store.expression.value !== null) {
			throw new FilterEngineModeError('MODE_EXPRESSION_ACTIVE', `FilterEngine.addRule('${ruleId}') was called `
				+ `in expression mode, where flat-map rules are ignored. Call setExpression(null) first, or `
				+ `compose the rule into the expression.`);
		}
		const existing = this.store.rules.value.get(ruleId);

		if (existing) {
			this._dispatchAndEmit(
				{ payload: { rule, ruleId }, type: 'RULE_CHANGED' },
				{ next: rule, previous: existing, ruleId, type: 'rule:changed' },
			);
		} else {
			this._dispatchAndEmit(
				{ payload: { rule, ruleId }, type: 'RULE_ADDED' },
				{ rule, ruleId, type: 'rule:added' },
			);
		}
	}

	/** Remove a rule by id. No-op if the id is not registered. */
	removeRule(ruleId: RuleId): void {
		const existing = this.store.rules.value.get(ruleId);

		if (!existing) {
			return;
		}
		this._dispatchAndEmit(
			{ payload: { ruleId }, type: 'RULE_REMOVED' },
			{ rule: existing, ruleId, type: 'rule:removed' },
		);
	}

	/** Look up a rule by id. Returns `undefined` if not registered. */
	getRule(ruleId: RuleId): FilterRule | undefined {
		return this.store.rules.value.get(ruleId);
	}

	/** All currently-registered rules. */
	getRules(): ReadonlyMap<RuleId, FilterRule> {
		return this.store.rules.value;
	}

	/** Clear all rules, groups, and the explicit expression in one operation. */
	clearRules(): void {
		this._dispatchAndEmit({ type: 'RULES_CLEARED' }, { type: 'reset' });
	}

	// ─── Expression mode ───────────────────────────────────────────────────

	/**
	 * Set an explicit expression tree. Switches the engine to expression mode — flat-map rules
	 * are ignored while an explicit expression is set. Pass `null` to return to flat-map mode.
	 */
	setExpression(expression: CompositeRule | null): void {
		const previous = this.store.expression.value;

		this._dispatchAndEmit(
			{ payload: { expression }, type: 'EXPRESSION_SET' },
			{ next: expression, previous, type: 'expression' },
		);
	}

	/** Current explicit expression, or `null` in flat-map mode. */
	getExpression(): CompositeRule | null {
		return this.store.expression.value;
	}

	// ─── Filter groups ─────────────────────────────────────────────────────

	/**
	 * Add a filter group: the rules it names (by id) combine with its `composition` — `'or'`
	 * when omitted — and the group then ANDs with every other group and every rule no group
	 * names. Ids that name no registered rule are skipped, so a group can be declared before
	 * its rules are added. Applies in flat-map mode; an explicit expression replaces it.
	 */
	addGroup(group: FilterGroupInput): void {
		const stored: FilterGroup = { ...group, composition: group.composition ?? 'or' };

		this._dispatchAndEmit({ payload: { group: stored }, type: 'GROUP_ADDED' }, { type: 'reset' });
	}

	/** Remove a filter group by id. */
	removeGroup(groupId: string): void {
		this._dispatchAndEmit({ payload: { groupId }, type: 'GROUP_REMOVED' }, { type: 'reset' });
	}

	/** All currently-registered groups. */
	getGroups(): readonly FilterGroup[] {
		return this.store.groups.value;
	}

	// ─── Results ────────────────────────────────────────────────────────────

	/** Current filtered results. */
	getResults(): readonly T[] {
		return this.store.results.value;
	}

	/** `getResults().length` — cheaper than calling `getResults()` when only the count matters. */
	getResultCount(): number {
		return this.store.resultCount.value;
	}

	/**
	 * Positional indices into `workingSet` for each item in `getResults()` — same filter pass,
	 * different projection. Returned as a `Uint32Array` so the worker-bridge variant can
	 * `postMessage`-transfer the underlying `ArrayBuffer` for zero-copy delivery. The invariant
	 * `results[i] === workingSet[getResultIndices()[i]]` holds for every `i`.
	 */
	getResultIndices(): Uint32Array {
		return this.store.resultIndices.value;
	}

	/**
	 * Compute the result indices afresh, bypassing the memoized `getResultIndices()` signal: the
	 * Roaring-Bitmap AND of every active rule's bitmap when the bitmap path is engaged and exact
	 * (see `BitmapIndex.tryComputeResults`), else a copy of the predicate-evaluated indices. The
	 * benchmark suite measures this call.
	 *
	 * @returns Working-set indices passing the filter, ascending — always equal to
	 *   `getResultIndices()`, in a new `Uint32Array`.
	 */
	computeResults(): Uint32Array {
		return this.bitmapIndex.tryComputeResults() ?? this.store.resultIndices.value.slice();
	}

	/**
	 * Build the mutual-exclusion graph now instead of on the first query — call it in idle time
	 * after data load so the first interaction does not pay the build. Does nothing when the graph
	 * is `'off'`, already fresh, or bitmaps are not engaged. `acceleration.exclusionGraph: 'eager'`
	 * does this automatically after every invalidation.
	 */
	precomputeExclusions(): void {
		this.exclusionGraph.precompute();
	}

	/**
	 * Compute the values of a specific numeric field over the items that pass every active
	 * rule EXCEPT the one identified by `excludeRuleId`. The "filtered-except-self" projection
	 * that powers per-slider available-bounds derivation + histogram bucketing in consumer UIs
	 * (e.g., a three-layer range slider).
	 *
	 * @remarks
	 * `fieldKey` is a top-level property name (nested paths aren't supported — the constraint is
	 * intentional, since top-level keys cross postMessage as plain strings). Items whose field
	 * resolves to `undefined`/`null`/non-finite are silently skipped, so the returned array
	 * holds only finite numbers. The worker-bridge's `FilterEngineAsync` exposes a transferable
	 * `Float64Array` async variant that moves this work off the main thread when worker-hosted.
	 *
	 * Filter groups apply exactly as in `getResults()`.
	 *
	 * @param excludeRuleId - The rule id to skip during evaluation. If no rule with this id
	 *   is registered, all rules are applied (equivalent to `getResults`).
	 * @param fieldKey - The top-level property name to extract from each surviving item.
	 * @returns A plain `number[]` of finite values, one per surviving item in source order.
	 */
	getFilteredFieldValuesExcept(excludeRuleId: RuleId, fieldKey: keyof T & string): readonly number[] {
		const { groups, rules, workingSet } = this.store;

		return filteredFieldValuesExcept(workingSet.value, rules.value, groups.value, excludeRuleId, fieldKey);
	}

	/**
	 * Compute results + per-field bounds + histograms + per-chip exclusion data in a single pass — the
	 * one-shot that collapses the cascading-Comlink fanout (a round-trip per slider + chip) into ONE call.
	 *
	 * @remarks
	 * **Flat-map mode:** a thin facade over `runFilterBundleQuery` (`./applyFiltersAndQuery.ts`), which
	 * holds the single-pass algorithm, filtered-except-self projection, bucketing, and chip-attribution
	 * index. See `queryBundle.ts` for the shapes.
	 *
	 * **Expression mode, or an `'or'` group spanning two or more registered rules:** the filter is no
	 * longer a conjunction of the flat rules, which is what the single-pass facet algorithm assumes, so
	 * `resultIndices` / `resultCount` come from the engine's own results signal — the exact value
	 * `getResultIndices()` returns — and `chipGroups` / `fields` come back EMPTY (per-flat-facet data
	 * is undefined while a composed filter is active). Conjunctive groups (`composition: 'and'`, or an
	 * `'or'` group with at most one registered rule) leave the flat path in use.
	 *
	 * @param query - Field + chip-group requests to compute alongside results; order preserved. Ignored
	 *   while a composed filter is active, where facets are not applicable.
	 * @returns A `FilterBundle` (facets empty while a composed filter is active).
	 */
	applyFiltersAndQuery(query: FilterBundleQuery = {}): FilterBundle {
		const { expression, groups, rules } = this.store;

		if (expression.value !== null || !isConjunctive(rules.value.keys(), groups.value)) {
			// A COPY, not the signal's array: it's a transferable `Uint32Array` the worker bridge may neuter.
			const resultIndices = this.store.resultIndices.value.slice();

			return { chipGroups: [], fields: [], resultCount: resultIndices.length, resultIndices };
		}

		return runFilterBundleQuery(this.store.workingSet.value, this.store.rules.value, query);
	}

	/** Currently-registered rule IDs. */
	getActiveRuleIds(): readonly RuleId[] {
		return this.store.activeRuleIds.value;
	}

	// ─── Lifecycle ─────────────────────────────────────────────────────────

	/** Reset rules, groups, expression, and working set in a single action. */
	reset(): void {
		this._dispatchAndEmit({ type: 'RESET' }, { type: 'reset' });
	}

	/**
	 * Subscribe to engine change events. The returned function unsubscribes.
	 *
	 * @example
	 *   const unsubscribe = engine.subscribe((event) => {
	 *     if (event.type === 'results') updateUi(event.next);
	 *   });
	 *   // later:
	 *   unsubscribe();
	 */
	subscribe(listener: ChangeListener): Unsubscribe {
		this._subscribers.add(listener);

		return () => {
			this._subscribers.delete(listener);
		};
	}

	/** `true` once `destroy()` has run; every public method except `destroy()` then throws. */
	get isDestroyed(): boolean {
		return this._destroyed;
	}

	/**
	 * Tear down the engine — drop subscribers, release the acceleration caches (bitmaps, R-trees,
	 * text postings, exclusion graph, simulation results), flush pending persistence and disconnect
	 * devtools. Safe to call multiple times (subsequent calls are no-ops); every other public method
	 * throws `FilterEngineDestroyedError` (`ENGINE_DESTROYED`) afterwards.
	 */
	async destroy(): Promise<void> {
		if (this._destroyed) {
			return;
		}
		this._destroyed = true;
		this._subscribers.clear();
		this._clearAccelerationCaches();
		await this.devtools.destroy();
	}

	// ─── JSON config ───────────────────────────────────────────────────────

	/** Apply a `FilterEngineConfig` document — replaces current rules/groups/expression. */
	loadConfig(config: FilterEngineConfig, options?: LoadConfigOptions): void {
		loadConfig(this, config, options);
	}

	/** Export current rules/groups/expression as a `FilterEngineConfig` document. */
	exportConfig(options?: ExportConfigOptions): FilterEngineConfig {
		return exportConfig(this, options);
	}

	// ─── Simulation ────────────────────────────────────────────────────────

	/**
	 * Compute the projected result for a hypothetical modification of engine state.
	 *
	 * Routes through `SimulationCache` which memoizes by `(modification + active rule
	 * fingerprint + source-data version + working-set version)` until the next state change. The
	 * first call for a given key runs the bitmap fast path when it is engaged and exact, else the
	 * predicate evaluator (filter groups and expression mode included); later calls return cached.
	 *
	 * @returns Projected `{ resultCount, sample, wouldBeEmpty, cacheKey }`
	 */
	simulate(modification: SimulationModification): SimulationResult<T> {
		return this.simulationCache.simulate(modification);
	}

	// ─── Internal helpers ──────────────────────────────────────────────────

	/**
	 * Capture the engine's current snapshot — convenience wrapper exposed for the reactive
	 * adapters + devtools persistence.
	 */
	snapshot(): EngineSnapshot {
		return captureSnapshot(this.store);
	}

	// #region docs:dispatch-and-emit
	/**
	 * Dispatch an action AND emit the corresponding change event: capture the pre-action
	 * snapshot, invalidate the acceleration caches the action affects, mutate the store via the
	 * dispatcher (one batched write), re-warm an `'eager'` exclusion graph, record the action with
	 * both snapshots into devtools (for time-travel + Redux DevTools), then notify subscribers.
	 *
	 * Caches are dropped BEFORE the write so that a signal effect reacting to the write — which
	 * runs when the dispatcher's batch ends — can never read a bitmap built for the old state.
	 * With `devtools.enabled: false` no snapshots are captured at all.
	 */
	private _dispatchAndEmit(action: Action, event: ChangeEvent): void {
		const previousSnapshot = this.devtools.enabled ? captureSnapshot(this.store) : null;
		const shouldWarmExclusions = invalidateForAction(this.bitmapIndex, this.exclusionGraph, action);

		this.simulationCache.invalidate(action);
		this.dispatcher.dispatch(action);
		if (shouldWarmExclusions) {
			this._maybeWarmExclusionGraph();
		}
		if (previousSnapshot !== null) {
			this.devtools.recordAction(action, previousSnapshot, captureSnapshot(this.store));
		}
		this._emit(event);
	}
	// #endregion docs:dispatch-and-emit

	/**
	 * Drop every acceleration cache: per-rule bitmaps (with their R-trees and text postings), the
	 * exclusion graph and the simulation results. Runs before a time-travel restore or replay
	 * writes the store, and on `destroy()`.
	 */
	private _clearAccelerationCaches(): void {
		this.bitmapIndex.clear();
		this.exclusionGraph.invalidate();
		this.simulationCache.clear();
	}

	/**
	 * Re-warm the exclusion graph after an invalidation when the consumer opted into `'eager'`
	 * mode. A no-op in `'lazy'` / `'off'` mode, and a no-op in eager mode too whenever the
	 * bitmap layer isn't ready (`precompute` self-guards on `bitmapIndex.isReady`), so this is
	 * always safe to call unconditionally at any invalidation point.
	 */
	private _maybeWarmExclusionGraph(): void {
		if (this._exclusionGraphMode === 'eager') {
			this.exclusionGraph.precompute();
		}
	}

	/**
	 * Notify every subscriber of an event. Errors in one subscriber don't stop the rest.
	 *
	 * @remarks
	 * `console` is accessed off `globalThis` rather than via a `lib: ['dom']` entry — the
	 * isomorphic boundary forbids the DOM lib, but `console` is universal across Node / Workers
	 * / Deno / edge targets even though it isn't in `lib.es2022.d.ts`.
	 */
	private _emit(event: ChangeEvent): void {
		const safeConsole = (globalThis as { console?: { error?: (...args: unknown[]) => void }}).console;

		for (const listener of this._subscribers) {
			try {
				listener(event);
			} catch (err) {
				// Subscriber errors are logged and contained so one failing listener can't stop the
				// rest from hearing about the change.
				safeConsole?.error?.(
					'[FilterEngine] subscriber threw — swallowing to protect other listeners:',
					err,
				);
			}
		}
	}
}

// A call on a destroyed engine would mutate state nothing observes; fail it loudly instead.
rejectCallsAfterDestroy(FilterEngine.prototype, 'FilterEngine');

// Re-export types consumers will commonly reach for alongside the engine class. The option
// types live in `FilterEngineOptions.ts` but stay reachable from here for a stable import path.
export type { AccelerationOptions, FilterEngineOptions };
