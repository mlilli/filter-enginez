/**
 * `NumericComparisonRule` — single-operator comparison against a numeric value.
 *
 * @remarks
 * For ranges, use `RangeRule`. For single-sided inequalities or non-range comparisons,
 * use this rule. Supports the six standard comparison operators.
 *
 * An infinite `value` survives JSON: `JSON.stringify` writes it as `null`, and
 * {@link NumericComparisonRule.deserialize} reads a `null` value back as the infinity that leaves
 * the comparison open.
 *
 * @packageDocumentation
 */

import type { FieldExtractor, FilterRuleAction, SerializedRule } from '../types.js';

import { FilterRule } from './FilterRule.js';
import { invalidConfig, readRecord, reviveBounds, revivedField } from './serializedConfig.js';

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
	/** The number to compare against. An infinite value is written to JSON as `null`. */
	readonly value: number;
}

/** The six operators, for checking a serialized `op`. */
const NUMERIC_COMPARISON_OPS: readonly string[] = ['!=', '<', '<=', '==', '>', '>='] satisfies readonly NumericComparisonOp[];

/** A constructor with `NumericComparisonRule`'s signature: the class itself, or a subclass that keeps it. */
type NumericComparisonRuleClass = new (field: FieldExtractor, config: NumericComparisonRuleConfig) => NumericComparisonRule;

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

	/**
	 * Revive a `NumericComparisonRule` from its serialized form. `ruleRegistry.deserialize` calls this
	 * hook with the registered class as `this`, so a subclass registered in its place revives
	 * as itself.
	 *
	 * @remarks
	 * A `null` value is an open one: `Infinity` under `<`, `<=`, `==` and `!=`, `-Infinity` under `>`
	 * and `>=`. That is what `JSON.stringify` writes for an infinity, so `{ op: '<=', value: Infinity }`
	 * keeps its meaning through `exportConfig` → JSON → `loadConfig`, URL state and an HTTP request
	 * body. Any other config keys are carried over unchanged.
	 *
	 * @param json - The serialized rule
	 * @returns The revived rule, with a numeric `value`
	 * @throws `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG` when `config` is not an
	 *   object, `op` is not one of the six operators, or `value` is neither a number nor `null`
	 */
	static deserialize(this: NumericComparisonRuleClass, json: SerializedRule): NumericComparisonRule {
		const { op } = readRecord(json.config, `${json.type} config`);

		if (!NUMERIC_COMPARISON_OPS.includes(op as string)) {
			throw invalidConfig(`${json.type} config.op`, `one of ${NUMERIC_COMPARISON_OPS.join(' ')}`, op);
		}
		// `>` and `>=` are open toward -Infinity; `<`, `<=` toward Infinity, and `==` / `!=` compare
		// every finite value the same way against either infinity.
		const openValue = op === '>' || op === '>=' ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;

		return new this(revivedField(json), { ...reviveBounds(json, { value: openValue }), op: op as NumericComparisonOp });
	}
}
// #endregion docs:numeric-comparison-rule
