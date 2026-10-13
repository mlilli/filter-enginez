/**
 * `BooleanRule` — typed convenience for boolean equality.
 *
 * @remarks
 * Functionally equivalent to `ValueRule<boolean>`, but the dedicated class:
 *   - Gives consumers a more obvious choice for "yes/no" filters
 *   - Lets the registry / serialization layer distinguish boolean intent from generic equality
 *   - Reads better in JSON config (`"type": "BooleanRule"` vs `"type": "ValueRule"` for a flag)
 *
 * @packageDocumentation
 */

import type { FieldExtractor, FilterRuleAction } from '../types.js';

import { FilterRule } from './FilterRule.js';

// #region docs:boolean-rule
/**
 * Filter items by a boolean field equality.
 *
 * @example
 *   // Items where `available === true`:
 *   engine.addRule('available', new BooleanRule('available', true));
 */
export class BooleanRule extends FilterRule {
	/**
	 * Minifier-proof wire name — see {@link FilterRule.ruleTypeName}. Declared as a literal so
	 * `ruleRegistry.register` can reject a key that disagrees with it at compile time.
	 */
	static override readonly ruleTypeName = 'BooleanRule';

	/** Passes when the field value is exactly `config`; passes everything when `config` is `undefined`. */
	override action: FilterRuleAction = (item, rule): boolean => {
		const { config: mustEqual } = rule as BooleanRule;

		if (mustEqual === undefined) {
			return true;
		}

		return this.getFieldValue(item) === mustEqual;
	};

	/** The configured boolean to match. `undefined` makes the rule a no-op. */
	config: boolean | undefined;

	/**
	 * @param field - How to pull the boolean from each item
	 * @param value - The boolean to match, or `undefined` for a no-op rule
	 */
	constructor(field: FieldExtractor, value: boolean | undefined) {
		super(field);
		this.config = value;
	}
}
// #endregion docs:boolean-rule
