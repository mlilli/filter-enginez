/**
 * `InSetofSetsRule` — multi-select filter over grouped/clustered tag sets.
 *
 * @remarks
 * Passes items whose extracted field value is present in ANY of the configured subsets. The
 * typical use case is tag-cloud filtering where tags are clustered into groups; toggling a group
 * toggles all its tags as a unit.
 *
 * Empty set-of-sets is a no-op (matches everything). The `toggleSetValues` helper toggles a
 * subset's presence in the config by exact-array equality.
 *
 * @packageDocumentation
 */

import type { FieldExtractor, FilterRuleAction } from '../types.js';

import { deepEqual } from '../lib/internal.js';
import { FilterRule } from './FilterRule.js';

// #region docs:in-set-of-sets-rule
/**
 * Configuration for `InSetofSetsRule`.
 */
export interface InSetofSetsRuleConfig<V> {
	readonly set: readonly (readonly V[])[];
}

/**
 * Filter items by membership in any subset of a set-of-sets.
 *
 * @example
 *   const sizes = new InSetofSetsRule<string>('size', [['xs', 's'], ['xl', 'xxl']]);
 *   engine.addRule('size', sizes);
 *   // Toggle the 'small sizes' subset in/out:
 *   sizes.toggleSetValues(['xs', 's']);
 *
 * @typeParam V - The element type.
 */
export class InSetofSetsRule<V = unknown> extends FilterRule {
	/**
	 * Minifier-proof wire name — see {@link FilterRule.ruleTypeName}. Declared as a literal so
	 * `ruleRegistry.register` can reject a key that disagrees with it at compile time.
	 */
	static override readonly ruleTypeName = 'InSetofSetsRule';

	config: InSetofSetsRuleConfig<V>;

	/**
	 * @param field - How to pull the value-to-test from each item
	 * @param initialSets - Initial subsets of allowed values (may be empty)
	 */
	constructor(
		field: FieldExtractor,
		initialSets: readonly (readonly V[])[] = [],
	) {
		super(field);
		this.config = { set: initialSets };
	}

	/** Passes when the field value is in any of the configured subsets; no subsets passes everything. */
	override action: FilterRuleAction = (item, rule): boolean => {
		const { set } = (rule as InSetofSetsRule<V>).config;

		if (set.length === 0) {
			return true;
		}
		const value = this.getFieldValue(item) as V;

		return set.some((subset) => subset.includes(value));
	};
	// #endregion docs:in-set-of-sets-rule

	/**
	 * Toggle a subset's presence in the config by exact-array equality.
	 *
	 * If the subset is currently in `config.set`, remove it. Otherwise, append a copy.
	 *
	 * @param values - The subset to toggle
	 */
	toggleSetValues(values: readonly V[]): void {
		const current = this.config.set;
		const matchIndex = current.findIndex((subset) => deepEqual(subset, values));

		if (matchIndex >= 0) {
			this.config = {
				set: current.filter((_, index) => index !== matchIndex),
			};
		} else {
			this.config = { set: [...current, [...values]]};
		}
	}
}
