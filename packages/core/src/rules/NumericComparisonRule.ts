/**
 * `NumericComparisonRule` — single-operator comparison against a numeric value.
 *
 * @remarks
 * For ranges, use `RangeRule`. For single-sided inequalities or non-range comparisons,
 * use this rule. Supports the six standard comparison operators.
 *
 * @packageDocumentation
 */

import type { FieldExtractor, FilterRuleAction } from '../types.js';

import { FilterRule } from './FilterRule.js';

// #region docs:numeric-comparison-rule
/**
 * The six supported comparison operators.
 */
export type NumericComparisonOp = '!=' | '<' | '<=' | '==' | '>' | '>=';

/**
 * Configuration for `NumericComparisonRule`.
 */
export interface NumericComparisonRuleConfig {
	readonly op: NumericComparisonOp;
	readonly value: number;
}

/**
 * Filter items by a numeric comparison.
 *
 * @example
 *   // Items where `rating >= 4`:
 *   engine.addRule('rating', new NumericComparisonRule('rating', { op: '>=', value: 4 }));
 *
 *   // Items where `year > 2020`:
 *   engine.addRule('year', new NumericComparisonRule('year', { op: '>', value: 2020 }));
 */
export class NumericComparisonRule extends FilterRule {
	/**
	 * Minifier-proof wire name — see {@link FilterRule.ruleTypeName}. Declared as a literal so
	 * `ruleRegistry.register` can reject a key that disagrees with it at compile time.
	 */
	static override readonly ruleTypeName = 'NumericComparisonRule';

	override action: FilterRuleAction = (item, rule): boolean => {
		const fieldValue = this.getFieldValue(item);

		if (fieldValue === undefined || fieldValue === null) {
			return false;
		}
		const numericValue = fieldValue as number;
		const { op, value } = (rule as NumericComparisonRule).config;

		switch (op) {
			case '!=':
				return numericValue !== value;
			case '<':
				return numericValue < value;
			case '<=':
				return numericValue <= value;
			case '==':
				return numericValue === value;
			case '>':
				return numericValue > value;
			case '>=':
				return numericValue >= value;
		}
	};

	config: NumericComparisonRuleConfig;

	constructor(field: FieldExtractor, config: NumericComparisonRuleConfig) {
		super(field);
		this.config = config;
	}
}
// #endregion docs:numeric-comparison-rule
