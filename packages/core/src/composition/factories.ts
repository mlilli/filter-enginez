/**
 * Composition factory functions — `and()`, `or()`, `not()`.
 *
 * @remarks
 * Ergonomic builders for constructing `CompositeRule` expression trees. These are how
 * consumers express filter algebra in real code:
 *
 * ```ts
 * engine.setExpression(
 *   and(
 *     or(inSet('color', ['red']), inSet('color', ['blue'])),
 *     range('price', { min: 20000, max: 30000 }),
 *     not(inSet('dealer', ['XYZ'])),
 *   ),
 * );
 * ```
 *
 * @packageDocumentation
 */

import type { FilterRule } from '../rules/FilterRule.js';

import { CompositeRule } from '../rules/CompositeRule.js';

/**
 * Compose rules with logical AND — items must pass EVERY child rule.
 *
 * @param rules - Child rules
 */
export function and(...rules: FilterRule[]): CompositeRule {
	return new CompositeRule('and', rules);
}

/**
 * Compose rules with logical OR — items must pass AT LEAST ONE child rule. An empty OR is
 * treated as a no-op (matches every item) by the evaluator, matching the engine's
 * "empty group does not constrain" semantics.
 *
 * @param rules - Child rules
 */
export function or(...rules: FilterRule[]): CompositeRule {
	return new CompositeRule('or', rules);
}

/**
 * Logical NOT — items pass when the child rule does NOT pass.
 *
 * @param rule - The child rule to invert
 */
export function not(rule: FilterRule): CompositeRule {
	return new CompositeRule('not', [rule]);
}
