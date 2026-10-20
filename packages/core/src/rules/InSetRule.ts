/**
 * `InSetRule` — multi-select filter: value must be present in a configured set.
 *
 * @remarks
 * The workhorse rule for "checkbox group" / "tag cloud" / "multi-select dropdown" filter UIs.
 * Passes items whose extracted field value is included in the configured set. An empty set is
 * treated as a no-op (matches every item) — which matches the conventional UX where "no
 * checkboxes selected" means "don't constrain on this filter."
 *
 * **Array-valued fields.** A field holding an array (`paymentMethods: ['card', 'cash']`) is read as
 * a set of values, and `config.arrayMatch` decides how it meets the selection: `'any'` (the
 * default) passes when at least one element is in the set, `'all'` when the array contains every
 * value in the set. An empty array fails any non-empty set. A field that is not an array is
 * compared as a single value under either mode. See `./arrayMatch.ts`.
 *
 * The `toggleSetValues` helper is the ergonomic mutation API for UI integration: toggle one or
 * more values in or out of the set in a single call. Returns nothing; replaces `config` with xor
 * semantics, keeping `arrayMatch`.
 *
 * For grouped tags (value must match any element of any subset), use `InSetofSetsRule`.
 *
 * @packageDocumentation
 */

import type { FieldExtractor, FilterRuleAction, SerializedRule } from '../types.js';

import { xor } from '../lib/internal.js';
import {
	type ArrayMatch,
	type ArrayMatchOptions,
	isSameValueZero,
	matchesArraySelection,
	readArrayMatchConfig,
} from './arrayMatch.js';
import { FilterRule } from './FilterRule.js';
import { revivedField } from './serializedConfig.js';

/** A constructor with `InSetRule`'s signature: the class itself, or a subclass that keeps it. */
type InSetRuleClass = new (field: FieldExtractor) => InSetRule;

// #region docs:in-set-rule
/**
 * Configuration for `InSetRule`.
 */
export interface InSetRuleConfig<V> {
	/** Array of allowed values. Empty array means "match anything." */
	readonly set: readonly V[];
	/**
	 * How an array-valued field meets `set`: `'any'` (default) passes when at least one element is
	 * in it, `'all'` when the array contains every value in it. Ignored for a non-array field.
	 */
	readonly arrayMatch?: ArrayMatch;
}

/**
 * Filter items by membership in a configured set.
 *
 * @example
 *   // Items where varietal is 'pinot-noir' or 'chardonnay':
 *   const colors = new InSetRule<string>('varietal', ['pinot-noir', 'chardonnay']);
 *   engine.addRule('varietal', colors);
 *
 *   // Toggle a value in/out via the helper:
 *   colors.toggleSetValues(['cabernet']);  // adds 'cabernet' to set
 *   colors.toggleSetValues(['cabernet']);  // removes 'cabernet' from set
 *
 *   // An array field: venues that accept card OR cash, then venues that accept both:
 *   new InSetRule<string>('paymentMethods', ['card', 'cash']);
 *   new InSetRule<string>('paymentMethods', ['card', 'cash'], { arrayMatch: 'all' });
 *
 * @typeParam V - The element type. Defaults to `unknown`.
 */
export class InSetRule<V = unknown> extends FilterRule {
	/**
	 * Minifier-proof wire name — see {@link FilterRule.ruleTypeName}. Declared as a literal so
	 * `ruleRegistry.register` can reject a key that disagrees with it at compile time.
	 */
	static override readonly ruleTypeName = 'InSetRule';

	config: InSetRuleConfig<V>;

	/**
	 * @param field - How to pull the value-to-test from each item
	 * @param initialSet - Initial set of allowed values (may be empty)
	 * @param options - `arrayMatch` for array-valued fields; omitted, they match `'any'`
	 */
	constructor(field: FieldExtractor, initialSet: readonly V[] = [], options: ArrayMatchOptions = {}) {
		super(field);
		this.config = options.arrayMatch === undefined
			? { set: [...initialSet]}
			: { arrayMatch: options.arrayMatch, set: [...initialSet]};
	}

	/**
	 * Passes when the field value is in `config.set` (an array field: per `config.arrayMatch`); an
	 * empty set passes everything.
	 */
	override action: FilterRuleAction = (item, rule): boolean => {
		const { arrayMatch, set } = (rule as InSetRule<V>).config;

		if (set.length === 0) {
			return true;
		}
		const value = this.getFieldValue(item);

		return Array.isArray(value)
			? matchesArraySelection(value, set, arrayMatch, isSameValueZero)
			: set.includes(value as V);
	};

	/**
	 * Toggle one or more values in/out of the set via symmetric difference (xor) semantics.
	 *
	 * For each value in `values`:
	 *   - If currently in the set → remove it
	 *   - If currently NOT in the set → add it
	 *
	 * Replaces `config` with a new set, keeping `arrayMatch`; the previous array is left untouched,
	 * so a snapshot holding it still describes the earlier state.
	 *
	 * @param values - Values to toggle
	 */
	toggleSetValues(values: readonly V[]): void {
		this.config = { ...this.config, set: xor(this.config.set, values) };
	}
	// #endregion docs:in-set-rule

	/**
	 * Revive an `InSetRule` from its serialized form. `ruleRegistry.deserialize` calls this hook with
	 * the registered class as `this`, so a subclass registered in its place revives as itself.
	 *
	 * @param json - The serialized rule
	 * @returns The revived rule, its `config` exactly as serialized
	 * @throws `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG` when `config` is not an
	 *   object, or `arrayMatch` is present and neither `'any'` nor `'all'`
	 */
	static deserialize(this: InSetRuleClass, json: SerializedRule): InSetRule {
		const rule = new this(revivedField(json));

		rule.config = readArrayMatchConfig(json) as unknown as InSetRuleConfig<unknown>;

		return rule;
	}
}
