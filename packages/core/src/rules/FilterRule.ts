/**
 * The abstract base class for all filter rules — built-in AND consumer-supplied.
 *
 * @remarks
 * `FilterRule` is the load-bearing abstraction of the entire engine. Its contract is
 * intentionally minimal — three properties (`config`, `field`, `action`) plus one helper
 * (`getFieldValue`) plus a serialize/deserialize round-trip. Everything else in the rule
 * catalog (15 concrete rules, the `CompositeRule` expression algebra, consumer extensions)
 * builds on this base.
 *
 * The pattern is **Template Method** + **Specification** + **Functional Lens** rolled together
 * (per `docs/architecture.md` §18). The `Template Method` is `getFieldValue` (consumers
 * override `action`, the base supplies the lens-resolution machinery). The `Specification` is
 * the predicate contract itself. The `FieldExtractor` is the lens.
 *
 * @example Subclassing for a custom rule
 *   class MinTagMatchRule extends FilterRule {
 *     config: { required: string[]; minMatches: number };
 *
 *     constructor(field: FieldExtractor, required: string[], minMatches: number) {
 *       super(field);
 *       this.config = { required, minMatches };
 *     }
 *
 *     override action: FilterRuleAction = (item, rule) => {
 *       const tags = this.getFieldValue(item) as string[] | undefined;
 *       if (!tags) return false;
 *       const cfg = (rule as MinTagMatchRule).config;
 *       const matches = tags.filter((t) => cfg.required.includes(t)).length;
 *       return matches >= cfg.minMatches;
 *     };
 *   }
 *
 * @packageDocumentation
 */

import type { FieldExtractor, FilterRuleAction, SerializedRule } from '../types.js';

import { FilterEngineRuleError } from '../errors/index.js';
import { getPath } from '../lib/getPath.js';
import { isNil } from '../lib/internal.js';
import { getRuleTypeName } from './ruleTypeName.js';

// #region docs:filter-rule-contract
/**
 * Abstract base for all filter rules. Subclass to create custom rule types.
 *
 * @remarks
 * Subclasses MUST:
 *   1. Define a typed `config` shape (replacing the base `unknown`)
 *   2. Provide an `action` predicate that consults `this.getFieldValue(item)` to test items
 *   3. Declare `static readonly ruleTypeName = '<TheirName>'` if they are to be serializable
 *      (see {@link FilterRule.ruleTypeName})
 *
 * Subclasses MAY:
 *   - Override `serialize()` for non-JSON-safe configs (e.g., RegExp, Date)
 *   - Register themselves with the global `ruleRegistry` to participate in JSON-config
 *     loading, URL-state round-trip, worker-bridge serialization, and devtools persistence
 */
export abstract class FilterRule {
	/**
	 * The stable wire name for this rule class — what `serialize()` writes as `type` and what
	 * `ruleRegistry.deserialize` looks up.
	 *
	 * @remarks
	 * **Declare it as a literal, not annotated as `string`:**
	 *
	 * ```ts
	 * class ContainsAllRule extends FilterRule {
	 *   static override readonly ruleTypeName = 'ContainsAllRule';
	 * }
	 * ruleRegistry.register('ContainsAllRule', ContainsAllRule);
	 * ```
	 *
	 * The literal type is what lets `ruleRegistry.register` reject a name that disagrees with the
	 * class **at compile time** — an annotated `: string` widens it and gives that check nothing
	 * to bite on.
	 *
	 * The wire name is never read from `this.constructor.name`, because a minifier rewrites class
	 * identifiers: a production build would label `InSetRule` as `d` while the registry's keys
	 * (string literals) stay intact, so nothing it serialized could be revived. See
	 * `./ruleTypeName.ts` for the details.
	 *
	 * The base's own value is the sentinel for "this class never declared one". It is safe as a
	 * sentinel because `FilterRule` is abstract and can never itself be registered.
	 */
	static readonly ruleTypeName: string = 'FilterRule';

	/**
	 * Rule-specific configuration. Subclasses narrow this to a specific shape.
	 */
	abstract config: unknown;

	/**
	 * How to pull the value-to-test out of an item.
	 *
	 * See {@link FieldExtractor} for the four supported forms (undefined / string path /
	 * string-path array / function).
	 */
	field: FieldExtractor;

	/**
	 * The predicate. Subclasses override; the base default returns `true` (i.e., a no-op rule
	 * matches every item).
	 *
	 * Receives both the item AND the rule itself so subclasses can access `config` via a typed
	 * narrowing cast.
	 */
	action: FilterRuleAction = (): boolean => true;

	/**
	 * @param field - Optional FieldExtractor to install on construction. Subclasses' factory
	 *                functions typically pass this through from consumer-friendly constructor
	 *                arguments.
	 */
	constructor(field?: FieldExtractor) {
		this.field = field;
	}
	// #endregion docs:filter-rule-contract

	// #region docs:get-field-value
	/**
	 * Pull the field value out of an item using this rule's `FieldExtractor`. Intended for use
	 * inside subclass `action` implementations.
	 *
	 * Resolution rules:
	 *   - If `item` is null/undefined → `undefined`
	 *   - If `field` is undefined → the item itself (item-as-value)
	 *   - If `field` is a function → invoke with the item
	 *   - If `field` is a string → resolve as a dotted/bracketed path via `getPath`
	 *   - If `field` is a string array → try each path in order; return first defined match
	 *
	 * @param item - The item to extract from
	 * @returns The extracted value, or `undefined` if not present
	 */
	protected getFieldValue(item: unknown): unknown {
		if (isNil(item)) {
			return undefined;
		}
		if (this.field === undefined) {
			return item;
		}
		if (typeof this.field === 'function') {
			return this.field(item);
		}
		if (typeof this.field === 'string') {
			return getPath(item, this.field);
		}

		// Array of paths — try each until we get a non-undefined value.
		for (const path of this.field) {
			const value = getPath(item, path);

			if (value !== undefined) {
				return value;
			}
		}

		return undefined;
	}
	// #endregion docs:get-field-value

	/**
	 * Get ready to evaluate `action` over the items of `collection`. The engine calls this once
	 * before every pass that runs `action` across a collection (the results pass, a bitmap build,
	 * `applyFiltersAndQuery`, the filtered-except-self projection, a simulation), always with the
	 * collection the pass then iterates; a `CompositeRule` passes the call to its children.
	 *
	 * @remarks
	 * The base implementation does nothing: most rules judge each item on its own. A rule that
	 * answers faster for a whole collection than one item at a time overrides it to work out its
	 * answers here, ahead of the per-item `action` calls. `FuzzySearchRule` builds one Fuse.js index
	 * over the collection and searches it once.
	 *
	 * An override must keep `action` exact on its own: `action` may still be called for an item
	 * outside the last prepared collection (a consumer calling it directly, a simulation over other
	 * data), and must answer it as if `prepareForCollection` had never run. Prepared answers are tied
	 * to the collection array and the rule's `config` object; replacing either (rather than mutating
	 * it in place, as everywhere else in the engine) is what makes the next call prepare afresh.
	 *
	 * @param collection - The items the coming pass will call `action` on
	 */
	// eslint-disable-next-line class-methods-use-this -- the base hook is a no-op that subclasses override
	prepareForCollection(collection: readonly unknown[]): void {
		// Nothing to prepare for a rule that judges each item on its own.
		void collection;
	}

	/**
	 * Serialize this rule to its JSON shape for round-tripping through:
	 *   - JSON config export (`engine.exportConfig()`)
	 *   - URL state (`@filter-enginez/url-state-router`)
	 *   - Worker-bridge postMessage
	 *   - Devtools snapshot persistence
	 *
	 * Default implementation assumes the rule's `config` is JSON-safe. Subclasses with
	 * non-JSON-safe configs (e.g., `RegexRule` with a RegExp, `DateRangeRule` with Date
	 * instances) MUST override.
	 *
	 * The emitted `type` is {@link FilterRule.ruleTypeName}, NOT `this.constructor.name` — see
	 * that member's docs and `./ruleTypeName.ts` for why the latter is unusable in a minified
	 * build.
	 *
	 * @returns A `SerializedRule` shape consumable by `ruleRegistry.deserialize`
	 * @throws `FilterEngineRuleError` with code `RULE_TYPE_NAME_MISSING` if the rule's class never
	 *   declared `static readonly ruleTypeName`. Failing
	 *   here is deliberate: the alternative is emitting a `type` that no registry entry matches,
	 *   which surfaces later, somewhere else, inside a `catch`. `PredicateRule.serialize` throws
	 *   for the same reason.
	 */
	serialize(): SerializedRule {
		const ruleTypeName = getRuleTypeName(this);

		if (ruleTypeName === FilterRule.ruleTypeName) {
			throw new FilterEngineRuleError(
				'RULE_TYPE_NAME_MISSING',
				`${this.constructor.name} cannot be serialized — it does not declare `
				+ `\`static readonly ruleTypeName\`. Add it (matching the name you pass to `
				+ `ruleRegistry.register) so the rule survives minification; see `
				+ `@filter-enginez/core's FilterRule.ruleTypeName.`,
			);
		}

		return {
			config: this.config,
			field: typeof this.field === 'function' ? '<function>' : this.field,
			type: ruleTypeName,
		};
	}
}

/**
 * Call `rule.prepareForCollection(collection)` when the rule has it. Every engine pass prepares its
 * rules through this, rather than calling the method directly, because a rule may come from
 * elsewhere: a subclass of another installed copy of `@filter-enginez/core`, or a plain object
 * written to the `FilterRule` shape. Such a rule has nothing to prepare, and is evaluated by its
 * `action` alone.
 *
 * @param rule - The rule (or composite tree) about to be evaluated
 * @param collection - The items the coming pass will evaluate
 */
export function prepareRuleForCollection(rule: FilterRule, collection: readonly unknown[]): void {
	const { prepareForCollection } = rule as Partial<Pick<FilterRule, 'prepareForCollection'>>;

	if (typeof prepareForCollection === 'function') {
		prepareForCollection.call(rule, collection);
	}
}
