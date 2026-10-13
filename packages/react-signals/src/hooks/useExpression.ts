/**
 * `useExpression` — subscribe to the engine's current explicit expression tree (or `null` in
 * flat-map mode).
 *
 * @packageDocumentation
 */

import type { CompositeRule } from '@filter-enginez/core';

import { useFilterEngine } from './useFilterEngine.js';
import { useSignal } from './useSignal.js';

/**
 * Subscribe to the engine's current explicit expression. Returns `null` when the engine is in
 * flat-map mode (no `setExpression` has been called or the expression has been cleared).
 *
 * @returns The current expression tree, or `null` in flat-map mode
 *
 * @example
 *   function ExpressionInspector() {
 *     const expression = useExpression();
 *     if (!expression) return <p>Flat-map mode (implicit AND of all rules)</p>;
 *     return <ExpressionTree node={expression} />;
 *   }
 */
export function useExpression(): CompositeRule | null {
	const engine = useFilterEngine();

	return useSignal(engine.expression);
}
