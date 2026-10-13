/**
 * `useActiveRules` — subscribe to the engine's current rule map stream.
 *
 * @packageDocumentation
 */

import type { FilterRule, RuleId } from '@filter-enginez/core';

import { useFilterEngine } from './useFilterEngine.js';
import { useObservable } from './useObservable.js';

/**
 * Subscribe to the engine's currently-registered rules.
 *
 * @returns A `ReadonlyMap<RuleId, FilterRule>` of all registered rules
 *
 * @remarks
 * For components that only care about ONE rule, prefer `useRule(id)` — re-renders only when
 * that specific rule changes.
 */
export function useActiveRules(): ReadonlyMap<RuleId, FilterRule> {
	const engine = useFilterEngine();

	return useObservable<ReadonlyMap<RuleId, FilterRule>>(
		engine.activeRules$,
		engine.core.getRules(),
	);
}
