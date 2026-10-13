/**
 * `PredicateRule` — escape hatch for arbitrary consumer-supplied predicates.
 *
 * @remarks
 * Use this when none of the named rule types fit and you don't want to extend `FilterRule`
 * with a custom subclass. Tradeoff: the predicate is an opaque function, so this rule cannot
 * be serialized through URL state, JSON config, worker-bridge postMessage, or devtools
 * snapshot persistence — its `serialize()` throws.
 *
 * For one-off filters this is fine. For filters that need to round-trip, write a named
 * `FilterRule` subclass and register it with `ruleRegistry`.
 *
 * @packageDocumentation
 */

import type { FieldExtractor, FilterRuleAction, SerializedRule } from '../types.js';

import { FilterEngineRuleError } from '../errors/index.js';
import { FilterRule } from './FilterRule.js';

// #region docs:predicate-rule
/**
 * Configuration for `PredicateRule`.
 *
 * @typeParam T - The item type the predicate expects (narrowed from `unknown`)
 */
export interface PredicateRuleConfig<T> {
	readonly predicate: (item: T, rule: PredicateRule<T>) => boolean;
}

/**
 * Filter items by a consumer-supplied predicate function.
 *
 * @example
 *   // Custom rule: items whose computed score exceeds a dynamic threshold:
 *   engine.addRule(
 *     'high-score',
 *     new PredicateRule<Item>('score', (item) => item.score > computeThreshold()),
 *   );
 *
 * @typeParam T - The item type
 */
export class PredicateRule<T = unknown> extends FilterRule {
	/**
	 * Minifier-proof wire name — see {@link FilterRule.ruleTypeName}. Declared as a literal so
	 * `ruleRegistry.register` can reject a key that disagrees with it at compile time.
	 */
	static override readonly ruleTypeName = 'PredicateRule';

	override action: FilterRuleAction = (item, rule): boolean => {
		const { predicate } = (rule as PredicateRule<T>).config;

		return predicate(item as T, rule as PredicateRule<T>);
	};

	config: PredicateRuleConfig<T>;

	constructor(
		field: FieldExtractor,
		predicate: (item: T, rule: PredicateRule<T>) => boolean,
	) {
		super(field);
		this.config = { predicate };
	}

	/**
	 * Overrides the base `serialize` to throw — predicate functions are not serializable.
	 *
	 * @throws `FilterEngineRuleError` with code `RULE_NOT_SERIALIZABLE`, always; consumers needing
	 *         round-trip must register a named `FilterRule` subclass instead of using `PredicateRule`.
	 */
	override serialize(): SerializedRule {
		const fieldHint = typeof this.field === 'string' ? ` (field '${this.field}')` : '';

		throw new FilterEngineRuleError(
			'RULE_NOT_SERIALIZABLE',
			`PredicateRule${fieldHint} cannot be serialized — its predicate function is opaque. ` +
				'For round-trip support (URL state, JSON config, worker bridge, devtools persistence), ' +
				'write a named FilterRule subclass and register it with ruleRegistry.',
		);
	}
	// #endregion docs:predicate-rule
}
