/**
 * Tests for the ergonomic rule factory functions — `value`, `bool`, `range`, `numCompare`,
 * `inSet`, `inSetofSets`, `text`, `fuzzy`, `regex`, `dateRange`, `hierarchical`, `geo`,
 * `exists`, `predicate`.
 *
 * @remarks
 * Each factory is asserted to (a) return the correct concrete rule instance, (b) install the
 * field + config the caller passed, and (c) behave as expected when its `action` runs. The
 * `inSet` factory is exercised on both of its overloads (bare array and `{ set }` config
 * object) since it branches internally.
 */

import { describe, expect, it } from 'vitest';

import { BooleanRule } from './BooleanRule.js';
import { DateRangeRule } from './DateRangeRule.js';
import { ExistsRule } from './ExistsRule.js';
import {
	bool,
	dateRange,
	exists,
	fuzzy,
	geo,
	hierarchical,
	inSet,
	inSetofSets,
	numCompare,
	predicate,
	range,
	regex,
	text,
	value,
} from './factories.js';
import { FuzzySearchRule } from './FuzzySearchRule.js';
import { GeoProximityRule } from './GeoProximityRule.js';
import { HierarchicalRule } from './HierarchicalRule.js';
import { InSetofSetsRule } from './InSetofSetsRule.js';
import { InSetRule } from './InSetRule.js';
import { NumericComparisonRule } from './NumericComparisonRule.js';
import { PredicateRule } from './PredicateRule.js';
import { RangeRule } from './RangeRule.js';
import { RegexRule } from './RegexRule.js';
import { TextSearchRule } from './TextSearchRule.js';
import { ValueRule } from './ValueRule.js';

describe('value', () => {
	it('creates a configured ValueRule that matches by exact equality', () => {
		const rule = value('category', 'wine');

		expect(rule).toBeInstanceOf(ValueRule);
		expect(rule.field).toBe('category');
		expect(rule.config).toBe('wine');
		expect(rule.action({ category: 'wine' }, rule)).toBe(true);
		expect(rule.action({ category: 'beer' }, rule)).toBe(false);
	});
});

describe('bool', () => {
	it('creates a configured BooleanRule that matches a boolean field', () => {
		const rule = bool('available', true);

		expect(rule).toBeInstanceOf(BooleanRule);
		expect(rule.field).toBe('available');
		expect(rule.config).toBe(true);
		expect(rule.action({ available: true }, rule)).toBe(true);
		expect(rule.action({ available: false }, rule)).toBe(false);
	});
});

describe('range', () => {
	it('creates a configured RangeRule with inclusive bounds', () => {
		const rule = range('price', { max: 20, min: 10 });

		expect(rule).toBeInstanceOf(RangeRule);
		expect(rule.field).toBe('price');
		expect(rule.config).toEqual({ max: 20, min: 10 });
		expect(rule.action({ price: 15 }, rule)).toBe(true);
		expect(rule.action({ price: 25 }, rule)).toBe(false);
	});
});

describe('numCompare', () => {
	it('creates a configured NumericComparisonRule with the given operator', () => {
		const rule = numCompare('rating', { op: '>=', value: 4 });

		expect(rule).toBeInstanceOf(NumericComparisonRule);
		expect(rule.field).toBe('rating');
		expect(rule.config).toEqual({ op: '>=', value: 4 });
		expect(rule.action({ rating: 5 }, rule)).toBe(true);
		expect(rule.action({ rating: 3 }, rule)).toBe(false);
	});
});

describe('inSet', () => {
	it('accepts a bare array and wraps it into an InSetRule', () => {
		const rule = inSet<string>('varietal', ['pinot', 'merlot']);

		expect(rule).toBeInstanceOf(InSetRule);
		expect(rule.field).toBe('varietal');
		expect(rule.config).toEqual({ set: ['pinot', 'merlot']});
		expect(rule.action({ varietal: 'merlot' }, rule)).toBe(true);
		expect(rule.action({ varietal: 'syrah' }, rule)).toBe(false);
	});

	it('accepts a { set } config object form', () => {
		const rule = inSet<string>('varietal', { set: ['syrah']});

		expect(rule).toBeInstanceOf(InSetRule);
		expect(rule.config).toEqual({ set: ['syrah']});
		expect(rule.action({ varietal: 'syrah' }, rule)).toBe(true);
	});

	it('passes arrayMatch through from the config form', () => {
		const rule = inSet<string>('payment', { arrayMatch: 'all', set: ['card', 'cash']});

		expect(rule.config).toEqual({ arrayMatch: 'all', set: ['card', 'cash']});
		expect(rule.action({ payment: ['card']}, rule)).toBe(false);
	});
});

describe('inSetofSets', () => {
	it('creates a configured InSetofSetsRule from the supplied subsets', () => {
		const rule = inSetofSets<string>('size', [['xs', 's'], ['xl']]);

		expect(rule).toBeInstanceOf(InSetofSetsRule);
		expect(rule.field).toBe('size');
		expect(rule.config).toEqual({ set: [['xs', 's'], ['xl']]});
		expect(rule.action({ size: 's' }, rule)).toBe(true);
		expect(rule.action({ size: 'm' }, rule)).toBe(false);
	});

	it('passes the arrayMatch option through', () => {
		const rule = inSetofSets<string>('sizes', [['xs'], ['xl']], { arrayMatch: 'all' });

		expect(rule.config).toEqual({ arrayMatch: 'all', set: [['xs'], ['xl']]});
		expect(rule.action({ sizes: ['xs']}, rule)).toBe(false);
	});

	it('defaults to an empty set-of-sets (no-op)', () => {
		const rule = inSetofSets<string>('size');

		expect(rule.config).toEqual({ set: []});
		expect(rule.action({ size: 'anything' }, rule)).toBe(true);
	});
});

describe('text', () => {
	it('creates a configured TextSearchRule that matches per its mode', () => {
		const rule = text('title', { mode: 'substring', query: 'pinot' });

		expect(rule).toBeInstanceOf(TextSearchRule);
		expect(rule.field).toBe('title');
		expect(rule.config).toEqual({ mode: 'substring', query: 'pinot' });
		expect(rule.action({ title: 'Pinot Noir' }, rule)).toBe(true);
		expect(rule.action({ title: 'Merlot' }, rule)).toBe(false);
	});
});

describe('fuzzy', () => {
	it('creates a configured FuzzySearchRule that tolerates typos', () => {
		const rule = fuzzy('title', { query: 'cabernay', threshold: 0.4 });

		expect(rule).toBeInstanceOf(FuzzySearchRule);
		expect(rule.field).toBe('title');
		expect(rule.config).toEqual({ query: 'cabernay', threshold: 0.4 });
		expect(rule.action({ title: 'Cabernet' }, rule)).toBe(true);
	});
});

describe('regex', () => {
	it('creates a configured RegexRule that matches against a pattern', () => {
		const rule = regex('sku', { pattern: /^CV1F/ });

		expect(rule).toBeInstanceOf(RegexRule);
		expect(rule.field).toBe('sku');
		expect(rule.config.pattern.source).toBe('^CV1F');
		expect(rule.action({ sku: 'CV1F-001' }, rule)).toBe(true);
		expect(rule.action({ sku: 'ZZZ-001' }, rule)).toBe(false);
	});
});

describe('dateRange', () => {
	it('creates a configured DateRangeRule with absolute bounds', () => {
		const start = new Date('2025-01-01');
		const end = new Date('2025-12-31');
		const rule = dateRange('createdAt', { end, start });

		expect(rule).toBeInstanceOf(DateRangeRule);
		expect(rule.field).toBe('createdAt');
		expect(rule.config).toEqual({ end, start });
		expect(rule.action({ createdAt: new Date('2025-06-15') }, rule)).toBe(true);
		expect(rule.action({ createdAt: new Date('2024-06-15') }, rule)).toBe(false);
	});
});

describe('hierarchical', () => {
	it('creates a configured HierarchicalRule with descendant inclusion', () => {
		const tree = {
			children: [{ children: [{ id: 'smartphones' }], id: 'phones' }],
			id: 'electronics',
		};
		const rule = hierarchical('categoryId', { selected: ['phones'], tree });

		expect(rule).toBeInstanceOf(HierarchicalRule);
		expect(rule.field).toBe('categoryId');
		expect(rule.config).toEqual({ selected: ['phones'], tree });
		expect(rule.action({ categoryId: 'smartphones' }, rule)).toBe(true);
		expect(rule.action({ categoryId: 'laptops' }, rule)).toBe(false);
	});
});

describe('geo', () => {
	it('creates a configured GeoProximityRule that matches within the radius', () => {
		const center = { lat: 37.7955, lng: -122.3937 };
		const rule = geo('location', { center, radiusKm: 5 });

		expect(rule).toBeInstanceOf(GeoProximityRule);
		expect(rule.field).toBe('location');
		expect(rule.config).toEqual({ center, radiusKm: 5 });
		expect(rule.action({ location: { lat: 37.7956, lng: -122.3938 }}, rule)).toBe(true);
		expect(rule.action({ location: { lat: 40.7128, lng: -74.006 }}, rule)).toBe(false);
	});
});

describe('exists', () => {
	it('creates an ExistsRule that passes items with a present value', () => {
		const rule = exists('photoUrl');

		expect(rule).toBeInstanceOf(ExistsRule);
		expect(rule.field).toBe('photoUrl');
		expect(rule.action({ photoUrl: 'a.png' }, rule)).toBe(true);
		expect(rule.action({ photoUrl: null }, rule)).toBe(false);
	});
});

describe('predicate', () => {
	it('creates a PredicateRule wrapping the supplied predicate function', () => {
		const predicateFn = (item: { score: number }): boolean => item.score > 3;
		const rule = predicate<{ score: number }>('score', predicateFn);

		expect(rule).toBeInstanceOf(PredicateRule);
		expect(rule.field).toBe('score');
		expect(rule.config.predicate).toBe(predicateFn);
		expect(rule.action({ score: 5 }, rule)).toBe(true);
		expect(rule.action({ score: 1 }, rule)).toBe(false);
	});
});
