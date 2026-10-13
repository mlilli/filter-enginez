/**
 * `CompositeRule` — Boolean composition of other rules (AND / OR / NOT).
 *
 * @remarks
 * Implements the Composite + Interpreter patterns (GoF Structural + Behavioral, per
 * `docs/architecture.md` §18). Wraps a list of child rules with a Boolean operator; recursive
 * children are themselves `CompositeRule` instances forming an expression tree.
 *
 * The ergonomic builders `and(...)`, `or(...)`, `not(...)` live in `composition/factories.ts`;
 * the recursive evaluator is `composition/ExpressionEvaluator.ts`, and algebraic simplification
 * (`simplify`) runs on the store's effective expression. See `docs/architecture.md` §5 for the
 * evaluator behavior and the public algebra API.
 *
 * @packageDocumentation
 */

import type { FilterRuleAction, SerializedRule } from '../types.js';

import { evaluateExpression } from '../composition/ExpressionEvaluator.js';
import { FilterRule } from './FilterRule.js';

// #region docs:composite-rule-class
/**
 * Boolean composition operators.
 */
export type CompositionOp = 'and' | 'not' | 'or';

/**
 * Configuration for `CompositeRule`.
 */
export interface CompositeRuleConfig {
	readonly op: CompositionOp;
	readonly rules: readonly FilterRule[];
}

/**
 * Composite filter rule — combines child rules via AND / OR / NOT.
 *
 * @example
 *   // (color in {red, blue}) AND (price in [20k, 30k]) AND NOT (dealer = 'XYZ')
 *   const expr = and(
 *     or(inSet('color', ['red']), inSet('color', ['blue'])),
 *     range('price', { min: 20000, max: 30000 }),
 *     not(inSet('dealer', ['XYZ'])),
 *   );
 *   engine.setExpression(expr);
 *
 * @remarks
 * `CompositeRule` is itself a `FilterRule`, so it can be used anywhere a rule can — including
 * as a child of another `CompositeRule` (recursive composition).
 *
 * Per-item evaluation goes through `evaluateExpression`, the predicate-style recursive walker.
 * At the engine level, flat conjunctions are answered by the bitmap path when it is engaged
 * (`BitmapIndex.tryComputeResults`); expressions are answered by the evaluator.
 */
export class CompositeRule extends FilterRule {
	/**
	 * Minifier-proof wire name — see {@link FilterRule.ruleTypeName}. Declared as a literal so
	 * `ruleRegistry.register` can reject a key that disagrees with it at compile time.
	 */
	static override readonly ruleTypeName = 'CompositeRule';

	config: CompositeRuleConfig;

	/**
	 * @param op - The composition operator (`'and'` / `'or'` / `'not'`)
	 * @param rules - Child rules to compose
	 */
	constructor(op: CompositionOp, rules: readonly FilterRule[]) {
		super(undefined);
		this.config = { op, rules };
	}

	/**
	 * Predicate evaluation — recursively evaluates child rules per the composition operator
	 * via `evaluateExpression` (see `composition/ExpressionEvaluator.ts`).
	 */
	override action: FilterRuleAction = (item, rule): boolean => {
		return evaluateExpression(rule, item);
	};

	/**
	 * Recursively serialize the composite and every child into a fully plain, JSON-safe tree.
	 *
	 * @remarks
	 * The inherited `FilterRule.serialize()` returns `config` by reference, which for a composite
	 * carries live child `FilterRule` instances — each holding a non-cloneable `action` function.
	 * That form throws `DataCloneError` the moment it crosses a `structuredClone` boundary (the
	 * worker-bridge postMessage path, URL-state, devtools persistence) and can't be rebuilt into
	 * working instances. Serializing each child into its own `SerializedRule` yields a plain tree;
	 * `ruleRegistry.deserialize` mirrors this by recursively reviving composite children.
	 */
	override serialize(): SerializedRule {
		return {
			config: {
				op: this.config.op,
				rules: this.config.rules.map((rule) => rule.serialize()),
			},
			field: undefined,
			type: CompositeRule.ruleTypeName,
		};
	}
}
// #endregion docs:composite-rule-class
