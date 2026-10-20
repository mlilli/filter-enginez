/**
 * Tests for `RangeRule` — inclusive numeric range filtering.
 *
 * @remarks
 * Covers in-range pass, both inclusive boundaries, below-min and above-max rejects, the
 * null/undefined field reject paths, unbounded ranges via ±Infinity, the serialized shape, and the
 * `static deserialize` hook: `null` bounds (what JSON writes for `±Infinity`) revive as open, infinite
 * numbers are kept, extra config keys carry over, a registered subclass revives as itself, and a
 * non-object config or a bound that is not a number (a string, a missing key, `NaN`) throws.
 */

import { describe, expect, it } from 'vitest';

import type { SerializedRule } from '../types.js';

import { FilterEngineRuleError } from '../errors/index.js';
import { RangeRule } from './RangeRule.js';
import { RuleRegistry } from './ruleRegistry.js';

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

	describe('deserialize', () => {
		it('revives null bounds — what JSON writes for ±Infinity — as open bounds', () => {
			const rule = RangeRule.deserialize({ config: { max: null, min: null }, field: 'price', type: 'RangeRule' });

			expect(rule.config).toEqual({ max: Number.POSITIVE_INFINITY, min: Number.NEGATIVE_INFINITY });
			expect(rule.action({ price: -1e12 }, rule)).toBe(true);
			expect(rule.action({ price: 1e12 }, rule)).toBe(true);
		});

		it('keeps an open bound through JSON', () => {
			const original = new RangeRule('price', { max: Number.POSITIVE_INFINITY, min: 60 });
			const rule = RangeRule.deserialize(JSON.parse(JSON.stringify(original.serialize())) as SerializedRule);

			expect(rule.config).toEqual({ max: Number.POSITIVE_INFINITY, min: 60 });
			expect(rule.action({ price: 75 }, rule)).toBe(true);
			expect(rule.action({ price: 59 }, rule)).toBe(false);
		});

		it('keeps infinite numbers, which structuredClone carries as they are', () => {
			const rule = RangeRule.deserialize({
				config: { max: Number.NEGATIVE_INFINITY, min: Number.POSITIVE_INFINITY },
				field: 'price',
				type: 'RangeRule',
			});

			expect(rule.config).toEqual({ max: Number.NEGATIVE_INFINITY, min: Number.POSITIVE_INFINITY });
		});

		it('carries extra config keys over unchanged', () => {
			const rule = RangeRule.deserialize({ config: { max: 2, min: 1, unit: 'usd' }, field: 'price', type: 'RangeRule' });

			expect(rule.config).toEqual({ max: 2, min: 1, unit: 'usd' });
		});

		it('revives as the class registered under its name, so a replacing subclass revives as itself', () => {
			/** A subclass registered in place of the built-in. */
			class AuditedRange extends RangeRule {
				readonly isAudited = true;
			}
			const registry = new RuleRegistry();

			registry.unregister('RangeRule');
			registry.register('RangeRule', AuditedRange);
			const rule = registry.deserialize({ config: { max: null, min: 10 }, field: 'price', type: 'RangeRule' });

			expect(rule).toBeInstanceOf(AuditedRange);
			expect((rule as AuditedRange).isAudited).toBe(true);
			expect(rule.config).toEqual({ max: Number.POSITIVE_INFINITY, min: 10 });
		});

		it.each([
			[{ max: '100', min: 0 }, 'PriceBand config.max must be a number, or null for an open bound; got "100".'],
			[{ max: 100 }, 'PriceBand config.min must be a number, or null for an open bound; got undefined.'],
			[{ max: 100, min: Number.NaN }, 'PriceBand config.min must be a number, or null for an open bound; got NaN.'],
		])('rejects the config %o', (config, message) => {
			expect(() => RangeRule.deserialize({ config, field: 'price', type: 'PriceBand' })).toThrowError(FilterEngineRuleError);
			expect(() => RangeRule.deserialize({ config, field: 'price', type: 'PriceBand' })).toThrowError(message);
		});

		it('rejects a config that is not an object', () => {
			expect(() => RangeRule.deserialize({ config: null, field: 'price', type: 'RangeRule' }))
				.toThrowError('RangeRule config must be an object; got null.');
		});
	});
});
