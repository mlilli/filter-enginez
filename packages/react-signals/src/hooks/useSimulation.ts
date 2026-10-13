/**
 * `useSimulation` — wrap `engine.core.simulate(...)` in a hook that re-evaluates the
 * simulation whenever the underlying engine state changes.
 *
 * @remarks
 * Per `docs/architecture.md` §12.1. The primary consumer is the "disable filter options
 * that would yield zero results" UX — render N option checkboxes, each calling
 * `useSimulation({ withRule: hypotheticalRule })` to decide its `disabled` prop. The
 * underlying `engine.core.simulate(...)` is memoized via `SimulationCache`, so N hook calls in a single render produce O(N) cache lookups rather than
 * O(N) full re-evaluations.
 *
 * **Re-evaluation triggers.** The hook subscribes to the engine's `activeRules` signal as
 * its dependency — when the active rule set changes, every `useSimulation` instance re-runs.
 * Source-data changes also trigger via the engine's signal cascade. Selection-value changes
 * within a rule (the `RULE_CHANGED` action) also propagate because the engine bumps
 * `activeRules` on every rule mutation, including in-place config swaps.
 *
 * @packageDocumentation
 */

import type { SimulationModification, SimulationResult } from '@filter-enginez/core';

import { useMemo } from 'react';

import { useFilterEngine } from './useFilterEngine.js';
import { useSignal } from './useSignal.js';

/**
 * Compute the projected engine result for a hypothetical modification, reactively.
 *
 * @typeParam T - The item type the engine operates over
 * @param modification - The hypothetical modification to project
 * @returns The simulation result — projected count, sample, wouldBeEmpty flag, cache key
 *
 * @example
 *   function VarietalCheckbox({ varietal }: { varietal: string }) {
 *     const { wouldBeEmpty, resultCount } = useSimulation<Wine>({
 *       withRule: ['varietal', inSet('varietal', [varietal])],
 *     });
 *     return (
 *       <label>
 *         <input type="checkbox" disabled={wouldBeEmpty} />
 *         {varietal} ({resultCount})
 *       </label>
 *     );
 *   }
 */
export function useSimulation<T = unknown>(
	modification: SimulationModification,
): SimulationResult<T> {
	const engine = useFilterEngine<T>();

	// Subscribe to activeRules so this hook re-runs when rules change. The actual evaluation
	// hits the engine's SimulationCache, so repeat calls within a single render with the
	// same modification are O(1).
	useSignal(engine.activeRules);
	// Source data changes via setSourceData also need to trigger re-evaluation.
	useSignal(engine.sourceData);
	// Memoize on the modification's content-affecting fields so consumers passing inline
	// objects don't waste cycles recomputing the cache key when nothing changed.
	// The dep array intentionally lists `modification`'s content-affecting fields rather than the
	// object identity, so inline-object callers don't thrash the memo. (`react-hooks/exhaustive-deps`
	// only runs on JSX files, so no disable directive is needed in this `.ts` hook module.)
	const stableMod = useMemo<SimulationModification>(
		() => modification,
		[
			modification.withRule?.[0],
			modification.withRule?.[1],
			modification.withoutRule,
			modification.withSourceData,
			modification.withExpression,
			modification.ignoreRules?.join(','),
		],
	);

	return engine.core.simulate(stableMod);
}
