/**
 * `ValueRule` — exact-equality filter against a single configured value.
 *
 * @remarks
 * The simplest rule type. Passes items whose extracted field value strictly equals the
 * configured `value`. If `config` is `undefined`, the rule is a no-op (matches every item) —
 * useful for "rule registered but not yet configured" states in JSON-driven configs.
 *
 * For multi-select semantics, use `InSetRule`. For boolean toggles, use `BooleanRule` (which
 * is a typed convenience around `ValueRule`). For inequality, use `NumericComparisonRule`.
 *
 * @packageDocumentation
 */

import type { FieldExtractor, FilterRuleAction } from '../types.js';

import { FilterRule } from './FilterRule.js';

// #region docs:value-rule
/**
 * Filter items by exact equality against a configured value.
 *
 * @example
 *   // Items where `category === 'wine'`:
 *   engine.addRule('cat', new ValueRule<string>('category', 'wine'));
 *
 *   // Items where `inStock === true`:
 *   engine.addRule('avail', new ValueRule<boolean>('inStock', true));
 *
 *   // No-op rule (config is undefined, matches everything):
 *   engine.addRule('placeholder', new ValueRule('category', undefined));
 *
 * @typeParam V - The value type. Defaults to `unknown` for maximally flexible declaration.
 */
export class ValueRule<V = unknown> extends FilterRule {
	/**
	 * Minifier-proof wire name — see {@link FilterRule.ruleTypeName}. Declared as a literal so
	 * `ruleRegistry.register` can reject a key that disagrees with it at compile time.
	 */
	static override readonly ruleTypeName = 'ValueRule';

	/**
	 * The configured value to match. When `undefined`, the rule matches every item (no-op).
	 */
	config: V | undefined;

	/** Passes when the field value strictly equals `config`; passes everything when `config` is `undefined`. */
	override action: FilterRuleAction = (item, rule): boolean => {
		const configValue = (rule as ValueRule<V>).config;

		if (configValue === undefined) {
			return true;
		}

		return configValue === this.getFieldValue(item);
	};

	/**
	 * @param field - How to pull the value-to-test from each item
	 * @param value - The value to match, or `undefined` for a no-op rule
	 */
	constructor(field: FieldExtractor, value: V | undefined) {
		super(field);
		this.config = value;
	}
}
// #endregion docs:value-rule
