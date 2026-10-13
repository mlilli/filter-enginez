/**
 * Tests for `InSetRule` — set-membership filtering plus the `toggleSetValues` mutation helper.
 *
 * @remarks
 * Covers the in-set pass and not-in-set reject predicate paths, the empty-set no-op path, the
 * default empty-set constructor, the initial-set copy (defensive clone), `toggleSetValues`
 * add/remove via xor semantics, and the serialized shape.
 */

import { describe, expect, it } from 'vitest';

import { InSetRule } from './InSetRule.js';

describe('InSetRule', () => {
	it('passes items whose field value is in the configured set', () => {
		const rule = new InSetRule<string>('varietal', ['pinot-noir', 'chardonnay']);

		expect(rule.action({ varietal: 'chardonnay' }, rule)).toBe(true);
	});

	it('rejects items whose field value is not in the configured set', () => {
		const rule = new InSetRule<string>('varietal', ['pinot-noir', 'chardonnay']);

		expect(rule.action({ varietal: 'merlot' }, rule)).toBe(false);
	});

	it('matches every item when the set is empty (no-op rule)', () => {
		const rule = new InSetRule<string>('varietal', []);

		expect(rule.action({ varietal: 'merlot' }, rule)).toBe(true);
	});

	it('defaults to an empty set when no initial set is supplied', () => {
		const rule = new InSetRule<string>('varietal');

		expect(rule.config.set).toEqual([]);
		expect(rule.action({ varietal: 'anything' }, rule)).toBe(true);
	});

	it('clones the initial set so later mutation of the source array does not leak in', () => {
		const source = ['pinot-noir'];
		const rule = new InSetRule<string>('varietal', source);

		source.push('chardonnay');

		expect(rule.config.set).toEqual(['pinot-noir']);
	});

	it('toggleSetValues adds a value that is not yet in the set', () => {
		const rule = new InSetRule<string>('varietal', ['pinot-noir']);

		rule.toggleSetValues(['cabernet']);

		expect(rule.config.set).toEqual(['pinot-noir', 'cabernet']);
		expect(rule.action({ varietal: 'cabernet' }, rule)).toBe(true);
	});

	it('toggleSetValues removes a value that is already in the set', () => {
		const rule = new InSetRule<string>('varietal', ['pinot-noir', 'cabernet']);

		rule.toggleSetValues(['cabernet']);

		expect(rule.config.set).toEqual(['pinot-noir']);
		expect(rule.action({ varietal: 'cabernet' }, rule)).toBe(false);
	});

	it('serializes to its type, field, and set config', () => {
		const rule = new InSetRule<string>('varietal', ['pinot-noir']);

		expect(rule.serialize()).toEqual({
			config: { set: ['pinot-noir']},
			field: 'varietal',
			type: 'InSetRule',
		});
	});
});
