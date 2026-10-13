/**
 * `InSetRule` — multi-select filter: value must be present in a configured set.
 *
 * @remarks
 * The workhorse rule for "checkbox group" / "tag cloud" / "multi-select dropdown" filter UIs.
 * Passes items whose extracted field value is included in the configured set. An empty set is
 * treated as a no-op (matches every item) — which matches the conventional UX where "no
 * checkboxes selected" means "don't constrain on this filter."
 *
 * The `toggleSetValues` helper is the ergonomic mutation API for UI integration: toggle one or
 * more values in or out of the set in a single call. Returns nothing; mutates `config.set`
 * in-place via xor semantics.
 *
 * For grouped tags (value must match any element of any subset), use `InSetofSetsRule`.
 *
 * @packageDocumentation
 */

import type { FieldExtractor, FilterRuleAction } from '../types.js';

import { xor } from '../lib/internal.js';
import { FilterRule } from './FilterRule.js';

// #region docs:in-set-rule
/**
 * Configuration for `InSetRule`.
 */
export interface InSetRuleConfig<V> {
	/** Array of allowed values. Empty array means "match anything." */
	readonly set: readonly V[];
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
	 */
	constructor(field: FieldExtractor, initialSet: readonly V[] = []) {
		super(field);
		this.config = { set: [...initialSet]};
	}

	/** Passes when the field value is in `config.set`; an empty set passes everything. */
	override action: FilterRuleAction = (item, rule): boolean => {
		const { set } = (rule as InSetRule<V>).config;

		if (set.length === 0) {
			return true;
		}
		const value = this.getFieldValue(item) as V;

		return set.includes(value);
	};

	/**
	 * Toggle one or more values in/out of the set via symmetric difference (xor) semantics.
	 *
	 * For each value in `values`:
	 *   - If currently in the set → remove it
	 *   - If currently NOT in the set → add it
	 *
	 * Replaces `config` with a new set; the previous array is left untouched, so a snapshot
	 * holding it still describes the earlier state.
	 *
	 * @param values - Values to toggle
	 */
	toggleSetValues(values: readonly V[]): void {
		this.config = { set: xor(this.config.set, values) };
	}
}
// #endregion docs:in-set-rule
