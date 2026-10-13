/**
 * `useActiveRules` — subscribe to the engine's current rule map.
 *
 * @packageDocumentation
 */

import type { FilterRule, RuleId } from '@filter-enginez/core';

import { useFilterEngine } from './useFilterEngine.js';
import { useSignal } from './useSignal.js';

/**
 * Subscribe to the engine's currently-registered rules. The component re-renders whenever a
 * rule is added, removed, or changed.
 *
 * @returns A `ReadonlyMap<RuleId, FilterRule>` of all registered rules
 *
 * @example
 *   function ActiveFilterChips() {
 *     const rules = useActiveRules();
 *     return (
 *       <div>
 *         {[...rules].map(([id, rule]) => (
 *           <Chip key={id} ruleId={id} rule={rule} />
 *         ))}
 *       </div>
 *     );
 *   }
 *
 * @remarks
 * For components that only care about ONE rule, prefer `useRule(id)` — re-renders only when
 * that specific rule changes (vs `useActiveRules()` which re-renders on every rule mutation,
 * including unrelated ones).
 */
export function useActiveRules(): ReadonlyMap<RuleId, FilterRule> {
	const engine = useFilterEngine();

	return useSignal(engine.activeRules);
}
