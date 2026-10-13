/**
 * `SignalsEngine<T>` — the return type of `createSignalsEngine(core)`. The public reactive
 * surface for consumers wiring `@filter-enginez/core` into a `@preact/signals-core`-based
 * reactive graph.
 *
 * @remarks
 * Per `docs/architecture.md` §11.1. This is the Adapter half of the Adapter+Facade pattern
 * (formally the GoF Bridge pattern) — the engine abstraction varies independently from the
 * reactive-surface implementation. Two reactive adapters ship alongside core (signals here,
 * RxJS in `@filter-enginez/reactive-rxjs`); third-party adapters can implement the same shape
 * over Vue's `ref`/`computed`, Solid's `createSignal`/`createMemo`, MobX `observable`, or
 * other reactive primitives without changing one line of core.
 *
 * **Why a separate type file.** The interface lives apart from the factory so consumers can
 * `import type { SignalsEngine } from '@filter-enginez/reactive-signals'` in their hook /
 * component type-annotations without pulling in the factory implementation. The React binding
 * (`@filter-enginez/react-signals`) consumes this type for its `FilterEngineProvider` context.
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
import type { ReadonlySignal } from '@preact/signals-core';

/**
 * The public reactive surface returned by `createSignalsEngine(core)`.
 *
 * @typeParam T - The item type the underlying engine operates over
 *
 * @remarks
 * Every property is a `ReadonlySignal` — consumers `.value` them in computed contexts (a React
 * `useSignal(engine.results)` hook, a preact reactive component, a `computed(() =>
 * engine.results.value.length > 0 ? 'has-results' : 'empty')` derivation). Writes flow the
 * other direction — call methods on the underlying `core` engine, the subscribe-driven sync
 * loop inside `createSignalsEngine` mirrors the mutation back into the signals.
 *
 * **Single-direction data flow.** Consumers MUST NOT write to these signals directly. The
 * Adapter+Facade contract is that the engine is the source of truth; the signals mirror.
 * Direct mirror-mutation is to a signal adapter what `dispatch(stateUpdated)` is to the Redux
 * mirror — a contract violation. The enforcement is type-level only: each property is typed
 * `ReadonlySignal`, but the runtime signal IS writable.
 */
export interface SignalsEngine<T> {
	/** The underlying core engine — exposed for advanced consumers (custom hooks, debugging). */
	readonly core: FilterEngine<T>;

	// ─── Result signals ────────────────────────────────────────────────────

	/** Current filtered results. Updates whenever any rule / source data / working set changes. */
	readonly results: ReadonlySignal<readonly T[]>;

	/** `results.value.length` — cheaper to read when only the count matters. */
	readonly resultCount: ReadonlySignal<number>;

	// ─── Source / working data signals ─────────────────────────────────────

	/** The full source data the engine is filtering over. */
	readonly sourceData: ReadonlySignal<readonly T[]>;

	/** The current working subset (defaults to sourceData unless `setWorkingSet` was called). */
	readonly workingSet: ReadonlySignal<readonly T[]>;

	// ─── Rule signals ──────────────────────────────────────────────────────

	/** Map of all currently-registered rules. */
	readonly activeRules: ReadonlySignal<ReadonlyMap<RuleId, FilterRule>>;

	/** Just the rule IDs — handy for iterating in render without re-deriving keys every time. */
	readonly activeRuleIds: ReadonlySignal<readonly RuleId[]>;

	/**
	 * Accessor for a per-rule signal — `engine.rule('price-range').value` reads the current rule
	 * at that id (or `undefined` if not registered). Useful for fine-grained component
	 * subscriptions where only one rule matters and re-rendering on every rule-map change would
	 * over-trigger.
	 *
	 * @remarks
	 * Per-rule signals are `computed` derivations memoized on first access. Multiple calls with
	 * the same id return the same `ReadonlySignal` instance.
	 *
	 * @param ruleId - The rule id to track
	 */
	rule(ruleId: RuleId): ReadonlySignal<FilterRule | undefined>;

	// ─── Expression / group signals ────────────────────────────────────────

	/** Current explicit expression tree (`null` in flat-map mode). */
	readonly expression: ReadonlySignal<CompositeRule | null>;

	/** All currently-registered filter groups. */
	readonly groups: ReadonlySignal<readonly FilterGroup[]>;

	/** Current engine mode — `'flat-map'` or `'expression'`. */
	readonly mode: ReadonlySignal<'expression' | 'flat-map'>;

	// ─── Last-change signal ────────────────────────────────────────────────

	/** The id of the rule most recently mutated (added / changed / removed). `null` initially. */
	readonly lastChangeRuleId: ReadonlySignal<RuleId | null>;

	/** Timestamp of the last rule mutation. `null` initially. */
	readonly lastChangeTimestamp: ReadonlySignal<number | null>;

	/**
	 * The most recent change event the engine emitted. `null` until the first event fires.
	 * Useful for hooks that need to react to a specific event type (e.g., a toast on
	 * `'rule:removed'`).
	 */
	readonly lastChangeEvent: ReadonlySignal<ChangeEvent | null>;

	/**
	 * Stale-while-revalidate revision counter, optional on the interface.
	 *
	 * On worker-backed engines, chip exclusion rides the single `applyFiltersAndQuery` bundle
	 * round-trip, so there is no per-candidate `simulate()` cache to revalidate.
	 *
	 * **Adapters:** the sync `createSignalsEngine` emits a constant `0` (interface uniformity); the
	 * async `createSignalsEngineFromAsync` does not provide this signal. `useExclusion` (a
	 * sync-adapter affordance) falls back to a constant 0 when it's absent, so `undefined` is safe.
	 */
	readonly swrRevision?: ReadonlySignal<number>;

	/**
	 * Direct reference to the underlying `FilterEngineAsync<T>` — escape hatch for consumer
	 * code that needs to call async-only methods (e.g., `getFilteredFieldValuesExcept` for
	 * off-main-thread bounds derivation in per-slider filtered-except-self projections).
	 *
	 * **Optional + present only on worker-backed adapters.** The sync `createSignalsEngine`
	 * doesn't carry one (everything's already sync via `core`). The async
	 * `createSignalsEngineFromAsync` provides it pointing at the wrapped worker engine.
	 *
	 * Consumer code that wants to use async methods should null-check before calling:
	 *
	 *   const values = await engine.asyncEngine?.getFilteredFieldValuesExcept('price', 'priceUsd');
	 *   if (values) { // use them }
	 */
	readonly asyncEngine?: FilterEngineAsync<T>;

	// ─── Lifecycle ─────────────────────────────────────────────────────────

	/**
	 * Tear down the adapter — unsubscribes from core, releases the per-rule signal cache, and
	 * leaves any held `ReadonlySignal`s frozen at their final value. Does NOT call
	 * `core.destroy()` — the adapter does not own the engine's lifecycle.
	 *
	 * Safe to call multiple times (subsequent calls are no-ops).
	 */
	dispose(): void;

	/**
	 * Whether `dispose()` has been called. After disposal, the adapter's signals stop updating
	 * but remain readable at their last value.
	 */
	readonly isDisposed: boolean;
}
