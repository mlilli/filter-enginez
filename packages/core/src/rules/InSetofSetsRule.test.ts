/**
 * Tests for `InSetofSetsRule` — membership in any subset of a set-of-sets, plus `toggleSetValues`.
 *
 * @remarks
 * Covers the value-in-some-subset pass and value-in-no-subset reject predicate paths, the
 * empty set-of-sets no-op path, the default empty constructor, both `toggleSetValues` branches
 * (append a new subset by deep-inequality, remove an existing subset by deep-equality), and the
 * serialized shape. Array-valued fields under `arrayMatch` `'any'` (the default) and `'all'`, the
 * empty array, and the `static deserialize` hook that checks `arrayMatch`.
 */

import { describe, expect, it } from 'vitest';

import type { SerializedRule } from '../types.js';

import { FilterEngineRuleError } from '../errors/index.js';
import { InSetofSetsRule } from './InSetofSetsRule.js';

describe('InSetofSetsRule', () => {
	it('passes items whose field value appears in any configured subset', () => {
		const rule = new InSetofSetsRule<string>('size', [
			['xs', 's'],
			['xl', 'xxl'],
		]);

		expect(rule.action({ size: 'xl' }, rule)).toBe(true);
	});

	it('rejects items whose field value appears in no subset', () => {
		const rule = new InSetofSetsRule<string>('size', [
			['xs', 's'],
			['xl', 'xxl'],
		]);

		expect(rule.action({ size: 'm' }, rule)).toBe(false);
	});

	it('matches every item when the set-of-sets is empty (no-op rule)', () => {
		const rule = new InSetofSetsRule<string>('size', []);

		expect(rule.action({ size: 'm' }, rule)).toBe(true);
	});

	it('defaults to an empty set-of-sets when no initial sets are supplied', () => {
		const rule = new InSetofSetsRule<string>('size');

		expect(rule.config.set).toEqual([]);
		expect(rule.action({ size: 'anything' }, rule)).toBe(true);
	});

	it('toggleSetValues appends a subset that is not already present', () => {
		const rule = new InSetofSetsRule<string>('size', [['xs', 's']]);

		rule.toggleSetValues(['xl', 'xxl']);

		expect(rule.config.set).toEqual([
			['xs', 's'],
			['xl', 'xxl'],
		]);
		expect(rule.action({ size: 'xxl' }, rule)).toBe(true);
	});

	it('toggleSetValues removes a subset already present by deep equality', () => {
		const rule = new InSetofSetsRule<string>('size', [
			['xs', 's'],
			['xl', 'xxl'],
		]);

		rule.toggleSetValues(['xs', 's']);

		expect(rule.config.set).toEqual([['xl', 'xxl']]);
		expect(rule.action({ size: 'xs' }, rule)).toBe(false);
	});

	it('serializes to its type, field, and set-of-sets config', () => {
		const rule = new InSetofSetsRule<string>('size', [['xs', 's']]);

		expect(rule.serialize()).toEqual({
			config: { set: [['xs', 's']]},
			field: 'size',
			type: 'InSetofSetsRule',
		});
	});

	describe('an array-valued field', () => {
		const groups: readonly (readonly string[])[] = [['it-pie', 'it-ven'], ['fr-bdx']];
		const holds = (rule: InSetofSetsRule<string>, regions: readonly string[]): boolean => rule.action({ regions }, rule);

		it('matches when any element is in any subset, by default', () => {
			const rule = new InSetofSetsRule<string>('regions', groups);

			expect(holds(rule, ['us-ca', 'it-ven'])).toBe(true);
			expect(holds(rule, ['us-ca'])).toBe(false);
		});

		it('matches under "all" only when every subset has a value in the array', () => {
			const rule = new InSetofSetsRule<string>('regions', groups, { arrayMatch: 'all' });

			expect(holds(rule, ['it-pie', 'fr-bdx'])).toBe(true);
			expect(holds(rule, ['it-pie', 'it-ven'])).toBe(false);
		});

		it('fails an empty array under either mode, and no subsets pass it', () => {
			expect(holds(new InSetofSetsRule<string>('regions', groups), [])).toBe(false);
			expect(holds(new InSetofSetsRule<string>('regions', groups, { arrayMatch: 'all' }), [])).toBe(false);
			expect(holds(new InSetofSetsRule<string>('regions', [], { arrayMatch: 'all' }), [])).toBe(true);
		});

		it('reads a single value exactly as before under "all"', () => {
			const rule = new InSetofSetsRule<string>('regions', groups, { arrayMatch: 'all' });

			expect(rule.action({ regions: 'fr-bdx' }, rule)).toBe(true);
		});
	});

	it('keeps arrayMatch across both toggleSetValues branches', () => {
		const rule = new InSetofSetsRule<string>('size', [['xs']], { arrayMatch: 'all' });

		rule.toggleSetValues(['xl']);
		expect(rule.config).toEqual({ arrayMatch: 'all', set: [['xs'], ['xl']]});
		rule.toggleSetValues(['xs']);
		expect(rule.config).toEqual({ arrayMatch: 'all', set: [['xl']]});
	});

	describe('deserialize', () => {
		it('revives arrayMatch through JSON', () => {
			const original = new InSetofSetsRule<string>('regions', [['a'], ['b']], { arrayMatch: 'all' });
			const revived = InSetofSetsRule.deserialize(JSON.parse(JSON.stringify(original.serialize())) as SerializedRule);

			expect(revived).toBeInstanceOf(InSetofSetsRule);
			expect(revived.config).toEqual(original.config);
			expect(revived.field).toBe('regions');
		});

		it('rejects an unknown arrayMatch', () => {
			const json = { config: { arrayMatch: 'every', set: []}, field: 'regions', type: 'InSetofSetsRule' };

			expect(() => InSetofSetsRule.deserialize(json)).toThrowError(FilterEngineRuleError);
			expect(() => InSetofSetsRule.deserialize(json)).toThrowError(/InSetofSetsRule config\.arrayMatch/u);
		});
	});
});
