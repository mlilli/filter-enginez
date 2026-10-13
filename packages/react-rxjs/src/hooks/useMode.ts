/**
 * `useMode` — subscribe to the engine's current evaluation mode (`'flat-map'` or `'expression'`).
 *
 * @packageDocumentation
 */

import { useFilterEngine } from './useFilterEngine.js';
import { useObservable } from './useObservable.js';

/**
 * Subscribe to the engine's current mode.
 *
 * @returns The current mode — `'flat-map'` (implicit AND of all rules) or `'expression'`
 *   (explicit expression tree)
 */
export function useMode(): 'expression' | 'flat-map' {
	const engine = useFilterEngine();
	const initial: 'expression' | 'flat-map' = engine.core.getExpression() !== null
		? 'expression'
		: 'flat-map';

	return useObservable<'expression' | 'flat-map'>(engine.mode$, initial);
}
