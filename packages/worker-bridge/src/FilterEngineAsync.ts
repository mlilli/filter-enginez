/**
 * `FilterEngineAsync<T>` — the Promise-based mirror of `FilterEngine<T>`. The shape consumers
 * code against when their engine lives in a Web Worker and every call has to round-trip a
 * postMessage.
 *
 * @remarks
 * Per `docs/architecture.md` §15. Comlink wraps the worker-side `FilterEngine` and exposes
 * exactly this shape on the main thread — every sync method becomes async, signal-backed
 * getters become async getters, the synchronous `subscribe(listener)` becomes a proxy that
 * forwards worker-emitted events to the main thread (Comlink-`proxy`-wrapped listener).
 *
 * **Why a separate interface, not an alias to `FilterEngine`.** A few methods on `FilterEngine`
 * cannot cleanly round-trip through Comlink — primarily the direct `store` / `dispatcher`
 * references (they're class instances with live signal subscriptions). Those are omitted from
 * `FilterEngineAsync`. Consumers needing them have to drop down to direct main-thread engines.
 * The async interface only carries the methods that make semantic sense over a postMessage
 * boundary.
 *
 * **Per-rule-instance serialization.** When a consumer calls `engine.addRule(id, rule)` on a
 * `FilterEngineAsync` proxy, Comlink runs the rule through structuredClone-like serialization
 * before postMessage. `PredicateRule` (function pointers) and other non-serializable rules
 * will throw. Consumers should use `loadConfig({ ... })` for worker engines instead — the
 * JSON config is round-trip-safe by design.
 *
 * @packageDocumentation
 */

import type {
	ChangeListener,
	CompositeRule,
	FilterBundle,
	FilterBundleQuery,
	FilterEngineConfig,
	FilterGroup,
	FilterRule,
	RuleId,
	SimulationModification,
	SimulationResult,
	Unsubscribe,
} from '@filter-enginez/core';

/**
 * Postmessage-safe summary of one action log entry, shipped from the worker to the main
 * thread for devtools UI rendering.
 *
 * @remarks
 * The full `ActionLogEntry` shape on the worker side carries `FilterRule` instances (in the
 * action's payload) plus full pre/next `EngineSnapshot` blobs. Neither is structuredClone-
 * safe (rules contain functions; snapshots can be 150k items). Shipping the full entry over
 * postMessage would either throw or be wasteful — we serialize each entry to this thin
 * summary instead.
 *
 * **Time-travel implication.** The main thread can READ the action log via these summaries
 * (enough to render rows + decide which index to jump to), but actual state restoration
 * still has to round-trip through the worker — call `jumpToDevtoolsIndex(i)` and the worker
 * applies the snapshot stored on its side. The summary is a navigation aid, not a state
 * mirror.
 */
export interface WireActionLogEntry {
	/** The original action type discriminator (e.g., `'RULE_ADDED'`, `'EXPRESSION_SET'`). */
	readonly type: string;
	/** When the action was dispatched. */
	readonly timestamp: number;
	/** For rule-mutation actions: the rule id this action targeted. */
	readonly ruleId?: string;
	/** For rule-mutation actions: the rule's class name (e.g., `'RangeRule'`). */
	readonly ruleType?: string;
	/** For group actions: the group id this action targeted. */
	readonly groupId?: string;
	/**
	 * Human-readable short summary of the action — what the devtools row shows in its args
	 * column. E.g., `'price: $20 — $50'`, `'origin: 3 selected'`, `'clear all rules'`.
	 */
	readonly summary: string;
	/** Optional metadata forwarded from the original ActionLogEntry. */
	readonly source?: 'devtools' | 'engine' | 'redux-bridge' | 'replay' | 'url-state';
}

/**
 * Devtools state snapshot — the scrubber-bar's "where am I" view.
 *
 * @remarks
 * The main thread maintains a local mirror of this state by re-fetching after every
 * engine change event, so React renders are always synchronous reads against the latest
 * snapshot.
 */
export interface WireDevtoolsState {
	/** Index of the most recently applied action (-1 if log is empty). */
	readonly currentIndex: number;
	/** Total number of entries in the log. */
	readonly total: number;
	/** Whether `undoDevtools()` would have an effect. */
	readonly canUndo: boolean;
	/** Whether `redoDevtools()` would have an effect. */
	readonly canRedo: boolean;
}

/**
 * The Promise-based engine facade exposed by `wrapInWorker(...)`.
 *
 * @typeParam T - The item type the underlying engine operates over
 */
export interface FilterEngineAsync<T> {
	// ─── Source data + working set ─────────────────────────────────────────

	getSourceData(): Promise<readonly T[]>;
	resetWorkingSet(): Promise<void>;
	setSourceData(items: readonly T[]): Promise<void>;
	setWorkingSet(items: readonly T[]): Promise<void>;

	// ─── Rules (flat-map mode) ─────────────────────────────────────────────

	/**
	 * Add or replace a rule.
	 *
	 * @remarks
	 * The rule instance is serialized via Comlink before crossing the postMessage boundary —
	 * `PredicateRule` and other non-serializable rule subclasses will throw. Use `loadConfig`
	 * for worker engines when you have non-serializable rules.
	 */
	addRule(ruleId: RuleId, rule: FilterRule): Promise<void>;
	clearRules(): Promise<void>;
	getRule(ruleId: RuleId): Promise<FilterRule | undefined>;
	getRules(): Promise<ReadonlyMap<RuleId, FilterRule>>;
	removeRule(ruleId: RuleId): Promise<void>;

	// ─── Expression mode ───────────────────────────────────────────────────

	getExpression(): Promise<CompositeRule | null>;
	setExpression(expression: CompositeRule | null): Promise<void>;

	// ─── Filter groups ─────────────────────────────────────────────────────

	addGroup(group: FilterGroup): Promise<void>;
	getGroups(): Promise<readonly FilterGroup[]>;
	removeGroup(groupId: string): Promise<void>;

	// ─── Results ────────────────────────────────────────────────────────────

	getActiveRuleIds(): Promise<readonly RuleId[]>;
	getResultCount(): Promise<number>;
	getResults(): Promise<readonly T[]>;

	/**
	 * Positional indices into `workingSet` for each item currently in `getResults()`.
	 *
	 * @remarks
	 * The bandwidth-frugal alternative to `getResults()` for worker-hosted engines. The
	 * underlying `Uint32Array.buffer` is `postMessage`-transferred (zero-copy) — typical
	 * payload for a 150k-record corpus is ≤600KB and the transfer is constant-time regardless
	 * of how much of the corpus passed the filter.
	 *
	 * **Invariant:** `(await getResults())[i]` references the same logical item as
	 * `workingSet[(await getResultIndices())[i]]` — adapter code on the main thread can join
	 * the indices against a bootstrapped sourceData/workingSet mirror to hydrate full result
	 * objects without re-shipping them.
	 */
	getResultIndices(): Promise<Uint32Array>;

	/**
	 * Values of a specific numeric field over the items that pass every active rule EXCEPT
	 * the one identified by `excludeRuleId`. Powers per-slider available-bounds derivation
	 * and histogram bucketing in consumer UIs without forcing them to iterate the corpus on
	 * the main thread.
	 *
	 * @remarks
	 * Returned as a `Float64Array` (transferable, zero-copy across the postMessage boundary).
	 * Typical payload for the wine corpus: 150k items × 8 bytes = 1.2MB upper bound, often
	 * far less after filtering. Transfer is constant-time regardless of array length.
	 *
	 * **Why this exists.** The alternative is for consumer code to iterate the full
	 * sourceData on the main thread, applying all-rules-except-X per render per slider. For
	 * the 150k-record wine corpus with 4 sliders that means ~5.4M predicate evaluations on
	 * every panel render, frequently blocking the main thread for 1-2 seconds at a time. By
	 * exposing the operation as an engine method, the work runs entirely on whichever thread
	 * the engine itself lives on (the worker, for worker-hosted engines), leaving the main
	 * thread free for render commits + click dispatch.
	 *
	 * **Top-level fields only.** `fieldKey` resolves with a single property access on the
	 * item; nested paths aren't supported.
	 *
	 * **Non-numeric / missing values are skipped** — the returned Float64Array contains only
	 * finite numbers.
	 */
	getFilteredFieldValuesExcept(excludeRuleId: RuleId, fieldKey: string): Promise<Float64Array>;

	/**
	 * The single-round-trip "ask the engine for everything the UI needs to render a new
	 * filter state" method — async variant of `FilterEngine.applyFiltersAndQuery`.
	 *
	 * @remarks
	 * Without it, rendering a filter change takes many separate Comlink round-trips (results +
	 * indices + rules + N× filtered-except-self + ~50× chip simulates), enough to saturate the
	 * main thread for seconds on a large dataset. This method answers slider bounds and chip
	 * exclusion (`chipGroups`) in ONE round-trip.
	 *
	 * **Wire-format.** The returned `FilterBundle` contains transferable typed arrays
	 * (`resultIndices: Uint32Array`, plus `bucketEdges: Float64Array` + `counts: Uint32Array`
	 * per field). The worker-side router marks them as transferable; postMessage hands
	 * ownership to the main thread without copying. Tiny scalar fields (resultCount, ruleId,
	 * fieldKey, bounds.min/max) round-trip as plain JSON values.
	 *
	 * **See `FilterEngine.applyFiltersAndQuery`** for the full design rationale and the single-
	 * pass implementation detail.
	 */
	applyFiltersAndQuery(query?: FilterBundleQuery): Promise<FilterBundle>;

	// ─── Lifecycle ─────────────────────────────────────────────────────────

	reset(): Promise<void>;

	/**
	 * Subscribe to engine change events.
	 *
	 * @remarks
	 * The listener is wrapped in `Comlink.proxy(...)` before being sent to the worker so the
	 * worker can invoke it back on the main thread. The returned `Unsubscribe` is itself a
	 * promise-of-cleanup — the actual unsubscribe roundtrips.
	 */
	subscribe(listener: ChangeListener): Promise<Unsubscribe>;

	/** Tear down — also terminates the worker if `wrapInWorker` was called with `terminateOnDestroy`. */
	destroy(): Promise<void>;

	// ─── JSON config ───────────────────────────────────────────────────────

	exportConfig(): Promise<FilterEngineConfig>;
	loadConfig(config: FilterEngineConfig): Promise<void>;

	// ─── Simulation ────────────────────────────────────────────────────────

	simulate(modification: SimulationModification): Promise<SimulationResult<T>>;

	// ─── Devtools (action log + time-travel across the boundary) ──────────
	//
	// Per architecture §10. The worker is the source of truth for
	// devtools state — full ActionLogEntry instances (with snapshots) live there. These
	// methods give the main thread a wire-safe view + remote-control surface so a devtools
	// panel can read the log + dispatch time-travel commands.

	/**
	 * Read the full action log as wire-safe summaries. Returns the entries in chronological
	 * order (oldest first), matching `ActionLog.toArray()` on the worker side.
	 *
	 * **Pulled, not pushed.** The main-thread adapter calls this on every engine change event
	 * to refresh its local mirror. The cost is N entries serialized per event; for a typical
	 * action log cap of 100 entries, that's well under 1KB per fetch.
	 */
	getActionLogSnapshot(): Promise<readonly WireActionLogEntry[]>;

	/**
	 * Read the devtools cursor + undo/redo affordance state. Combined with
	 * `getActionLogSnapshot()`, the main thread has everything it needs to render a devtools
	 * panel.
	 */
	getDevtoolsState(): Promise<WireDevtoolsState>;

	/**
	 * Jump the engine to the state at action log index `i`. Restores the snapshot stored in
	 * the entry at that position; subsequent rule mutations truncate the "future" entries
	 * past `i`. No-op if `i` is out of range.
	 */
	jumpToDevtoolsIndex(index: number): Promise<void>;

	/**
	 * Step back one action. Identical to `jumpToDevtoolsIndex(currentIndex - 1)`.
	 */
	undoDevtools(): Promise<void>;

	/**
	 * Step forward one action (if any "future" exists from a prior jumpBack).
	 */
	redoDevtools(): Promise<void>;
}
