/**
 * `evaluateExpression` — recursive Boolean evaluator for `CompositeRule` trees.
 *
 * @remarks
 * Implements the Interpreter pattern (GoF Behavioral, per `docs/architecture.md` §18). The
 * grammar is `(and | or | not) of rules`; the evaluator walks the tree applying the
 * appropriate Boolean operation. Leaf rules (any non-`CompositeRule` `FilterRule`) delegate
 * to their `action` predicate.
 *
 * **Empty-operand semantics** match the engine's "empty group does not constrain" rule:
 *   - `and()` with zero children → `true` (no constraint applied)
 *   - `or()` with zero children → `true` (degenerate; treated as no constraint)
 *   - `not()` with zero children → `true` (degenerate)
 *
 * This is the **predicate-style** evaluator — runs `rule.action()` per item. When bitmap
 * acceleration is engaged, the store answers flat conjunctions from `internals/BitmapIndex`
 * (`tryComputeResults`) instead and falls back to this evaluator otherwise — same results
 * either way.
 *
 * @packageDocumentation
 */

import type { FilterRule } from '../rules/FilterRule.js';

import { CompositeRule } from '../rules/CompositeRule.js';

// #region docs:evaluate-expression
/**
 * Recursively evaluate a rule (composite or leaf) against an item, returning whether the item
 * passes the rule.
 *
 * @param rule - The rule (or composite tree) to evaluate
 * @param item - The item under test
 * @returns `true` if the item passes, `false` if filtered out
 */
export function evaluateExpression(rule: FilterRule, item: unknown): boolean {
	if (rule instanceof CompositeRule) {
		const { op, rules: childRules } = rule.config;

		switch (op) {
			case 'and':
				return childRules.every((child) => evaluateExpression(child, item));
			case 'not': {
				const [firstChild] = childRules;

				return firstChild === undefined ? true : !evaluateExpression(firstChild, item);
			}
			case 'or':
				return childRules.length === 0 ? true : childRules.some((child) => evaluateExpression(child, item));
		}
	}

	// Leaf — delegate to the rule's own predicate
	return rule.action(item, rule);
}
// #endregion docs:evaluate-expression

/**
 * Apply a rule (or composite tree) to a working set, returning the filtered subset.
 *
 * @param rule - The rule to filter with
 * @param items - The working-set items
 * @returns A new array of items that pass the rule
 */
export function applyExpression<T>(rule: FilterRule, items: readonly T[]): readonly T[] {
	return items.filter((item) => evaluateExpression(rule, item));
}
