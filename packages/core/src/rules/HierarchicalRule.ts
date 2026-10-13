/**
 * `HierarchicalRule` — passes items whose extracted value matches any selected node or any
 * descendant of a selected node in a tree.
 *
 * @remarks
 * Used for category-tree filtering (Electronics → Phones → Smartphones), file-system
 * hierarchies, geographic hierarchies (Country → Region → City), org charts, anywhere the
 * filter dimension is hierarchical and "select this node" means "include this node and all
 * its descendants."
 *
 * Empty `selected` array is a no-op (matches everything).
 *
 * @packageDocumentation
 */

import type { FieldExtractor, FilterRuleAction } from '../types.js';

import { FilterRule } from './FilterRule.js';

// #region docs:hierarchical-rule
/**
 * A node in a filter hierarchy tree.
 */
export interface TreeNode {
	readonly id: string;
	readonly children?: readonly TreeNode[];
}

/**
 * Configuration for `HierarchicalRule`.
 */
export interface HierarchicalRuleConfig {
	readonly tree: TreeNode;
	/** IDs of selected nodes. Each selection includes the node itself + all descendants. */
	readonly selected: readonly string[];
}

/**
 * Filter items by hierarchical category membership.
 *
 * @example
 *   const categoryTree: TreeNode = {
 *     id: 'electronics',
 *     children: [
 *       { id: 'phones', children: [{ id: 'smartphones' }, { id: 'flip-phones' }] },
 *       { id: 'laptops' },
 *     ],
 *   };
 *
 *   // Items whose category is 'phones' or any descendant ('smartphones', 'flip-phones'):
 *   engine.addRule(
 *     'category',
 *     new HierarchicalRule('categoryId', { tree: categoryTree, selected: ['phones'] }),
 *   );
 */
export class HierarchicalRule extends FilterRule {
	/**
	 * Minifier-proof wire name — see {@link FilterRule.ruleTypeName}. Declared as a literal so
	 * `ruleRegistry.register` can reject a key that disagrees with it at compile time.
	 */
	static override readonly ruleTypeName = 'HierarchicalRule';

	override action: FilterRuleAction = (item, rule): boolean => {
		const fieldValue = this.getFieldValue(item);

		if (typeof fieldValue !== 'string') {
			return false;
		}
		const { selected, tree } = (rule as HierarchicalRule).config;

		if (selected.length === 0) {
			return true;
		}

		return selected.some((selectedId) => isInSubtreeRootedAt(tree, selectedId, fieldValue));
	};

	config: HierarchicalRuleConfig;

	constructor(field: FieldExtractor, config: HierarchicalRuleConfig) {
		super(field);
		this.config = config;
	}
}
// #endregion docs:hierarchical-rule

/**
 * Determine whether `target` appears in the subtree rooted at the node with id `rootId`,
 * searching from `node` downward.
 *
 * @internal
 */
function isInSubtreeRootedAt(node: TreeNode, rootId: string, target: string): boolean {
	if (node.id === rootId) {
		return containsAnyDescendant(node, target);
	}
	if (node.children) {
		for (const child of node.children) {
			if (isInSubtreeRootedAt(child, rootId, target)) {
				return true;
			}
		}
	}

	return false;
}

/**
 * Check if `target` is the node's own id or appears anywhere in its descendant subtree.
 *
 * @internal
 */
function containsAnyDescendant(node: TreeNode, target: string): boolean {
	if (node.id === target) {
		return true;
	}
	if (node.children) {
		for (const child of node.children) {
			if (containsAnyDescendant(child, target)) {
				return true;
			}
		}
	}

	return false;
}
