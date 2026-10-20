/**
 * Tests for `InSetRule` — set-membership filtering plus the `toggleSetValues` mutation helper.
 *
 * @remarks
 * Covers the in-set pass and not-in-set reject predicate paths, the empty-set no-op path, the
 * default empty-set constructor, the initial-set copy (defensive clone), `toggleSetValues`
 * add/remove via xor semantics, and the serialized shape. Array-valued fields under `arrayMatch`
 * `'any'` (the default) and `'all'`, the empty array, SameValueZero element equality, and the
 * `static deserialize` hook that checks `arrayMatch`.
 */

import { describe, expect, it } from 'vitest';

import type { SerializedRule } from '../types.js';

import { FilterEngineRuleError } from '../errors/index.js';
import { InSetRule } from './InSetRule.js';
import { RuleRegistry } from './ruleRegistry.js';

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

	describe('an array-valued field', () => {
		const accepts = (rule: InSetRule<string>, payment: readonly string[]): boolean => rule.action({ payment }, rule);

		it('matches when any element is in the set, by default', () => {
			const rule = new InSetRule<string>('payment', ['cash']);

			expect(accepts(rule, ['card', 'cash'])).toBe(true);
			expect(accepts(rule, ['card'])).toBe(false);
		});

		it('matches under "all" only when the array contains every value in the set', () => {
			const rule = new InSetRule<string>('payment', ['card', 'cash'], { arrayMatch: 'all' });

			expect(accepts(rule, ['cash', 'voucher', 'card'])).toBe(true);
			expect(accepts(rule, ['card'])).toBe(false);
		});

		it('fails an empty array under either mode, and an empty set passes it', () => {
			expect(accepts(new InSetRule<string>('payment', ['cash']), [])).toBe(false);
			expect(accepts(new InSetRule<string>('payment', ['cash'], { arrayMatch: 'all' }), [])).toBe(false);
			expect(accepts(new InSetRule<string>('payment', [], { arrayMatch: 'all' }), [])).toBe(true);
		});

		it('compares elements as includes does: NaN matches NaN', () => {
			const rule = new InSetRule<number>('scores', [Number.NaN]);

			expect(rule.action({ scores: [1, Number.NaN]}, rule)).toBe(true);
			expect(rule.action({ scores: [1, 2]}, rule)).toBe(false);
		});

		it('reads a single value exactly as before under "all"', () => {
			const rule = new InSetRule<string>('payment', ['card', 'cash'], { arrayMatch: 'all' });

			expect(rule.action({ payment: 'cash' }, rule)).toBe(true);
			expect(rule.action({ payment: 'voucher' }, rule)).toBe(false);
		});
	});

	it('keeps arrayMatch across toggleSetValues and writes it only when set', () => {
		const rule = new InSetRule<string>('payment', ['card'], { arrayMatch: 'all' });

		rule.toggleSetValues(['cash']);

		expect(rule.config).toEqual({ arrayMatch: 'all', set: ['card', 'cash']});
		expect(new InSetRule<string>('payment', ['card']).serialize().config).toEqual({ set: ['card']});
	});

	describe('deserialize', () => {
		it('revives arrayMatch through JSON', () => {
			const original = new InSetRule<string>('payment', ['card', 'cash'], { arrayMatch: 'all' });
			const revived = InSetRule.deserialize(JSON.parse(JSON.stringify(original.serialize())) as SerializedRule);

			expect(revived).toBeInstanceOf(InSetRule);
			expect(revived.config).toEqual(original.config);
			expect(revived.action({ payment: ['card']}, revived)).toBe(false);
			expect(revived.action({ payment: ['card', 'cash']}, revived)).toBe(true);
		});

		it('keeps a config without arrayMatch as written', () => {
			const revived = InSetRule.deserialize({ config: { set: ['a']}, field: 'tag', type: 'InSetRule' });

			expect(revived.config).toEqual({ set: ['a']});
			expect(revived.field).toBe('tag');
		});

		it('rejects an unknown arrayMatch and a config that is not an object', () => {
			for (const config of [{ arrayMatch: 'some', set: []}, null, 'a']) {
				const json = { config, field: 'tag', type: 'InSetRule' };

				expect(() => InSetRule.deserialize(json)).toThrowError(FilterEngineRuleError);
			}
			expect(() => InSetRule.deserialize({ config: { arrayMatch: 'some', set: []}, field: 'tag', type: 'InSetRule' }))
				.toThrowError(/InSetRule config\.arrayMatch must be 'any' or 'all'; got "some"/u);
		});

		it('revives as the class registered under its name', () => {
			class AuditedInSet extends InSetRule {
				static override readonly ruleTypeName = 'InSetRule';
			}
			const registry = new RuleRegistry();

			registry.unregister('InSetRule');
			registry.register('InSetRule', AuditedInSet);

			expect(registry.deserialize({ config: { set: ['a']}, field: 'tag', type: 'InSetRule' })).toBeInstanceOf(AuditedInSet);
		});
	});
});
