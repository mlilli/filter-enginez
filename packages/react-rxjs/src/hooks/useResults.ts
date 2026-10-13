/**
 * `useResults` — subscribe a component to the engine's current filtered results stream.
 *
 * @packageDocumentation
 */

import { useFilterEngine } from './useFilterEngine.js';
import { useObservable } from './useObservable.js';

/**
 * Subscribe to the engine's filtered results.
 *
 * @typeParam T - The item type the engine operates over
 * @returns The current filtered results array (or `[]` until the first emission lands)
 *
 * @example
 *   function ResultsGrid() {
 *     const results = useResults<Wine>();
 *     return <ul>{results.map(w => <li key={w.id}>{w.name}</li>)}</ul>;
 *   }
 */
export function useResults<T = unknown>(): readonly T[] {
	const engine = useFilterEngine<T>();

	return useObservable<readonly T[]>(engine.results$, engine.core.getResults());
}
