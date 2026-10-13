/**
 * `RxJsEngine<T>` — the return type of `createRxJsEngine(core)`. The public reactive surface
 * for consumers wiring `@filter-enginez/core` into an RxJS Observable graph.
 *
 * @remarks
 * Per `docs/architecture.md` §11.2. The RxJS half of the Adapter+Facade pattern (the signals
 * half lives in `@filter-enginez/reactive-signals`). The two surfaces are deliberately shape-
 * parallel — same property names with a `$` suffix and Observable type instead of a
 * ReadonlySignal type — so consumers can swap one for the other by changing the import line
 * and tweaking the `.value` / subscribe pattern.
 *
 * **Why `$` suffix.** The RxJS community convention (popularized by Ben Lesh and codified by
 * NgRx) marks variables holding Observables with a trailing `$`. The `@filter-enginez` packages
 * follow this convention for instant recognition in Angular / NgRx / RxJS-heavy codebases that
 * are likely to reach for this adapter.
 *
 * @packageDocumentation
 */

import type {
	ChangeEvent,
	CompositeRule,
	FilterEngine,
	FilterGroup,
	FilterRule,
	RuleId,
} from '@filter-enginez/core';
import type { FilterEngineAsync } from '@filter-enginez/worker-bridge';
import type { Observable } from 'rxjs';

/**
 * The public reactive surface returned by `createRxJsEngine(core)`.
 *
 * @typeParam T - The item type the underlying engine operates over
 *
 * @remarks
 * Every stream is `shareReplay(1)`-buffered — late subscribers get the most recent value
 * immediately on subscribe, not after the next mutation. This matches the consumer expectation
 * coming from React + RxJS combos where a component mounting mid-stream wants the current
 * value, not silence.
 *
 * **Hot multicast semantics.** All `$`-suffixed streams are hot — sharing one underlying
 * `engine.subscribe` registration across all subscribers. The hot multicast contract means
 * subscribing to `engine.results$` ten times costs one core subscriber, not ten. `dispose()`
 * tears down the shared underlying registration and completes all derived streams.
 */
export interface RxJsEngine<T> {
	/** The underlying core engine — exposed for advanced consumers (custom operators, debugging). */
	readonly core: FilterEngine<T>;

	// ─── Raw event stream ──────────────────────────────────────────────────

	/**
	 * Every change event the engine emits. Useful for consumers building custom derivations not
	 * covered by the per-key streams below. Hot, replayed (last 1).
	 */
	readonly events$: Observable<ChangeEvent>;

	// ─── Result streams ────────────────────────────────────────────────────

	/** Current filtered results — emits on every change that affects the result set. */
	readonly results$: Observable<readonly T[]>;

	/** `results.length` — cheaper to subscribe to when only the count matters. */
	readonly resultCount$: Observable<number>;

	// ─── Source / working data streams ─────────────────────────────────────

	/** The full source data — emits on `setSourceData`. */
	readonly sourceData$: Observable<readonly T[]>;

	/** The current working subset — emits on `setWorkingSet` / `resetWorkingSet`. */
	readonly workingSet$: Observable<readonly T[]>;

	// ─── Rule streams ──────────────────────────────────────────────────────

	/** All currently-registered rules. */
	readonly activeRules$: Observable<ReadonlyMap<RuleId, FilterRule>>;

	/** Just the rule IDs — handy for ngFor loops that don't need the rule body. */
	readonly activeRuleIds$: Observable<readonly RuleId[]>;

	/**
	 * Per-rule stream accessor — `engine.rule$('price-range')` emits the rule at that id (or
	 * `undefined` if not registered) whenever it changes. Useful for fine-grained component
	 * subscriptions where one rule matters and the full activeRules map would over-trigger.
	 *
	 * @remarks
	 * Per-rule streams are derived from `activeRules$` with `distinctUntilChanged` so consumers
	 * only see emissions when their specific rule actually changes. Multiple calls with the
	 * same id return the same cached `Observable` instance.
	 *
	 * @param ruleId - The rule id to track
	 */
	rule$(ruleId: RuleId): Observable<FilterRule | undefined>;

	// ─── Expression / group streams ────────────────────────────────────────

	/** Current explicit expression tree (`null` in flat-map mode). */
	readonly expression$: Observable<CompositeRule | null>;

	/** All currently-registered filter groups. */
	readonly groups$: Observable<readonly FilterGroup[]>;

	/** Current engine mode — `'flat-map'` or `'expression'`. */
	readonly mode$: Observable<'expression' | 'flat-map'>;

	// ─── Last-change streams ───────────────────────────────────────────────

	/** Id of the most recently mutated rule. `null` until the first mutation. */
	readonly lastChangeRuleId$: Observable<RuleId | null>;

	/** Timestamp of the most recent rule mutation. `null` until the first mutation. */
	readonly lastChangeTimestamp$: Observable<number | null>;

	/**
	 * The most recent change event the engine emitted, with `null` as the initial value before
	 * any event fires. Mirrors `SignalsEngine.lastChangeEvent` for shape-parallelism — useful
	 * for hooks that need to react to a specific event type (e.g., a toast on `'rule:removed'`).
	 *
	 * @remarks
	 * Derived from `events$` with a `startWith(null)`. Hot, replayed (last 1).
	 */
	readonly lastChangeEvent$: Observable<ChangeEvent | null>;

	/**
	 * Stale-while-revalidate revision counter, optional on the interface.
	 *
	 * On worker-backed engines, chip exclusion rides the single `applyFiltersAndQuery` bundle
	 * round-trip, so there is no per-candidate `simulate()` cache to revalidate.
	 *
	 * **Adapters:** the sync `createRxJsEngine` emits a constant `0` (interface uniformity); the
	 * async `createRxJsEngineFromAsync` does not provide this stream. `useExclusion` (a
	 * sync-adapter affordance) falls back to a constant 0 when it's absent, so `undefined` is safe.
	 */
	readonly swrRevision$?: Observable<number>;

	/**
	 * Direct reference to the underlying `FilterEngineAsync<T>` — escape hatch for consumer code
	 * that needs async-only methods (e.g. `applyFiltersAndQuery` for one-round-trip chip exclusion
	 * + slider bounds, or `getFilteredFieldValuesExcept`).
	 *
	 * **Optional + present only on worker-backed adapters.** The sync `createRxJsEngine` doesn't
	 * carry one (everything's already sync via `core`). The async `createRxJsEngineFromAsync`
	 * provides it, pointing at the wrapped worker engine. Mirrors `SignalsEngine.asyncEngine`.
	 */
	readonly asyncEngine?: FilterEngineAsync<T>;

	// ─── Lifecycle ─────────────────────────────────────────────────────────

	/**
	 * Tear down the adapter — unsubscribes from core, completes all derived streams, releases
	 * the per-rule stream cache. Does NOT call `core.destroy()` — the adapter does not own the
	 * engine's lifecycle.
	 *
	 * Safe to call multiple times (subsequent calls are no-ops).
	 */
	dispose(): void;

	/**
	 * Whether `dispose()` has been called. After disposal, the streams have completed and
	 * `take(1)` / `firstValueFrom` calls against them resolve to the buffered last value.
	 */
	readonly isDisposed: boolean;
}
