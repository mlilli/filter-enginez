/**
 * `filteredFieldValuesExcept` — the "filtered-except-self" projection behind
 * `FilterEngine.getFilteredFieldValuesExcept`.
 *
 * @remarks
 * Kept out of `FilterEngine.ts` so the facade stays a thin coordinator. The projection
 * evaluates the flat-map filter with one rule left out — composed with the filter groups exactly
 * as `effectiveExpression` composes it — and collects one numeric field from each surviving
 * item. It powers per-slider available bounds: a slider's limits come from every OTHER filter,
 * so dragging it never moves its own limits.
 *
 * @packageDocumentation
 */

import type { FilterGroup } from './composition/FilterGroup.js';
import type { FilterRule } from './rules/FilterRule.js';
import type { RuleId } from './types.js';

import { composeFlatExpression } from './composition/composeFlatExpression.js';
import { evaluateExpression } from './composition/ExpressionEvaluator.js';

/**
 * Collect the finite values of `fieldKey` over the working-set items that pass every
 * registered rule except `excludeRuleId` (filter groups applied).
 *
 * @param workingSet - The items to filter
 * @param rules - The registered rules
 * @param groups - The registered filter groups
 * @param excludeRuleId - The rule to leave out; an unregistered id leaves nothing out
 * @param fieldKey - The top-level property to read from each surviving item
 * @returns The finite numbers found, in working-set order
 */
export function filteredFieldValuesExcept<T>(
	workingSet: readonly T[],
	rules: ReadonlyMap<RuleId, FilterRule>,
	groups: readonly FilterGroup[],
	excludeRuleId: RuleId,
	fieldKey: keyof T & string,
): readonly number[] {
	const remaining = new Map(rules);

	remaining.delete(excludeRuleId);
	const expression = composeFlatExpression(remaining, groups);
	const out: number[] = [];

	for (const item of workingSet) {
		if (expression !== null && !evaluateExpression(expression, item)) {
			continue;
		}
		const value = (item as Record<string, unknown>)[fieldKey];

		if (typeof value === 'number' && Number.isFinite(value)) {
			out.push(value);
		}
	}

	return out;
}
