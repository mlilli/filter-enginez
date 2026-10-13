/**
 * Tests for `NumericComparisonRule` — single-operator numeric comparison.
 *
 * @remarks
 * Covers all six operators (`!=`, `<`, `<=`, `==`, `>`, `>=`) across their true and false
 * branches, the null/undefined field reject paths, and the serialized shape.
 */

import { describe, expect, it } from 'vitest';

import { NumericComparisonRule } from './NumericComparisonRule.js';

describe('NumericComparisonRule', () => {
	it('evaluates the != operator (true when unequal, false when equal)', () => {
		const rule = new NumericComparisonRule('n', { op: '!=', value: 5 });

		expect(rule.action({ n: 4 }, rule)).toBe(true);
		expect(rule.action({ n: 5 }, rule)).toBe(false);
	});

	it('evaluates the < operator (true when less, false when not)', () => {
		const rule = new NumericComparisonRule('n', { op: '<', value: 5 });

		expect(rule.action({ n: 4 }, rule)).toBe(true);
		expect(rule.action({ n: 5 }, rule)).toBe(false);
	});

	it('evaluates the <= operator across boundary, below, and above', () => {
		const rule = new NumericComparisonRule('n', { op: '<=', value: 5 });

		expect(rule.action({ n: 5 }, rule)).toBe(true);
		expect(rule.action({ n: 4 }, rule)).toBe(true);
		expect(rule.action({ n: 6 }, rule)).toBe(false);
	});

	it('evaluates the == operator (true when equal, false when not)', () => {
		const rule = new NumericComparisonRule('n', { op: '==', value: 5 });

		expect(rule.action({ n: 5 }, rule)).toBe(true);
		expect(rule.action({ n: 6 }, rule)).toBe(false);
	});

	it('evaluates the > operator (true when greater, false when not)', () => {
		const rule = new NumericComparisonRule('n', { op: '>', value: 5 });

		expect(rule.action({ n: 6 }, rule)).toBe(true);
		expect(rule.action({ n: 5 }, rule)).toBe(false);
	});

	it('evaluates the >= operator across boundary, above, and below', () => {
		const rule = new NumericComparisonRule('n', { op: '>=', value: 5 });

		expect(rule.action({ n: 5 }, rule)).toBe(true);
		expect(rule.action({ n: 6 }, rule)).toBe(true);
		expect(rule.action({ n: 4 }, rule)).toBe(false);
	});

	it('rejects items whose field is undefined', () => {
		const rule = new NumericComparisonRule('n', { op: '>=', value: 5 });

		expect(rule.action({ unrelated: true }, rule)).toBe(false);
	});

	it('rejects items whose field is explicitly null', () => {
		const rule = new NumericComparisonRule('n', { op: '>=', value: 5 });

		expect(rule.action({ n: null }, rule)).toBe(false);
	});

	it('serializes to its type, field, and op/value config', () => {
		const rule = new NumericComparisonRule('rating', { op: '>=', value: 4 });

		expect(rule.serialize()).toEqual({
			config: { op: '>=', value: 4 },
			field: 'rating',
			type: 'NumericComparisonRule',
		});
	});
});
