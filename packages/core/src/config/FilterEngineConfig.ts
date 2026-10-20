/**
 * `FilterEngineConfig` — the JSON-driven, serializable engine-configuration shape.
 *
 * @remarks
 * Per `docs/architecture.md` §9 (JSON-Driven Config Mode). The full set of rules, filter
 * groups, and (optionally) an expression tree can be expressed as a JSON document that the
 * engine consumes via `loadConfig(engine, jsonConfig)`. This is the third engine mode (alongside
 * flat-map and expression modes — see `EngineMode` in `store/InternalStore.ts`) and is the
 * primary integration path for backend-driven filter UX (an API endpoint returns the entire
 * filter taxonomy for the current dataset, and the engine instantiates it without per-rule
 * imperative wiring on the client).
 *
 * **Versioning.** Configs carry an integer `version` field so `ConfigMigrator` can migrate
 * older shapes forward when the schema evolves. Current shape is `version: 1`.
 *
 * **Serialization symmetry.** Every rule's `serialize()` method produces a `SerializedRule`,
 * and the registry's `deserialize(serializedRule)` reverses the transformation. This file
 * defines the outer wrapper around the array of `SerializedRule`s (plus groups/expression).
 *
 * @packageDocumentation
 */

import type { RuleId, SerializedRule } from '../types.js';

/**
 * Serialized form of a `FilterGroup` — JSON-safe equivalent for config round-trips.
 *
 * @remarks
 * Mirrors `FilterGroup` from `composition/FilterGroup.ts` but without any non-serializable
 * fields. Filter groups give consumers the "facet panel" UX affordance: rules within a single
 * group OR together (typical for "color: red OR white OR rosé"), and groups AND together
 * across the engine.
 */
export interface SerializedFilterGroup {
	readonly id: string;
	readonly displayName?: string;
	readonly filterIds: readonly RuleId[];
	/** `'and'` or `'or'` — defaults to `'or'` per the facet-panel UX convention. */
	readonly composition?: 'and' | 'or';
}

// #region docs:config-document
/**
 * Serialized expression tree node — recursive `CompositeRule` shape for JSON round-trip.
 *
 * @remarks
 * A leaf node is `{ type: 'rule', ruleId }` — a reference to a rule defined in the top-level
 * `rules` array of the config (so the same rule can appear multiple places in the tree
 * without duplication). Composite nodes recurse via `children`.
 */
export type SerializedExpressionNode =
	| {
		readonly children: readonly SerializedExpressionNode[];
		readonly op: 'and' | 'not' | 'or';
		readonly type: 'composite';
	}
	| {
		readonly ruleId: RuleId;
		readonly type: 'rule';
	};

/**
 * The full engine configuration document.
 *
 * @example
 *   const config: FilterEngineConfig = {
 *     version: 1,
 *     rules: [
 *       { id: 'price-range', rule: { type: 'RangeRule', field: 'price', config: { min: 0, max: 100 } } },
 *       { id: 'in-stock', rule: { type: 'BooleanRule', field: 'inStock', config: true } },
 *     ],
 *     groups: [
 *       { id: 'commerce', displayName: 'Commerce', filterIds: ['price-range', 'in-stock'], composition: 'and' },
 *     ],
 *     // Optionally an expression tree — when present, switches engine to expression mode.
 *     expression: {
 *       type: 'composite',
 *       op: 'and',
 *       children: [
 *         { type: 'rule', ruleId: 'price-range' },
 *         { type: 'rule', ruleId: 'in-stock' },
 *       ],
 *     },
 *   };
 */
export interface FilterEngineConfig {
	/** Schema version — drives `ConfigMigrator` decisions. Current schema is `1`. */
	readonly version: number;

	/** Optional human-readable label for the config (devtools display + debugging). */
	readonly label?: string;

	/**
	 * The rule definitions — each entry pairs a `RuleId` with its serialized form. An entry marked
	 * `inline: true` is a leaf of `expression` that was never registered on the engine: `loadConfig`
	 * resolves the expression's references to it but does not register it, so it stops filtering
	 * when the expression is cleared, exactly as it did before export.
	 */
	readonly rules: readonly {
		readonly id: RuleId;
		/**
		 * `true` for an expression leaf that is not a registered rule. Ids of the form
		 * `__inline_<n>` are reserved for these; an entry with such an id that the expression
		 * references is read as inline even without the flag.
		 */
		readonly inline?: boolean;
		readonly rule: SerializedRule;
	}[];

	/** Optional filter groups. Empty/omitted means no facet grouping. */
	readonly groups?: readonly SerializedFilterGroup[];

	/**
	 * Optional explicit expression tree. When present, the engine enters expression mode and
	 * evaluates this tree instead of implicitly ANDing every rule (flat-map mode).
	 */
	readonly expression?: SerializedExpressionNode;

	/** Arbitrary consumer-defined metadata. Round-trips through serialization untouched. */
	readonly metadata?: Readonly<Record<string, unknown>>;
}
// #endregion docs:config-document

/**
 * The current schema version. Bump when introducing a backwards-incompatible config shape
 * change and add a corresponding migration step to `ConfigMigrator`.
 */
export const CURRENT_CONFIG_VERSION = 1;
