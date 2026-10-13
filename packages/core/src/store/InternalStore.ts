/**
 * `InternalStore` — the engine's signal-tree state container.
 *
 * @remarks
 * Owns all reactive state for a single engine instance. Every consumer-facing public API
 * (`engine.results`, `engine.activeRuleIds`, etc.) is a thin facade over signals owned here.
 *
 * **Signal topology** — see `docs/architecture.md` §3.1 for the full graph. Writable signals
 * carry raw state; `computed` signals derive read-only views. Per the architecture doc's
 * Pillar 4, all mutations flow through `Dispatcher.dispatch(action)`, NEVER through direct
 * writes to these signals from outside this store.
 *
 * **Filtering.** `resultIndices` is the one source of truth for "which working-set positions
 * pass", and `results` projects through it. `resultIndices` first asks the results accelerator
 * that `FilterEngine` installs (the Roaring-Bitmap AND in `internals/BitmapIndex`); when the
 * accelerator declines — bitmaps not engaged, expression mode, a disjunctive group, or a working
 * set that differs from the source data — it runs the predicate evaluator
 * (`composition/ExpressionEvaluator`) over the working set. Both answers are identical; the
 * accelerator only changes the cost. Either way the result is memoized by the signal graph.
 *
 * @packageDocumentation
 */

import { computed, type ReadonlySignal, type Signal, signal } from '@preact/signals-core';

import type { FilterGroup } from '../composition/FilterGroup.js';
import type { CompositeRule } from '../rules/CompositeRule.js';
import type { FilterRule } from '../rules/FilterRule.js';
import type { RuleId } from '../types.js';

import { composeFlatExpression } from '../composition/composeFlatExpression.js';
import { evaluateExpression } from '../composition/ExpressionEvaluator.js';
import { simplify } from '../composition/simplify.js';

/**
 * Engine evaluation mode.
 *
 * - `'flat-map'` — engine implicitly ANDs together every registered rule (the default)
 * - `'expression'` — engine evaluates the explicit `setExpression(...)` CompositeRule tree
 */
export type EngineMode = 'expression' | 'flat-map';

/**
 * A faster route to `resultIndices` that `FilterEngine` installs via
 * {@link InternalStore.setResultsAccelerator}. Returns the passing working-set indices
 * (ascending), or `null` to decline so the store runs the predicate evaluator instead. It runs
 * inside the `resultIndices` computed, so every signal it reads becomes a dependency.
 */
export type ResultsAccelerator = () => Uint32Array | null;

// #region docs:internal-store-shape
/**
 * The engine's signal-tree state container. One instance per `FilterEngine`.
 *
 * @typeParam T - The item type the engine operates over
 */
export class InternalStore<T> {
	// ─── Writable signals — mutated only via Dispatcher ────────────────────

	/** The full source-data array — set by `setSourceData`, immutable from outside. */
	readonly sourceData: Signal<readonly T[]>;

	/**
	 * Monotonically increasing version counter for `sourceData`. Bumped on every
	 * `SOURCE_DATA_SET` action. Used as a cache key part for the acceleration stack
	 * (bitmap index, similarity signatures, exclusion graph) so any source-data change
	 * invalidates all derived caches in O(1).
	 */
	readonly sourceDataVersion: Signal<number>;

	/**
	 * The current working subset of source data. Defaults to source data; consumers can
	 * substitute a pre-filtered subset via `setWorkingSet`. Independent version counter for
	 * cache invalidation.
	 */
	readonly workingSet: Signal<readonly T[]>;

	/** Monotonically increasing version counter for `workingSet`. */
	readonly workingSetVersion: Signal<number>;

	/** Map of currently-registered rules (flat-map mode). Immutable updates via Dispatcher. */
	readonly rules: Signal<ReadonlyMap<RuleId, FilterRule>>;

	/** Explicit expression tree (expression mode). Null in flat-map mode. */
	readonly expression: Signal<CompositeRule | null>;

	/** Registered filter groups (OR-within / AND-between convenience). */
	readonly groups: Signal<readonly FilterGroup[]>;

	/** The id of the last rule mutated. Powers the `lastChangeRuleId` UI affordance. */
	readonly lastChangeRuleId: Signal<RuleId | null>;

	/** Timestamp (Date.now()) of the last rule mutation. */
	readonly lastChangeTimestamp: Signal<number | null>;

	// ─── Computed signals — derived views ───────────────────────────────────

	/** Current evaluation mode: `'expression'` when expression is non-null, else `'flat-map'`. */
	readonly mode: ReadonlySignal<EngineMode>;

	/** All currently-registered rule IDs (keys of `rules`). */
	readonly activeRuleIds: ReadonlySignal<readonly RuleId[]>;

	/**
	 * The current filtered results. Computed from `workingSet` + `effectiveExpression`, through the
	 * installed results accelerator when it engages and the predicate evaluator otherwise.
	 *
	 * **Derived from `resultIndices`.** To keep a single source of truth for "which workingSet
	 * positions pass the filter," `results` projects through `resultIndices` rather than running
	 * its own filter pass. This guarantees `results[i] === workingSet[resultIndices[i]]` for
	 * every i, which is the invariant the worker-bridge transferable-indices path
	 * (`getResultIndices()`) relies on.
	 */
	readonly results: ReadonlySignal<readonly T[]>;

	/**
	 * Positional indices into `workingSet` for each item in `results`. The natural sibling of
	 * `results` — same filter pass, different projection. Lives as a `Uint32Array` so it can be
	 * `postMessage`-transferred to the main thread with zero copy when the engine is hosted
	 * in a Web Worker (see `@filter-enginez/worker-bridge`'s `getResultIndices()` over the wire).
	 *
	 * @remarks
	 * Why Uint32Array, not number[]: a 130k-record corpus has at most 130k indices × 4 bytes =
	 * 520KB. That fits in a single transferable `ArrayBuffer`, which moves between threads in
	 * constant time regardless of payload size — vs ~110MB of structuredClone work to ship the
	 * full filtered Wine objects per filter tick.
	 */
	readonly resultIndices: ReadonlySignal<Uint32Array>;

	/**
	 * The effective expression, simplified (`composition/simplify`) — derived from `rules` +
	 * `groups` in flat-map mode (see `composition/composeFlatExpression`) or from `expression` in
	 * expression mode. `null` means no constraint: every working-set item passes.
	 */
	readonly effectiveExpression: ReadonlySignal<FilterRule | null>;

	/** `results.length`. */
	readonly resultCount: ReadonlySignal<number>;

	/** The installed accelerator, or `null` for predicate-only evaluation. */
	private _resultsAccelerator: ResultsAccelerator | null = null;
	// #endregion docs:internal-store-shape

	/**
	 * @param initialSourceData - Optional initial source data. Defaults to empty array.
	 */
	constructor(initialSourceData: readonly T[] = []) {
		this.sourceData = signal(initialSourceData);
		this.sourceDataVersion = signal(0);
		this.workingSet = signal(initialSourceData);
		this.workingSetVersion = signal(0);
		this.rules = signal(new Map());
		this.expression = signal(null);
		this.groups = signal([]);
		this.lastChangeRuleId = signal(null);
		this.lastChangeTimestamp = signal(null);

		this.mode = computed<EngineMode>(() =>
			this.expression.value !== null ? 'expression' : 'flat-map',
		);
		this.activeRuleIds = computed<readonly RuleId[]>(() => [...this.rules.value.keys()]);

		// #region docs:effective-expression
		// Derive the effective expression. Flat-map mode composes the registered rules with the
		// filter groups (each group's rules combine with its operator; groups and standalone rules
		// AND together). Expression mode uses the explicit tree. Either way the tree is simplified
		// before evaluation; `getExpression()` still returns the tree exactly as it was set.
		this.effectiveExpression = computed<FilterRule | null>(() => {
			const explicit = this.expression.value;
			const composed = explicit ?? composeFlatExpression(this.rules.value, this.groups.value);

			return composed === null ? null : simplify(composed);
		});
		// #endregion docs:effective-expression

		// Compute `resultIndices` as the single source of truth for "which workingSet positions
		// passed the filter." Single predicate pass over workingSet; emits a `Uint32Array` so
		// the worker-bridge can `postMessage`-transfer it without a copy in the worker-hosted
		// engine case.
		//
		// Identity case (no effective expression): the indices form a contiguous run
		// `0..workingSet.length-1`. We still allocate the Uint32Array — consumers depend on the
		// return type being uniformly Uint32Array regardless of mode.
		this.resultIndices = computed<Uint32Array>(() => {
			const expr = this.effectiveExpression.value;
			const ws = this.workingSet.value;

			if (expr === null) {
				const all = new Uint32Array(ws.length);

				for (let i = 0; i < ws.length; i++) {
					all[i] = i;
				}

				return all;
			}
			const accelerated = this._resultsAccelerator?.() ?? null;

			if (accelerated !== null) {
				return accelerated;
			}
			// Two-phase to avoid the unknown-final-length re-allocation cost of pushing into a
			// regular array then converting: stage matches in a plain number[] (V8's growth
			// strategy is fast), then snapshot into the right-sized Uint32Array at the end.
			const matched: number[] = [];

			for (let i = 0; i < ws.length; i++) {
				if (evaluateExpression(expr, ws[i])) {
					matched.push(i);
				}
			}

			return Uint32Array.from(matched);
		});

		// `results` projects through `resultIndices` rather than running its own filter pass.
		// This guarantees `results[i] === workingSet[resultIndices[i]]` for every i — the
		// invariant the transferable-indices path on the worker-bridge depends on.
		//
		// Identity fast-path: when no expression is active we return `workingSet` directly to
		// preserve the existing referential-stability behavior consumers rely on (e.g.,
		// React's memo bail-out for the unfiltered view).
		this.results = computed<readonly T[]>(() => {
			const expr = this.effectiveExpression.value;
			const ws = this.workingSet.value;

			if (expr === null) {
				return ws;
			}
			const idx = this.resultIndices.value;
			const out = new Array<T>(idx.length);

			for (let i = 0; i < idx.length; i++) {
				out[i] = ws[idx[i] as number] as T;
			}

			return out;
		});

		this.resultCount = computed<number>(() => this.resultIndices.value.length);
	}

	/**
	 * Install (or, with `null`, remove) the results accelerator. `FilterEngine` installs the
	 * bitmap path at construction. The accelerator must return exactly what the predicate
	 * evaluator would, so installing one never changes results — only how fast they arrive.
	 */
	setResultsAccelerator(accelerator: ResultsAccelerator | null): void {
		this._resultsAccelerator = accelerator;
	}
}
