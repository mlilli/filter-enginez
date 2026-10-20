/**
 * Tests for `NumericComparisonRule` — single-operator numeric comparison.
 *
 * @remarks
 * Covers all six operators (`!=`, `<`, `<=`, `==`, `>`, `>=`) across their true and false
 * branches, the null/undefined field reject paths, the serialized shape, and the `static deserialize`
 * hook: a `null` value (what JSON writes for an infinity) revives as the infinity that leaves each
 * operator open, numbers are kept, a registered subclass revives as itself, and an unknown `op` or a
 * value that is not a number throws.
 */

import { describe, expect, it } from 'vitest';

import type { SerializedRule } from '../types.js';

import { FilterEngineRuleError } from '../errors/index.js';
import { type NumericComparisonOp, NumericComparisonRule } from './NumericComparisonRule.js';
import { RuleRegistry } from './ruleRegistry.js';

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

	describe('deserialize', () => {
		it.each([
			['!=', Number.POSITIVE_INFINITY],
			['<', Number.POSITIVE_INFINITY],
			['<=', Number.POSITIVE_INFINITY],
			['==', Number.POSITIVE_INFINITY],
			['>', Number.NEGATIVE_INFINITY],
			['>=', Number.NEGATIVE_INFINITY],
		] as const)('revives a null value under %s as %s', (op: NumericComparisonOp, open: number) => {
			const rule = NumericComparisonRule.deserialize({ config: { op, value: null }, field: 'n', type: 'NumericComparisonRule' });

			expect(rule.config).toEqual({ op, value: open });
		});

		it('keeps an open comparison through JSON', () => {
			const original = new NumericComparisonRule('n', { op: '<=', value: Number.POSITIVE_INFINITY });
			const rule = NumericComparisonRule.deserialize(JSON.parse(JSON.stringify(original.serialize())) as SerializedRule);

			expect(rule.action({ n: 1e12 }, rule)).toBe(true);
			expect(rule.action({ n: -1e12 }, rule)).toBe(true);
		});

		it('keeps a numeric value and any extra config keys', () => {
			const rule = NumericComparisonRule.deserialize({ config: { op: '>', unit: 'pts', value: -0 }, field: 'n', type: 'NumericComparisonRule' });

			expect(rule.config).toEqual({ op: '>', unit: 'pts', value: -0 });
		});

		it('revives as the class registered under its name, so a replacing subclass revives as itself', () => {
			/** A subclass registered in place of the built-in. */
			class AuditedComparison extends NumericComparisonRule {
				readonly isAudited = true;
			}
			const registry = new RuleRegistry();

			registry.unregister('NumericComparisonRule');
			registry.register('NumericComparisonRule', AuditedComparison);

			expect(registry.deserialize({ config: { op: '>=', value: 90 }, field: 'n', type: 'NumericComparisonRule' }))
				.toBeInstanceOf(AuditedComparison);
		});

		it.each([
			[{ op: '=>', value: 1 }, 'NumericComparisonRule config.op must be one of != < <= == > >=; got "=>".'],
			[{ value: 1 }, 'NumericComparisonRule config.op must be one of != < <= == > >=; got undefined.'],
			[{ op: '<', value: '1' }, 'NumericComparisonRule config.value must be a number, or null for an open bound; got "1".'],
			[{ op: '<', value: Number.NaN }, 'NumericComparisonRule config.value must be a number, or null for an open bound; got NaN.'],
		])('rejects the config %o', (config, message) => {
			expect(() => NumericComparisonRule.deserialize({ config, field: 'n', type: 'NumericComparisonRule' })).toThrowError(FilterEngineRuleError);
			expect(() => NumericComparisonRule.deserialize({ config, field: 'n', type: 'NumericComparisonRule' })).toThrowError(message);
		});
	});
});
