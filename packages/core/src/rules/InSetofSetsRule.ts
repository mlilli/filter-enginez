/**
 * `InSetofSetsRule` — multi-select filter over grouped/clustered tag sets.
 *
 * @remarks
 * Passes items whose extracted field value is present in ANY of the configured subsets. The
 * typical use case is tag-cloud filtering where tags are clustered into groups; toggling a group
 * toggles all its tags as a unit.
 *
 * **Array-valued fields.** A field holding an array is read as a set of values, and
 * `config.arrayMatch` decides how it meets the subsets: `'any'` (the default) passes when at least
 * one element is in at least one subset, `'all'` when every subset has at least one of its values
 * in the array. An empty array fails any non-empty set-of-sets. A field that is not an array is
 * compared as a single value under either mode. See `./arrayMatch.ts`.
 *
 * Empty set-of-sets is a no-op (matches everything). The `toggleSetValues` helper toggles a
 * subset's presence in the config by exact-array equality.
 *
 * @packageDocumentation
 */

import type { FieldExtractor, FilterRuleAction, SerializedRule } from '../types.js';

import { deepEqual } from '../lib/internal.js';
import { type ArrayMatch, type ArrayMatchOptions, matchesArraySelection, readArrayMatchConfig } from './arrayMatch.js';
import { FilterRule } from './FilterRule.js';
import { revivedField } from './serializedConfig.js';

/** A constructor with `InSetofSetsRule`'s signature: the class itself, or a subclass that keeps it. */
type InSetofSetsRuleClass = new (field: FieldExtractor) => InSetofSetsRule;

// #region docs:in-set-of-sets-rule
/**
 * Configuration for `InSetofSetsRule`.
 */
export interface InSetofSetsRuleConfig<V> {
	readonly set: readonly (readonly V[])[];
	/**
	 * How an array-valued field meets `set`: `'any'` (default) passes when at least one element is in
	 * some subset, `'all'` when every subset has a value in the array. Ignored for a non-array field.
	 */
	readonly arrayMatch?: ArrayMatch;
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
	 * @param options - `arrayMatch` for array-valued fields; omitted, they match `'any'`
	 */
	constructor(
		field: FieldExtractor,
		initialSets: readonly (readonly V[])[] = [],
		options: ArrayMatchOptions = {},
	) {
		super(field);
		this.config = options.arrayMatch === undefined
			? { set: initialSets }
			: { arrayMatch: options.arrayMatch, set: initialSets };
	}

	/**
	 * Passes when the field value is in any of the configured subsets (an array field: per
	 * `config.arrayMatch`); no subsets passes everything.
	 */
	override action: FilterRuleAction = (item, rule): boolean => {
		const { arrayMatch, set } = (rule as InSetofSetsRule<V>).config;

		if (set.length === 0) {
			return true;
		}
		const value = this.getFieldValue(item);

		return Array.isArray(value)
			? matchesArraySelection(value, set, arrayMatch, (subset, element) => subset.includes(element as V))
			: set.some((subset) => subset.includes(value as V));
	};
	// #endregion docs:in-set-of-sets-rule

	/**
	 * Toggle a subset's presence in the config by exact-array equality.
	 *
	 * If the subset is currently in `config.set`, remove it. Otherwise, append a copy. `arrayMatch`
	 * is kept.
	 *
	 * @param values - The subset to toggle
	 */
	toggleSetValues(values: readonly V[]): void {
		const current = this.config.set;
		const matchIndex = current.findIndex((subset) => deepEqual(subset, values));

		if (matchIndex >= 0) {
			this.config = {
				...this.config,
				set: current.filter((_, index) => index !== matchIndex),
			};
		} else {
			this.config = { ...this.config, set: [...current, [...values]]};
		}
	}

	/**
	 * Revive an `InSetofSetsRule` from its serialized form. `ruleRegistry.deserialize` calls this hook
	 * with the registered class as `this`, so a subclass registered in its place revives as itself.
	 *
	 * @param json - The serialized rule
	 * @returns The revived rule, its `config` exactly as serialized
	 * @throws `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG` when `config` is not an
	 *   object, or `arrayMatch` is present and neither `'any'` nor `'all'`
	 */
	static deserialize(this: InSetofSetsRuleClass, json: SerializedRule): InSetofSetsRule {
		const rule = new this(revivedField(json));

		rule.config = readArrayMatchConfig(json) as unknown as InSetofSetsRuleConfig<unknown>;

		return rule;
	}
}
