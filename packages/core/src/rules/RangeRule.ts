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
 * An open bound survives JSON: `JSON.stringify` writes `-Infinity` / `Infinity` as `null`, and
 * {@link RangeRule.deserialize} reads a `null` bound back as open.
 *
 * @packageDocumentation
 */

import type { FieldExtractor, FilterRuleAction, SerializedRule } from '../types.js';

import { FilterRule } from './FilterRule.js';
import { reviveBounds, revivedField } from './serializedConfig.js';

// #region docs:range-rule
/**
 * Configuration for `RangeRule`.
 */
export interface RangeRuleConfig {
	/** Lower bound, inclusive. Use `-Infinity` for unbounded-low; JSON writes it as `null`. */
	readonly min: number;
	/** Upper bound, inclusive. Use `Infinity` for unbounded-high; JSON writes it as `null`. */
	readonly max: number;
}

/** A constructor with `RangeRule`'s signature: `RangeRule` itself, or a subclass that keeps it. */
type RangeRuleClass = new (field: FieldExtractor, config: RangeRuleConfig) => RangeRule;

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

	/**
	 * Revive a `RangeRule` from its serialized form. `ruleRegistry.deserialize` calls this hook with
	 * the registered class as `this`, so a subclass registered in its place revives as itself.
	 *
	 * @remarks
	 * A `null` bound is an open one: `min` revives as `-Infinity` and `max` as `Infinity`. That is
	 * what `JSON.stringify` writes for those values, so an open range keeps its meaning through
	 * `exportConfig` → JSON → `loadConfig`, URL state and an HTTP request body. Any other config keys
	 * are carried over unchanged.
	 *
	 * @param json - The serialized rule
	 * @returns The revived rule, with both bounds numbers
	 * @throws `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG` when `config` is not an
	 *   object, or a bound is neither a number nor `null` (a string, a missing key, `NaN`)
	 */
	static deserialize(this: RangeRuleClass, json: SerializedRule): RangeRule {
		return new this(
			revivedField(json),
			reviveBounds(json, { max: Number.POSITIVE_INFINITY, min: Number.NEGATIVE_INFINITY }),
		);
	}
}
// #endregion docs:range-rule
