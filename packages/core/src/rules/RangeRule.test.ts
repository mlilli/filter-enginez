/**
 * Tests for `RangeRule` — inclusive numeric range filtering.
 *
 * @remarks
 * Covers in-range pass, both inclusive boundaries, below-min and above-max rejects, the
 * null/undefined field reject paths, unbounded ranges via ±Infinity, and the serialized shape.
 */

import { describe, expect, it } from 'vitest';

import { RangeRule } from './RangeRule.js';

describe('RangeRule', () => {
	it('passes items whose value falls inside the inclusive range', () => {
		const rule = new RangeRule('price', { max: 30, min: 20 });

		expect(rule.action({ price: 25 }, rule)).toBe(true);
	});

	it('passes items whose value sits exactly on either inclusive boundary', () => {
		const rule = new RangeRule('price', { max: 30, min: 20 });

		expect(rule.action({ price: 20 }, rule)).toBe(true);
		expect(rule.action({ price: 30 }, rule)).toBe(true);
	});

	it('rejects items whose value is below the minimum', () => {
		const rule = new RangeRule('price', { max: 30, min: 20 });

		expect(rule.action({ price: 19 }, rule)).toBe(false);
	});

	it('rejects items whose value is above the maximum', () => {
		const rule = new RangeRule('price', { max: 30, min: 20 });

		expect(rule.action({ price: 31 }, rule)).toBe(false);
	});

	it('rejects items whose field is undefined', () => {
		const rule = new RangeRule('price', { max: 30, min: 20 });

		expect(rule.action({ unrelated: true }, rule)).toBe(false);
	});

	it('rejects items whose field is explicitly null', () => {
		const rule = new RangeRule('price', { max: 30, min: 20 });

		expect(rule.action({ price: null }, rule)).toBe(false);
	});

	it('supports a half-open range expressed with Infinity bounds', () => {
		const rule = new RangeRule('rating', { max: Infinity, min: 4 });

		expect(rule.action({ rating: 4 }, rule)).toBe(true);
		expect(rule.action({ rating: 4.5 }, rule)).toBe(true);
		expect(rule.action({ rating: 3.9 }, rule)).toBe(false);
	});

	it('serializes to its type, field, and min/max config', () => {
		const rule = new RangeRule('price', { max: 30, min: 20 });

		expect(rule.serialize()).toEqual({
			config: { max: 30, min: 20 },
			field: 'price',
			type: 'RangeRule',
		});
	});
});
