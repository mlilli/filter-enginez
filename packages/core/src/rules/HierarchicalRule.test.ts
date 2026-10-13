/**
 * Tests for `HierarchicalRule` — tree-membership filter where selecting a node includes that node
 * and all its descendants.
 *
 * @remarks
 * Covers the `action` (non-string fail, empty-selection no-op, exact-node match, descendant match,
 * miss) plus both recursive helpers across all their branches: `isInSubtreeRootedAt` walking
 * children to find the selected root (including a child-miss that returns false), and
 * `containsAnyDescendant` matching a node's own id, a deep descendant, and exhausting a childless
 * leaf without a match.
 */

import { describe, expect, it } from 'vitest';

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
});
