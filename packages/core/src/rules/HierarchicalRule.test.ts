/**
 * Tests for `HierarchicalRule` — tree-membership filter where selecting a node includes that node
 * and all its descendants.
 *
 * @remarks
 * Covers the `action` (non-string fail, empty-selection no-op, exact-node match, descendant match,
 * miss) plus both recursive helpers across all their branches: `isInSubtreeRootedAt` walking
 * children to find the selected root (including a child-miss that returns false), and
 * `containsAnyDescendant` matching a node's own id, a deep descendant, and exhausting a childless
 * leaf without a match. Array-valued fields under `arrayMatch` `'any'` (the default) and
 * `'all'` (non-string elements never match, the empty array, nothing selected), and the
 * `static deserialize` hook that checks `arrayMatch`.
 */

import { describe, expect, it } from 'vitest';

import type { SerializedRule } from '../types.js';

import { FilterEngineRuleError } from '../errors/index.js';
import { HierarchicalRule, type TreeNode } from './HierarchicalRule.js';

const tree: TreeNode = {
	children: [
		{
			children: [{ id: 'smartphones' }, { id: 'flip-phones' }],
			id: 'phones',
		},
		{ id: 'laptops' },
	],
	id: 'electronics',
};

describe('HierarchicalRule', () => {
	it('fails when the field value is not a string', () => {
		const rule = new HierarchicalRule('categoryId', { selected: ['phones'], tree });

		expect(rule.action({ categoryId: 7 }, rule)).toBe(false);
	});

	it('matches everything when nothing is selected', () => {
		const rule = new HierarchicalRule('categoryId', { selected: [], tree });

		expect(rule.action({ categoryId: 'anything' }, rule)).toBe(true);
	});

	it('matches an item whose value equals the selected node itself', () => {
		const rule = new HierarchicalRule('categoryId', { selected: ['phones'], tree });

		expect(rule.action({ categoryId: 'phones' }, rule)).toBe(true);
	});

	it('matches an item that is a descendant of the selected node', () => {
		const rule = new HierarchicalRule('categoryId', { selected: ['phones'], tree });

		expect(rule.action({ categoryId: 'smartphones' }, rule)).toBe(true);
	});

	it('matches a descendant of the root when the root itself is selected', () => {
		const rule = new HierarchicalRule('categoryId', { selected: ['electronics'], tree });

		expect(rule.action({ categoryId: 'flip-phones' }, rule)).toBe(true);
	});

	it('does not match a value outside the selected subtree', () => {
		const rule = new HierarchicalRule('categoryId', { selected: ['phones'], tree });

		expect(rule.action({ categoryId: 'laptops' }, rule)).toBe(false);
	});

	it('does not match when the value is absent from the tree entirely', () => {
		const rule = new HierarchicalRule('categoryId', { selected: ['phones'], tree });

		expect(rule.action({ categoryId: 'unknown-category' }, rule)).toBe(false);
	});

	it('returns false when the selected id is not anywhere in the tree', () => {
		const rule = new HierarchicalRule('categoryId', { selected: ['missing-node'], tree });

		expect(rule.action({ categoryId: 'phones' }, rule)).toBe(false);
	});

	it('handles a selected leaf node with no children', () => {
		const rule = new HierarchicalRule('categoryId', { selected: ['laptops'], tree });

		expect(rule.action({ categoryId: 'laptops' }, rule)).toBe(true);
		expect(rule.action({ categoryId: 'phones' }, rule)).toBe(false);
	});

	it('serializes to the inherited JSON shape', () => {
		const rule = new HierarchicalRule('categoryId', { selected: ['phones'], tree });

		expect(rule.serialize()).toEqual({
			config: { selected: ['phones'], tree },
			field: 'categoryId',
			type: 'HierarchicalRule',
		});
	});

	describe('an array-valued field', () => {
		const listed = (rule: HierarchicalRule, categoryIds: readonly unknown[]): boolean => rule.action({ categoryIds }, rule);

		it('matches when any id lies in a selected subtree, by default; other elements never match', () => {
			const rule = new HierarchicalRule('categoryIds', { selected: ['phones'], tree });

			expect(listed(rule, [7, 'laptops', 'flip-phones'])).toBe(true);
			expect(listed(rule, ['laptops', 7, null])).toBe(false);
		});

		it('matches under "all" only when every selected subtree holds an id', () => {
			const rule = new HierarchicalRule('categoryIds', { arrayMatch: 'all', selected: ['phones', 'laptops'], tree });

			expect(listed(rule, ['smartphones', 'laptops'])).toBe(true);
			expect(listed(rule, ['smartphones', 'flip-phones'])).toBe(false);
		});

		it('fails an empty array when something is selected, and passes any array when nothing is', () => {
			expect(listed(new HierarchicalRule('categoryIds', { selected: ['phones'], tree }), [])).toBe(false);
			expect(listed(new HierarchicalRule('categoryIds', { arrayMatch: 'all', selected: ['phones'], tree }), [])).toBe(false);
			expect(listed(new HierarchicalRule('categoryIds', { selected: [], tree }), [])).toBe(true);
		});
	});

	describe('deserialize', () => {
		it('revives arrayMatch through JSON', () => {
			const original = new HierarchicalRule('categoryIds', { arrayMatch: 'all', selected: ['phones'], tree });
			const revived = HierarchicalRule.deserialize(JSON.parse(JSON.stringify(original.serialize())) as SerializedRule);

			expect(revived).toBeInstanceOf(HierarchicalRule);
			expect(revived.config).toEqual(original.config);
			expect(revived.field).toBe('categoryIds');
		});

		it('rejects an unknown arrayMatch', () => {
			const json = { config: { arrayMatch: true, selected: [], tree }, field: 'categoryIds', type: 'HierarchicalRule' };

			expect(() => HierarchicalRule.deserialize(json)).toThrowError(FilterEngineRuleError);
			expect(() => HierarchicalRule.deserialize(json)).toThrowError(/HierarchicalRule config\.arrayMatch must be 'any' or 'all'; got true/u);
		});
	});
});
