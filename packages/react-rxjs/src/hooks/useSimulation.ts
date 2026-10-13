/**
 * `useSimulation` — wrap `engine.core.simulate(...)` in a hook that re-evaluates the
 * simulation whenever the underlying engine state changes.
 *
 * @remarks
 * Per `docs/architecture.md` §12.2. Mirror of `react-signals/useSimulation` over RxJS
 * streams — same surface, swap the adapter. The `useObservable` subscriptions on
 * `activeRules$` + `sourceData$` are the re-evaluation pulses; the actual simulation cache
 * lookup happens in core's `SimulationCache`.
 *
 * @packageDocumentation
 */

import type { SimulationModification, SimulationResult } from '@filter-enginez/core';

import { useMemo } from 'react';

import { useFilterEngine } from './useFilterEngine.js';
import { useObservable } from './useObservable.js';

/**
 * Compute the projected engine result for a hypothetical modification, reactively.
 *
 * @typeParam T - The item type the engine operates over
 * @param modification - The hypothetical modification to project
 * @returns The simulation result — projected count, sample, wouldBeEmpty flag, cache key
 */
export function useSimulation<T = unknown>(
	modification: SimulationModification,
): SimulationResult<T> {
	const engine = useFilterEngine<T>();

	useObservable(engine.activeRules$, engine.core.getRules());
	useObservable(engine.sourceData$, engine.core.getSourceData());
	// The dependency array intentionally lists `modification`'s structural fields rather than
	// the object reference, so a fresh-but-equivalent `modification` literal each render does
	// not invalidate the memo. (The `react-hooks` plugin is not active for `.ts` files, so this
	// is a deliberate, documented dependency choice, not a suppression.)
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
