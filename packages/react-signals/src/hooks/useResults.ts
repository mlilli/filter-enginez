/**
 * `useResults` — subscribe a component to the engine's current filtered results.
 *
 * @packageDocumentation
 */

import { useFilterEngine } from './useFilterEngine.js';
import { useSignal } from './useSignal.js';

/**
 * Subscribe to the engine's filtered results. The component re-renders whenever the result
 * set changes (rules added/removed/changed, source data replaced, working set substituted).
 *
 * @typeParam T - The item type the engine operates over
 * @returns The current filtered results array
 *
 * @example
 *   function ResultsGrid() {
 *     const results = useResults<Wine>();
 *     return <ul>{results.map(w => <li key={w.id}>{w.name}</li>)}</ul>;
 *   }
 */
export function useResults<T = unknown>(): readonly T[] {
	const engine = useFilterEngine<T>();

	return useSignal(engine.results);
}
