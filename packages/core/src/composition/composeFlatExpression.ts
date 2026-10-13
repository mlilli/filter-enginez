/**
 * `composeFlatExpression` — the flat-map-mode filter expression, with filter groups folded in.
 *
 * @remarks
 * In flat-map mode the engine's filter is "every registered rule must pass", except that rules
 * named by a {@link FilterGroup} are first combined with that group's own operator. A rule that
 * no group names is a standalone conjunct; each group contributes one conjunct built from the
 * rules it names that are currently registered. The result is the expression
 * `and(...standaloneRules, ...groups.map((g) => op_g(...g.rules)))` — exactly what
 * `setExpression(and(...groups.map((g) => or(...g))))` would build by hand.
 *
 * Shared by the store's `effectiveExpression`, the simulation fallback, and the
 * filtered-except-self projection, so all three agree on what a group means.
 *
 * @packageDocumentation
 */

import type { FilterRule } from '../rules/FilterRule.js';
import type { RuleId } from '../types.js';
import type { FilterGroup } from './FilterGroup.js';

import { CompositeRule } from '../rules/CompositeRule.js';

/**
 * Collapse a conjunct list into one rule: `null` for no constraint, the sole rule for one, and an
 * `and` composite otherwise.
 */
function conjoin(conjuncts: readonly FilterRule[]): FilterRule | null {
	const [first] = conjuncts;

	if (first === undefined) {
		return null;
	}

	return conjuncts.length === 1 ? first : new CompositeRule('and', conjuncts);
}

// #region docs:compose-flat-expression
/**
 * Build the flat-map-mode expression for a rule map and a group list.
 *
 * @param rules - The registered rules, in registration order
 * @param groups - The registered filter groups, in registration order
 * @returns `null` when no rule is registered; the lone rule when exactly one conjunct remains;
 *   otherwise an `and` composite. A group whose named rules are all unregistered contributes
 *   nothing, and a group with one registered rule contributes that rule unwrapped.
 */
export function composeFlatExpression(
	rules: ReadonlyMap<RuleId, FilterRule>,
	groups: readonly FilterGroup[],
): FilterRule | null {
	if (groups.length === 0) {
		return conjoin([...rules.values()]);
	}
	const grouped = new Set<RuleId>();
	const groupConjuncts: FilterRule[] = [];

	for (const group of groups) {
		const members: FilterRule[] = [];

		for (const id of new Set(group.filterIds)) {
			grouped.add(id);
			const rule = rules.get(id);

			if (rule !== undefined) {
				members.push(rule);
			}
		}
		const [onlyMember] = members;

		if (onlyMember === undefined) {
			continue;
		}
		groupConjuncts.push(members.length === 1 ? onlyMember : new CompositeRule(group.composition, members));
	}
	const standalone: FilterRule[] = [];

	for (const [id, rule] of rules) {
		if (!grouped.has(id)) {
			standalone.push(rule);
		}
	}

	return conjoin([...standalone, ...groupConjuncts]);
}
// #endregion docs:compose-flat-expression

/**
 * Whether the groups leave the flat-map filter a plain conjunction of the given rule ids — true
 * unless some `'or'` group names two or more of them. The acceleration paths that AND per-rule
 * bitmaps (and the single-pass bundle query) are exact only for a conjunction, so they consult
 * this before engaging and fall back to the expression evaluator otherwise.
 *
 * @param ruleIds - The rule ids in effect (registered ids, adjusted for any hypothetical change)
 * @param groups - The registered filter groups
 */
export function isConjunctive(ruleIds: Iterable<RuleId>, groups: readonly FilterGroup[]): boolean {
	if (groups.length === 0) {
		return true;
	}
	const present = new Set(ruleIds);

	for (const group of groups) {
		if (group.composition !== 'or') {
			continue;
		}
		let count = 0;

		for (const id of new Set(group.filterIds)) {
			if (present.has(id)) {
				count++;
			}
		}
		if (count >= 2) {
			return false;
		}
	}

	return true;
}
