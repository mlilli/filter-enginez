/**
 * `useResultCount` — subscribe to just the result-set length without pulling in the full
 * results array on every change.
 *
 * @packageDocumentation
 */

import { useFilterEngine } from './useFilterEngine.js';
import { useSignal } from './useSignal.js';

/**
 * Subscribe to the engine's current result count. Cheaper than `useResults().length` because
 * the underlying signal updates only when the count changes, not on every result-set mutation
 * that leaves the count constant (e.g., a rule swap that produces the same number of matches).
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

	return useSignal(engine.resultCount);
}
