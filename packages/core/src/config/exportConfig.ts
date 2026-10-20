/**
 * `exportConfig` — capture a `FilterEngine`'s current rule/group/expression state as a
 * serializable `FilterEngineConfig` document.
 *
 * @remarks
 * Per `docs/architecture.md` §9.3. The inverse of `loadConfig`. Round-trip: `loadConfig(engine,
 * exportConfig(engine))` should produce an equivalent engine state.
 *
 * Serializes each registered rule via `rule.serialize()`, walks the expression tree into a
 * recursive `SerializedExpressionNode`, and serializes groups. It reads the engine through a
 * structural interface ({@link ExportConfigEngineSource}), not the `FilterEngine` class.
 *
 * **Stable rule-id assignment in expression export.** Inline `CompositeRule` trees (rules
 * created via `and(rule1, rule2)` without first registering them via `engine.addRule(id, ...)`)
 * don't have stable IDs the consumer can reference. The exporter mints synthetic IDs of the
 * form `'__inline_{n}'` for these, one per distinct rule instance, numbered in depth-first order
 * and skipping any id a registered rule already holds, and marks their entries `inline: true`.
 * `loadConfig` resolves the expression through those entries without registering them, so a
 * round trip reproduces the engine's state exactly: the same registered rules, the same
 * expression, and nothing more. The ids are ephemeral, not consumer-facing identifiers.
 *
 * @packageDocumentation
 */

import type { FilterGroup } from '../composition/FilterGroup.js';
import type { FilterRule } from '../rules/FilterRule.js';
import type { RuleId, SerializedRule } from '../types.js';

import { CompositeRule } from '../rules/CompositeRule.js';
import {
	CURRENT_CONFIG_VERSION,
	type FilterEngineConfig,
	type SerializedExpressionNode,
	type SerializedFilterGroup,
} from './FilterEngineConfig.js';

/**
 * The structural shape `exportConfig` needs from a `FilterEngine` to extract its state.
 *
 * @remarks
 * Mirrors `LoadConfigEngineTarget` — structural rather than nominal to avoid the circular
 * dependency with `FilterEngine.ts`. The class naturally satisfies this shape.
 */
export interface ExportConfigEngineSource {
	getExpression(): CompositeRule | null;
	getGroups(): readonly FilterGroup[];
	getRules(): ReadonlyMap<RuleId, FilterRule>;
}

/**
 * Options for `exportConfig`.
 */
export interface ExportConfigOptions {
	/** Human-readable label written into the resulting config. */
	readonly label?: string;
	/** Arbitrary metadata written into the resulting config. */
	readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Build a `SerializedFilterGroup` from a runtime `FilterGroup`.
 */
function serializeGroup(group: FilterGroup): SerializedFilterGroup {
	return {
		id: group.id,
		...(group.displayName !== undefined ? { displayName: group.displayName } : {}),
		composition: group.composition,
		filterIds: [...group.filterIds],
	};
}

/**
 * Walk a `CompositeRule` tree and produce its `SerializedExpressionNode` equivalent.
 *
 * Leaf rules are matched to their `RuleId` via the `ruleIdLookup` map, which the caller seeds
 * with `engine.getRules()`. A leaf that isn't in the lookup is an inline rule: it gets a
 * synthetic `__inline_{n}` id (the lowest `n` no registered or minted rule holds), added both to the
 * lookup, so a second occurrence of the same instance reuses it, and to the side-effects-out
 * `mintedInlineRules` map, so the caller can append it to the exported `rules` array.
 */
function serializeExpression(
	rule: FilterRule,
	ruleIdLookup: Map<FilterRule, RuleId>,
	registeredIds: ReadonlySet<RuleId>,
	mintedInlineRules: Map<RuleId, FilterRule>,
): SerializedExpressionNode {
	if (rule instanceof CompositeRule) {
		const composite = rule.config;

		return {
			children: composite.rules.map((child) =>
				serializeExpression(child, ruleIdLookup, registeredIds, mintedInlineRules),
			),
			op: composite.op,
			type: 'composite',
		};
	}

	const existingId = ruleIdLookup.get(rule);

	if (existingId !== undefined) {
		return { ruleId: existingId, type: 'rule' };
	}

	// Inline rule — mint a synthetic id no registered rule holds.
	let ordinal = mintedInlineRules.size;

	while (registeredIds.has(`__inline_${String(ordinal)}`) || mintedInlineRules.has(`__inline_${String(ordinal)}`)) {
		ordinal++;
	}
	const syntheticId = `__inline_${String(ordinal)}`;

	mintedInlineRules.set(syntheticId, rule);
	ruleIdLookup.set(rule, syntheticId);

	return { ruleId: syntheticId, type: 'rule' };
}

/**
 * Capture the engine's current state as a `FilterEngineConfig` document.
 *
 * @param engine - The engine to extract state from
 * @param options - Optional label/metadata to attach
 * @returns A `FilterEngineConfig` at `CURRENT_CONFIG_VERSION`
 */
export function exportConfig(
	engine: ExportConfigEngineSource,
	options: ExportConfigOptions = {},
): FilterEngineConfig {
	const registeredRules = engine.getRules();
	const ruleIdLookup = new Map<FilterRule, RuleId>();

	for (const [id, rule] of registeredRules) {
		ruleIdLookup.set(rule, id);
	}

	const serializedRules: { id: RuleId; inline?: boolean; rule: SerializedRule }[] = [];

	for (const [id, rule] of registeredRules) {
		serializedRules.push({ id, rule: rule.serialize() });
	}

	const expression = engine.getExpression();
	const mintedInlineRules = new Map<RuleId, FilterRule>();
	const serializedExpression = expression
		? serializeExpression(expression, ruleIdLookup, new Set(registeredRules.keys()), mintedInlineRules)
		: undefined;

	// Append the minted inline rules so the expression resolves, marked so loading leaves them
	// unregistered, as they are on this engine.
	for (const [id, rule] of mintedInlineRules) {
		serializedRules.push({ id, inline: true, rule: rule.serialize() });
	}

	const groups = engine.getGroups().map(serializeGroup);

	return {
		version: CURRENT_CONFIG_VERSION,
		...(options.label !== undefined ? { label: options.label } : {}),
		rules: serializedRules,
		...(groups.length > 0 ? { groups } : {}),
		...(serializedExpression !== undefined ? { expression: serializedExpression } : {}),
		...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
	};
}
