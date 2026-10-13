/**
 * Tests for `InSetofSetsRule` — membership in any subset of a set-of-sets, plus `toggleSetValues`.
 *
 * @remarks
 * Covers the value-in-some-subset pass and value-in-no-subset reject predicate paths, the
 * empty set-of-sets no-op path, the default empty constructor, both `toggleSetValues` branches
 * (append a new subset by deep-inequality, remove an existing subset by deep-equality), and the
 * serialized shape.
 */

import { describe, expect, it } from 'vitest';

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
});
