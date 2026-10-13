/**
 * `ExistsRule` — passes items whose extracted field value is not `null` and not `undefined`.
 *
 * @remarks
 * The classic "has a value" toggle — useful for filters like "items with a photo," "users with
 * an email," "products with reviews." Conceptually simple; deserves a dedicated rule class so
 * consumer code reads as `exists('photoUrl')` instead of `predicate('photoUrl', isNotNil)`.
 *
 * Counter-intuitively, an empty string `''`, the number `0`, and the boolean `false` all PASS
 * this rule — they're not null or undefined. To test for "truthy" specifically, use a
 * `PredicateRule` or `BooleanRule`.
 *
 * @packageDocumentation
 */

import type { FilterRuleAction } from '../types.js';

import { FilterRule } from './FilterRule.js';

// #region docs:exists-rule
/**
 * Filter items by presence — passes when the extracted field is neither null nor undefined.
 *
 * @example
 *   // Items that have a photoUrl set:
 *   engine.addRule('has-photo', new ExistsRule('photoUrl'));
 */
export class ExistsRule extends FilterRule {
	/**
	 * Minifier-proof wire name — see {@link FilterRule.ruleTypeName}. Declared as a literal so
	 * `ruleRegistry.register` can reject a key that disagrees with it at compile time.
	 */
	static override readonly ruleTypeName = 'ExistsRule';

	/** Passes when the field value is neither `null` nor `undefined`. */
	override action: FilterRuleAction = (item): boolean => {
		const value = this.getFieldValue(item);

		return value !== null && value !== undefined;
	};

	/** No configuration needed — the rule's behavior is fully determined by the field extractor. */
	config: undefined = undefined;
}
// #endregion docs:exists-rule
