/**
 * Tests for the rule-catalog barrel — asserts the public surface re-exports every expected
 * symbol (abstract base, 15 concrete rules, `CompositeRule`, the registry trio, and the
 * ergonomic factory functions).
 *
 * @remarks
 * A barrel has no behavior of its own, so this is a thin re-export assertion: every named
 * export is present and is the live binding (functions are callable, classes are constructable),
 * which is what keeps the package's public API stable.
 */

import { describe, expect, it } from 'vitest';

import * as rules from './index.js';

describe('rules barrel', () => {
	it('re-exports the abstract base and all concrete rule classes', () => {
		const expectedClasses = [
			'FilterRule',
			'ValueRule',
			'BooleanRule',
			'RangeRule',
			'NumericComparisonRule',
			'InSetRule',
			'InSetofSetsRule',
			'BloomMembershipRule',
			'TextSearchRule',
			'FuzzySearchRule',
			'RegexRule',
			'DateRangeRule',
			'HierarchicalRule',
			'GeoProximityRule',
			'ExistsRule',
			'PredicateRule',
			'CompositeRule',
			'RuleRegistry',
			'RuleRegistryError',
		] as const;

		for (const name of expectedClasses) {
			expect(typeof rules[name]).toBe('function');
		}
	});

	it('re-exports the registry singleton instance', () => {
		expect(rules.ruleRegistry).toBeInstanceOf(rules.RuleRegistry);
	});

	it('re-exports the ergonomic factory functions', () => {
		const factories = [
			'bloomMembership',
			'bool',
			'dateRange',
			'exists',
			'fuzzy',
			'geo',
			'hierarchical',
			'inSet',
			'inSetofSets',
			'numCompare',
			'predicate',
			'range',
			'regex',
			'text',
			'value',
		] as const;

		for (const name of factories) {
			expect(typeof rules[name]).toBe('function');
		}
	});

	it('re-exports the DateRangeRule preset resolver and Geo haversine helper', () => {
		expect(typeof rules.resolvePreset).toBe('function');
		expect(typeof rules.haversineKm).toBe('function');
	});
});
