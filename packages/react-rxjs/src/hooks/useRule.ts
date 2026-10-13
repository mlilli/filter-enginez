/**
 * `useRule` — subscribe to a single rule by id. Re-renders only when that specific rule
 * changes, not when unrelated rules are mutated.
 *
 * @packageDocumentation
 */

import type { FilterRule, RuleId } from '@filter-enginez/core';

import { useFilterEngine } from './useFilterEngine.js';
import { useObservable } from './useObservable.js';

/**
 * Subscribe to a specific rule by id.
 *
 * @param ruleId - The rule id to track
 * @returns The current rule at that id, or `undefined` if not registered
 *
 * @remarks
 * The underlying per-rule stream is memoized in `RxJsEngine` — calling `useRule('foo')` from
 * multiple components shares one `distinctUntilChanged` derivation, so per-rule subscriptions
 * stay cheap regardless of consumer count.
 */
export function useRule(ruleId: RuleId): FilterRule | undefined {
	const engine = useFilterEngine();

	return useObservable<FilterRule | undefined>(engine.rule$(ruleId), engine.core.getRule(ruleId));
}
