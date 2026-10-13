/**
 * `useExpression` — subscribe to the engine's current explicit expression tree (or `null` in
 * flat-map mode).
 *
 * @packageDocumentation
 */

import type { CompositeRule } from '@filter-enginez/core';

import { useFilterEngine } from './useFilterEngine.js';
import { useObservable } from './useObservable.js';

/**
 * Subscribe to the engine's current explicit expression. Returns `null` when the engine is in
 * flat-map mode.
 *
 * @returns The current expression tree, or `null` in flat-map mode
 */
export function useExpression(): CompositeRule | null {
	const engine = useFilterEngine();

	return useObservable<CompositeRule | null>(engine.expression$, engine.core.getExpression());
}
