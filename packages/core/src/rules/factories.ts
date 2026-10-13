/**
 * Convenience factory functions for the rule catalog — the ergonomic alternative to
 * `new XxxRule(...)`.
 *
 * @remarks
 * Factory Method pattern (GoF Creational). Each factory function returns a configured rule
 * instance with consumer-friendly argument naming. They read more naturally in
 * `engine.addRule()` chains:
 *
 * ```ts
 * // Verbose class form:
 * engine.addRule('price', new RangeRule('price', { min: 20000, max: 30000 }));
 *
 * // Ergonomic factory form (same result):
 * engine.addRule('price', range('price', { min: 20000, max: 30000 }));
 * ```
 *
 * One factory per rule type. Composition factories (`and`, `or`, `not`) live in
 * `composition/factories.ts`.
 *
 * @packageDocumentation
 */

import type { BloomFilter } from '../lib/BloomFilter.js';
import type { FieldExtractor } from '../types.js';

import { BloomMembershipRule } from './BloomMembershipRule.js';
import { BooleanRule } from './BooleanRule.js';
import { DateRangeRule, type DateRangeRuleConfig } from './DateRangeRule.js';
import { ExistsRule } from './ExistsRule.js';
import { FuzzySearchRule, type FuzzySearchRuleConfig } from './FuzzySearchRule.js';
import { GeoProximityRule, type GeoProximityRuleConfig } from './GeoProximityRule.js';
import { HierarchicalRule, type HierarchicalRuleConfig } from './HierarchicalRule.js';
import { InSetofSetsRule } from './InSetofSetsRule.js';
import { InSetRule, type InSetRuleConfig } from './InSetRule.js';
import {
	NumericComparisonRule,
	type NumericComparisonRuleConfig,
} from './NumericComparisonRule.js';
import { PredicateRule } from './PredicateRule.js';
import { RangeRule, type RangeRuleConfig } from './RangeRule.js';
import { RegexRule, type RegexRuleConfig } from './RegexRule.js';
import { TextSearchRule, type TextSearchRuleConfig } from './TextSearchRule.js';
import { ValueRule } from './ValueRule.js';

// #region docs:rule-factories
/** Create a `ValueRule` — exact equality against a configured value. */
export function value<V>(field: FieldExtractor, targetValue: V | undefined): ValueRule<V> {
	return new ValueRule(field, targetValue);
}

/** Create a `BooleanRule` — boolean equality convenience. */
export function bool(field: FieldExtractor, val: boolean | undefined): BooleanRule {
	return new BooleanRule(field, val);
}

/** Create a `RangeRule` — inclusive numeric range. */
export function range(field: FieldExtractor, config: RangeRuleConfig): RangeRule {
	return new RangeRule(field, config);
}

/** Create a `NumericComparisonRule` — single-operator numeric comparison. */
export function numCompare(
	field: FieldExtractor,
	config: NumericComparisonRuleConfig,
): NumericComparisonRule {
	return new NumericComparisonRule(field, config);
}

/** Create an `InSetRule` — value must be in a configured set. */
export function inSet<V>(
	field: FieldExtractor,
	initialSetOrConfig: InSetRuleConfig<V> | readonly V[],
): InSetRule<V> {
	const initialSet = Array.isArray(initialSetOrConfig)
		? initialSetOrConfig
		: (initialSetOrConfig as InSetRuleConfig<V>).set;

	return new InSetRule<V>(field, initialSet);
}

/** Create an `InSetofSetsRule` — value must be in any of the configured subsets. */
export function inSetofSets<V>(
	field: FieldExtractor,
	initialSets: readonly (readonly V[])[] = [],
): InSetofSetsRule<V> {
	return new InSetofSetsRule<V>(field, initialSets);
}
// #endregion docs:rule-factories

/**
 * Create a `BloomMembershipRule` — probabilistic set membership against a **prebuilt**
 * {@link BloomFilter}. It is a PRE-SCREEN (no false negatives, tunable false positives).
 *
 * **Takes a prebuilt filter, by design.** The rule exists for membership sets too large to ship
 * inline, which are built once offline; there is no build-from-items convenience here (that would
 * invert the premise and overlap `InSetRule`). Build the filter yourself via
 * `BloomFilter.forCapacity(n, p)` + `add(String(key))`, using the **same `String(...)` keying** the
 * rule probes with at query time (see `BloomMembershipRule`'s coercion contract).
 */
export function bloomMembership(field: FieldExtractor, filter: BloomFilter): BloomMembershipRule {
	return new BloomMembershipRule(field, filter);
}

/** Create a `TextSearchRule` — zero-dep text matching. */
export function text(field: FieldExtractor, config: TextSearchRuleConfig): TextSearchRule {
	return new TextSearchRule(field, config);
}

/** Create a `FuzzySearchRule` — typo-tolerant search via Fuse.js. */
export function fuzzy(field: FieldExtractor, config: FuzzySearchRuleConfig): FuzzySearchRule {
	return new FuzzySearchRule(field, config);
}

/** Create a `RegexRule` — string regex match. */
export function regex(field: FieldExtractor, config: RegexRuleConfig): RegexRule {
	return new RegexRule(field, config);
}

/** Create a `DateRangeRule` — date range with relative-preset support. */
export function dateRange(field: FieldExtractor, config: DateRangeRuleConfig): DateRangeRule {
	return new DateRangeRule(field, config);
}

/** Create a `HierarchicalRule` — tree-of-categories filter with descendant inclusion. */
export function hierarchical(
	field: FieldExtractor,
	config: HierarchicalRuleConfig,
): HierarchicalRule {
	return new HierarchicalRule(field, config);
}

/** Create a `GeoProximityRule` — within-radius geographic filter. */
export function geo(field: FieldExtractor, config: GeoProximityRuleConfig): GeoProximityRule {
	return new GeoProximityRule(field, config);
}

/** Create an `ExistsRule` — passes items whose extracted value is not null/undefined. */
export function exists(field: FieldExtractor): ExistsRule {
	return new ExistsRule(field);
}

/**
 * Create a `PredicateRule` — escape hatch for arbitrary consumer-supplied predicate.
 *
 * **Note:** `PredicateRule` cannot be serialized — for round-trip support write a named
 * `FilterRule` subclass and register it with `ruleRegistry`.
 */
export function predicate<T>(
	field: FieldExtractor,
	predicateFn: (item: T, rule: PredicateRule<T>) => boolean,
): PredicateRule<T> {
	return new PredicateRule<T>(field, predicateFn);
}
