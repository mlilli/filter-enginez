/**
 * `useResultCount` — subscribe to the result-set length without pulling in the full results
 * array on every change.
 *
 * @packageDocumentation
 */

import { useFilterEngine } from './useFilterEngine.js';
import { useObservable } from './useObservable.js';

/**
 * Subscribe to the engine's current result count.
 *
 * @returns The current result count
 *
 * @example
 *   function ResultsSummary() {
 *     const count = useResultCount();
 *     return <p>{count.toLocaleString()} matches</p>;
 *   }
 */
export function useResultCount(): number {
	const engine = useFilterEngine();

	return useObservable<number>(engine.resultCount$, engine.core.getResultCount());
}
