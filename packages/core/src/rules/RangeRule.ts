/**
 * `RangeRule` — numeric range filter, inclusive on both bounds.
 *
 * @remarks
 * Passes items whose extracted field value is a number `n` satisfying `min <= n <= max`.
 * For exclusive bounds, use `NumericComparisonRule` instead.
 *
 * For date ranges, use `DateRangeRule` (which handles parsing + timezone semantics + preset
 * relative ranges like "last 7 days").
 *
 * @packageDocumentation
 */

import type { FieldExtractor, FilterRuleAction } from '../types.js';

import { FilterRule } from './FilterRule.js';

// #region docs:range-rule
/**
 * Configuration for `RangeRule`.
 */
export interface RangeRuleConfig {
	/** Lower bound, inclusive. Use `-Infinity` for unbounded-low. */
	readonly min: number;
	/** Upper bound, inclusive. Use `Infinity` for unbounded-high. */
	readonly max: number;
}

/**
 * Filter items by an inclusive numeric range.
 *
 * @example
 *   // Items where 20000 <= price <= 30000:
 *   engine.addRule('price', new RangeRule('price', { min: 20000, max: 30000 }));
 *
 *   // Items where rating >= 4:
 *   engine.addRule('rating', new RangeRule('rating', { min: 4, max: Infinity }));
 */
export class RangeRule extends FilterRule {
	/**
	 * Minifier-proof wire name — see {@link FilterRule.ruleTypeName}. Declared as a literal so
	 * `ruleRegistry.register` can reject a key that disagrees with it at compile time.
	 */
	static override readonly ruleTypeName = 'RangeRule';

	config: RangeRuleConfig;

	/** Passes when the field value lies within `[min, max]`, both inclusive; a `null` or missing value fails. */
	override action: FilterRuleAction = (item, rule): boolean => {
		const value = this.getFieldValue(item);

		if (value === undefined || value === null) {
			return false;
		}
		const numericValue = value as number;
		const { max, min } = (rule as RangeRule).config;

		return numericValue >= min && numericValue <= max;
	};

	/**
	 * @param field - How to pull the numeric value from each item
	 * @param config - The inclusive min/max bounds
	 */
	constructor(field: FieldExtractor, config: RangeRuleConfig) {
		super(field);
		this.config = config;
	}
}
// #endregion docs:range-rule
