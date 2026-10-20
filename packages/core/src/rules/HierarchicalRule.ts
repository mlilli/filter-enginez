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
 * The field holds a node id (a string). An empty `selected` array constrains nothing: it passes
 * every item whose field is a string or an array, and an item whose field is neither fails
 * whatever is selected.
 *
 * **Array-valued fields.** A field holding an array of node ids (a product listed under several
 * categories) is read as a set, and `config.arrayMatch` decides how it meets the selection:
 * `'any'` (the default) passes when at least one id lies in a selected subtree, `'all'` when every
 * selected subtree holds at least one of the ids. Elements that are not strings never match, and
 * an empty array fails any non-empty selection. See `./arrayMatch.ts`.
 *
 * @packageDocumentation
 */

import type { FieldExtractor, FilterRuleAction, SerializedRule } from '../types.js';

import { type ArrayMatch, matchesArraySelection, readArrayMatchConfig } from './arrayMatch.js';
import { FilterRule } from './FilterRule.js';
import { revivedField } from './serializedConfig.js';

/** A constructor with `HierarchicalRule`'s signature: the class itself, or a subclass that keeps it. */
type HierarchicalRuleClass = new (field: FieldExtractor, config: HierarchicalRuleConfig) => HierarchicalRule;

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
	/**
	 * How an array-valued field meets `selected`: `'any'` (default) passes when at least one id lies
	 * in a selected subtree, `'all'` when every selected subtree holds one. Ignored for a string field.
	 */
	readonly arrayMatch?: ArrayMatch;
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

	/**
	 * Passes a string field inside a selected subtree, or an array field whose ids meet the selection
	 * per `config.arrayMatch`; anything else fails. Nothing selected passes every string or array field.
	 */
	override action: FilterRuleAction = (item, rule): boolean => {
		const fieldValue = this.getFieldValue(item);

		if (typeof fieldValue !== 'string' && !Array.isArray(fieldValue)) {
			return false;
		}
		const { arrayMatch, selected, tree } = (rule as HierarchicalRule).config;

		if (selected.length === 0) {
			return true;
		}
		if (typeof fieldValue === 'string') {
			return selected.some((selectedId) => isInSubtreeRootedAt(tree, selectedId, fieldValue));
		}

		return matchesArraySelection(fieldValue, selected, arrayMatch, (selectedId, element) =>
			typeof element === 'string' && isInSubtreeRootedAt(tree, selectedId, element));
	};

	config: HierarchicalRuleConfig;

	constructor(field: FieldExtractor, config: HierarchicalRuleConfig) {
		super(field);
		this.config = config;
	}
	// #endregion docs:hierarchical-rule

	/**
	 * Revive a `HierarchicalRule` from its serialized form. `ruleRegistry.deserialize` calls this hook
	 * with the registered class as `this`, so a subclass registered in its place revives as itself.
	 *
	 * @param json - The serialized rule
	 * @returns The revived rule, its `config` exactly as serialized
	 * @throws `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG` when `config` is not an
	 *   object, or `arrayMatch` is present and neither `'any'` nor `'all'`
	 */
	static deserialize(this: HierarchicalRuleClass, json: SerializedRule): HierarchicalRule {
		return new this(revivedField(json), readArrayMatchConfig(json) as unknown as HierarchicalRuleConfig);
	}
}

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
