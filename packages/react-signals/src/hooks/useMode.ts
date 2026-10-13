/**
 * `useMode` — subscribe to the engine's current evaluation mode (`'flat-map'` or `'expression'`).
 *
 * @packageDocumentation
 */

import { useFilterEngine } from './useFilterEngine.js';
import { useSignal } from './useSignal.js';

/**
 * Subscribe to the engine's current mode. `'flat-map'` means all registered rules are
 * implicitly AND-composed; `'expression'` means the explicit expression tree is evaluated.
 *
 * @returns The current mode
 *
 * @example
 *   function ModeIndicator() {
 *     const mode = useMode();
 *     return <Badge>{mode === 'expression' ? 'Custom expression' : 'Flat filters'}</Badge>;
 *   }
 */
export function useMode(): 'expression' | 'flat-map' {
	const engine = useFilterEngine();

	return useSignal(engine.mode);
}
