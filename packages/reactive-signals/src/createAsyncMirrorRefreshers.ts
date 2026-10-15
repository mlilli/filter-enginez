/**
 * `createAsyncMirrorRefreshers` — the event-type-aware mirror-refresh helpers for the
 * worker-backed signals adapter (`createSignalsEngineFromAsync`).
 *
 * @remarks
 * The adapter mirrors the worker engine's state into local `@preact/signals-core` signals so
 * React renders are synchronous. After every engine `ChangeEvent`, the adapter pulls only the
 * slice of state that event touched — a rule mutation refetches rules + results + count, an
 * expression change refetches expression + results + count, etc. `refreshEverything` is the only
 * path that re-pulls the full corpus (used by `reset` and time-travel).
 *
 * **The bandwidth contract.** Every post-boot refresh ships indices (`Uint32Array`,
 * postMessage-transferred zero-copy) rather than re-shipping the full filtered objects, then
 * joins those indices against the resident `workingSet` mirror via `projectResults`. Extracted
 * from `createSignalsEngineFromAsync.ts` to keep both modules under the 500-line cap without
 * changing behavior.
 *
 * @packageDocumentation
 */

import {
	type CompositeRule,
	type FilterGroup,
	type FilterRule,
	type RuleId,
} from '@filter-enginez/core';
import {
	createWireRehydrator,
	type FilterEngineAsync,
	type WireActionLogEntry,
	type WireDevtoolsState,
} from '@filter-enginez/worker-bridge';
import { batch, type Signal } from '@preact/signals-core';

/**
 * The adapter-owned writable mirror signals + collaborators the refreshers write through.
 *
 * @typeParam T - The item type the underlying engine operates over
 */
export interface AsyncMirrorRefresherContext<T> {
	// ─── Writable mirror signals (written by the refreshers under `batch`) ───
	readonly actionLogSignal: Signal<readonly WireActionLogEntry[]>;
	readonly activeRuleIdsSignal: Signal<readonly RuleId[]>;
	readonly activeRulesSignal: Signal<ReadonlyMap<RuleId, FilterRule>>;
	/** The worker-hosted engine the refreshers pull state from. */
	readonly asyncEngine: FilterEngineAsync<T>;
	readonly devtoolsStateSignal: Signal<WireDevtoolsState>;
	readonly expressionSignal: Signal<CompositeRule | null>;
	/** Live read of the adapter's `isDisposed` flag (routed through an accessor to defeat narrowing). */
	readonly getIsDisposed: () => boolean;
	readonly groupsSignal: Signal<readonly FilterGroup[]>;
	readonly modeSignal: Signal<'expression' | 'flat-map'>;
	readonly resultCountSignal: Signal<number>;
	readonly resultsSignal: Signal<readonly T[]>;
	readonly sourceDataSignal: Signal<readonly T[]>;
	readonly workingSetSignal: Signal<readonly T[]>;
}

/**
 * The bundle of refresh helpers + the two pure transforms they depend on.
 *
 * @typeParam T - The item type the underlying engine operates over
 */
export interface AsyncMirrorRefreshers<T> {
	/** Reconstruct real `FilterRule` instances from the worker's pre-serialized rule map. */
	readonly deserializeRules: (
		raw: ReadonlyMap<RuleId, FilterRule>,
	) => ReadonlyMap<RuleId, FilterRule>;
	/** Hydrate a results array from a transferred index array by joining against the workingSet. */
	readonly projectResults: (indices: Uint32Array, workingSet: readonly T[]) => readonly T[];
	readonly refreshDevtools: () => Promise<void>;
	readonly refreshEverything: () => Promise<void>;
	readonly refreshExpressionAndResults: () => Promise<void>;
	readonly refreshResultsAndCount: () => Promise<void>;
	readonly refreshRulesAndResults: () => Promise<void>;
	readonly refreshSourceAndDerived: () => Promise<void>;
}

/**
 * Build the mirror-refresh helpers for a worker-backed signals adapter.
 *
 * @typeParam T - The item type the underlying engine operates over
 * @param ctx - The adapter's writable mirror signals + async engine + disposed accessor
 * @returns The refresh helpers + the two pure transforms (`deserializeRules`, `projectResults`)
 */
export function createAsyncMirrorRefreshers<T>(
	ctx: AsyncMirrorRefresherContext<T>,
): AsyncMirrorRefreshers<T> {
	const {
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
	} = ctx;

	// Both transforms come from `worker-bridge`, shared with the RxJS adapter, so the two adapters
	// cannot rehydrate wire rules differently. Why the expression falls back to the RAW value while
	// a rule is skipped is explained in `createWireRehydrator`'s own docblock.
	const { expression: deserializeExpression, rules: deserializeRules } = createWireRehydrator(
		'createSignalsEngineFromAsync',
	);

	// ─── Indices → results projection ──────────────────────────────────────
	// Hydrate a results array from a transferred Uint32Array of indices by joining against
	// the currently-resident workingSet mirror (which doubles as sourceData when no working-
	// set substitution is active).
	//
	// **Why preallocate + loop, not `.map`.** In a one-off V8 micro-measurement at 130k indices (not
	// part of `benchmarks/`), the `.map` allocation pattern (sparse growth, bounds-check on each
	// write) ran ~1.5x slower than a preallocated `new Array(idx.length)` + indexed write. The hot
	// path runs on every rule:changed event during slider drag — every saved millisecond counts.
	//
	// **Identity fast path.** When the indices array length matches the workingSet length AND
	// the engine has no expression active, the indices form a 0..N-1 run. Returning the
	// workingSet array directly preserves referential stability (same Array identity), which
	// helps React's bail-out in components that memoize on `results === prevResults`.
	const projectResults = (indices: Uint32Array, workingSet: readonly T[]): readonly T[] => {
		if (indices.length === workingSet.length) {
			return workingSet;
		}
		const out = new Array<T>(indices.length);

		for (let i = 0; i < indices.length; i++) {
			out[i] = workingSet[indices[i] as number] as T;
		}

		return out;
	};

	const refreshResultsAndCount = async (): Promise<void> => {
		if (getIsDisposed()) {
			return;
		}
		// Ship indices, not full results. The count comes for free from `indices.length` so
		// we don't need a separate `getResultCount()` round-trip.
		const indices = await asyncEngine.getResultIndices();

		if (getIsDisposed()) {
			return;
		}
		const ws = workingSetSignal.value;
		const projected = projectResults(indices, ws);

		batch(() => {
			resultsSignal.value = projected;
			resultCountSignal.value = indices.length;
		});
	};

	const refreshRulesAndResults = async (): Promise<void> => {
		if (getIsDisposed()) {
			return;
		}
		// Parallel pull: rules + ids in flight together with the indices transfer. No
		// `getResults()` — derive from indices.
		const [arSerialized, ari, indices] = await Promise.all([
			asyncEngine.getRules(),
			asyncEngine.getActiveRuleIds(),
			asyncEngine.getResultIndices(),
		]);

		if (getIsDisposed()) {
			return;
		}
		const ar = deserializeRules(arSerialized);
		const projected = projectResults(indices, workingSetSignal.value);

		batch(() => {
			activeRulesSignal.value = ar;
			activeRuleIdsSignal.value = ari;
			resultsSignal.value = projected;
			resultCountSignal.value = indices.length;
		});
	};

	const refreshExpressionAndResults = async (): Promise<void> => {
		if (getIsDisposed()) {
			return;
		}
		const [ex, indices] = await Promise.all([
			asyncEngine.getExpression(),
			asyncEngine.getResultIndices(),
		]);

		if (getIsDisposed()) {
			return;
		}
		const projected = projectResults(indices, workingSetSignal.value);

		batch(() => {
			expressionSignal.value = deserializeExpression(ex);
			// Mode reads the RAW value's presence, so a rehydration failure cannot flip the engine's
			// reported mode — only the shape of the object consumers receive.
			modeSignal.value = ex !== null ? 'expression' : 'flat-map';
			resultsSignal.value = projected;
			resultCountSignal.value = indices.length;
		});
	};

	const refreshSourceAndDerived = async (): Promise<void> => {
		if (getIsDisposed()) {
			return;
		}
		// SourceData mutation is the one case where we MUST re-pull the corpus — the worker's
		// new source is the authoritative truth for what indices reference. After re-pulling
		// source, re-project results from indices against the fresh workingSet.
		const [s, indices] = await Promise.all([
			asyncEngine.getSourceData(),
			asyncEngine.getResultIndices(),
		]);

		if (getIsDisposed()) {
			return;
		}
		const projected = projectResults(indices, s);

		batch(() => {
			sourceDataSignal.value = s;
			workingSetSignal.value = s;
			resultsSignal.value = projected;
			resultCountSignal.value = indices.length;
		});
	};

	/**
	 * Re-pull the worker's action log + devtools cursor state into our local mirrors.
	 * Cheap call — the wire-safe payload is ~10s of bytes per entry, capped at the worker's
	 * `actionLogSize` (default 100). Fired after every engine event so the devtools panel
	 * always sees current state without explicit subscription on its side.
	 */
	const refreshDevtools = async (): Promise<void> => {
		if (getIsDisposed()) {
			return;
		}
		const [log, state] = await Promise.all([
			asyncEngine.getActionLogSnapshot(),
			asyncEngine.getDevtoolsState(),
		]);

		if (getIsDisposed()) {
			return;
		}
		batch(() => {
			actionLogSignal.value = log;
			devtoolsStateSignal.value = state;
		});
	};

	const refreshEverything = async (): Promise<void> => {
		if (getIsDisposed()) {
			return;
		}
		// Reset path — re-pull sourceData too. Cost is paid by the consumer's explicit reset,
		// not by per-tick rule events.
		const [s, indices, arSerialized, ari, ex, gs] = await Promise.all([
			asyncEngine.getSourceData(),
			asyncEngine.getResultIndices(),
			asyncEngine.getRules(),
			asyncEngine.getActiveRuleIds(),
			asyncEngine.getExpression(),
			asyncEngine.getGroups(),
		]);

		if (getIsDisposed()) {
			return;
		}
		const ar = deserializeRules(arSerialized);
		const projected = projectResults(indices, s);

		batch(() => {
			sourceDataSignal.value = s;
			workingSetSignal.value = s;
			resultsSignal.value = projected;
			resultCountSignal.value = indices.length;
			activeRulesSignal.value = ar;
			activeRuleIdsSignal.value = ari;
			expressionSignal.value = deserializeExpression(ex);
			// Mode reads the RAW value's presence, so a rehydration failure cannot flip the engine's
			// reported mode — only the shape of the object consumers receive.
			modeSignal.value = ex !== null ? 'expression' : 'flat-map';
			groupsSignal.value = gs;
		});
	};

	return {
		deserializeRules,
		projectResults,
		refreshDevtools,
		refreshEverything,
		refreshExpressionAndResults,
		refreshResultsAndCount,
		refreshRulesAndResults,
		refreshSourceAndDerived,
	};
}
