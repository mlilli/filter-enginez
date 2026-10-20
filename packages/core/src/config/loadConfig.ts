/**
 * `loadConfig` — apply a `FilterEngineConfig` document to a `FilterEngine` instance.
 *
 * @remarks
 * Per `docs/architecture.md` §9.3. The inverse of `exportConfig`. Walks the config document,
 * reconstructs every rule via the `ruleRegistry`, registers groups, and (if an expression
 * tree is present) sets the explicit expression on the engine.
 *
 * **Two phases.** {@link resolveConfig} migrates and rebuilds everything first, without touching
 * the engine; only then does `loadConfig` apply it through the engine's public methods (clear
 * existing state unless `clearExisting: false` → add rules → add groups → set expression).
 *
 * **Inline rules stay inline.** An expression leaf that was never registered on the exporting
 * engine travels as a `rules` entry marked `inline: true` (or, unmarked, under a reserved
 * `__inline_<n>` id the expression references). It is revived so the expression can reference it,
 * and never registered, so the loaded engine holds exactly the registered rules the exporting one
 * did, and clearing the expression leaves nothing behind that still filters.
 *
 * **Migration handling.** If `rawConfig.version !== CURRENT_CONFIG_VERSION`, the function
 * runs the config through `defaultMigrator.migrate()` first. Consumers needing custom migration
 * steps should register them on `defaultMigrator` before calling `loadConfig`, or pass a custom
 * migrator via the `options.migrator` parameter.
 *
 * @packageDocumentation
 */

import type { FilterGroup } from '../composition/FilterGroup.js';
import type { FilterRule } from '../rules/FilterRule.js';

import { FilterEngineConfigError } from '../errors/index.js';
import { CompositeRule } from '../rules/CompositeRule.js';
import { ruleRegistry as defaultRegistry, type RuleRegistry } from '../rules/ruleRegistry.js';
import { type ConfigMigrator, defaultMigrator } from './ConfigMigrator.js';
import { CURRENT_CONFIG_VERSION, type FilterEngineConfig, type SerializedExpressionNode } from './FilterEngineConfig.js';

/**
 * Options for `loadConfig`.
 */
export interface LoadConfigOptions {
	/**
	 * Custom rule registry — defaults to the shared module-level `ruleRegistry`. Override when
	 * loading config in an isolated context (e.g., worker thread with a different rule set
	 * registered, or test fixtures that shouldn't pollute the shared registry).
	 */
	readonly registry?: RuleRegistry;

	/**
	 * Custom migrator — defaults to the shared `defaultMigrator`. Override to apply consumer-
	 * specific migration steps without polluting the shared instance.
	 */
	readonly migrator?: ConfigMigrator;

	/**
	 * If `true`, the engine's existing rules/groups/expression are cleared before loading.
	 * Default `true` — load-config is typically a full state replacement.
	 */
	readonly clearExisting?: boolean;
}

/**
 * The structural shape `loadConfig` needs from a `FilterEngine` to apply a config.
 *
 * @remarks
 * Defined as a structural type (rather than importing `FilterEngine` directly) to avoid a
 * circular dependency between `config/` and the top-level `FilterEngine.ts`. The class
 * naturally satisfies this shape — TypeScript's structural typing connects them.
 */
export interface LoadConfigEngineTarget {
	addGroup(group: FilterGroup): void;
	addRule(ruleId: string, rule: FilterRule): void;
	clearRules(): void;
	setExpression(expression: CompositeRule | null): void;
}

/**
 * Reconstructed config artifacts — the materialized rules, groups, and (optional) expression
 * ready to be dispatched onto a `FilterEngine`. Exposed separately from `loadConfig` so
 * consumers can preview/validate a config before applying it.
 */
export interface ResolvedConfig {
	readonly expression: CompositeRule | null;
	readonly groups: readonly FilterGroup[];
	/**
	 * The rules to register, by id. An expression's inline rules are not among them; they live
	 * only inside `expression`.
	 */
	readonly rules: ReadonlyMap<string, FilterRule>;
}

/** The reserved id form `exportConfig` mints for an expression's inline rules. */
const INLINE_RULE_ID = /^__inline_\d+$/u;

/**
 * Collect every rule id an expression node references.
 *
 * @param node - The serialized expression, or `undefined` for none
 * @param into - The set to add the ids to
 * @returns `into`
 */
function referencedRuleIds(node: SerializedExpressionNode | undefined, into: Set<string>): Set<string> {
	if (node?.type === 'rule') {
		into.add(node.ruleId);
	} else if (node !== undefined) {
		for (const child of node.children) {
			referencedRuleIds(child, into);
		}
	}

	return into;
}

/**
 * Reconstruct a serialized expression node into a runtime `FilterRule` (either a leaf rule
 * reference or a recursively-composed `CompositeRule`).
 */
function buildExpression(
	node: SerializedExpressionNode,
	rulesById: ReadonlyMap<string, FilterRule>,
): FilterRule {
	if (node.type === 'rule') {
		const referenced = rulesById.get(node.ruleId);

		if (!referenced) {
			throw new FilterEngineConfigError(
				'CONFIG_UNKNOWN_RULE_ID',
				`loadConfig: expression references unknown ruleId '${node.ruleId}'. ` +
				`Make sure every leaf ruleId in the expression tree is also defined in config.rules.`,
			);
		}

		return referenced;
	}
	const children = node.children.map((child) => buildExpression(child, rulesById));

	return new CompositeRule(node.op, children);
}

/**
 * Reconstruct config artifacts without applying them to an engine. Useful for previewing /
 * validating a config before commit, or for diffing two configs.
 *
 * @throws `FilterEngineConfigError` (`CONFIG_VERSION_UNSUPPORTED`, `CONFIG_MIGRATION_MISSING`) when
 *   the document cannot be migrated, or (`CONFIG_UNKNOWN_RULE_ID`) when an expression leaf names a
 *   rule id the document does not define
 * @throws `FilterEngineRuleError` (including `RuleRegistryError`) when a serialized rule cannot be
 *   revived
 */
export function resolveConfig(
	rawConfig: FilterEngineConfig | Record<string, unknown>,
	options: LoadConfigOptions = {},
): ResolvedConfig {
	const registry = options.registry ?? defaultRegistry;
	const migrator = options.migrator ?? defaultMigrator;

	const migrated = (rawConfig as { version?: number }).version === CURRENT_CONFIG_VERSION
		? (rawConfig as FilterEngineConfig)
		: migrator.migrate(rawConfig as Record<string, unknown>);

	// Rebuild rules first — expression nodes reference these by id. Inline entries are revived for
	// the expression but kept out of the rules to register.
	const rulesById = new Map<string, FilterRule>();
	const registeredRules = new Map<string, FilterRule>();
	const expressionRuleIds = referencedRuleIds(migrated.expression, new Set());

	for (const entry of migrated.rules) {
		const rule = registry.deserialize(entry.rule);
		const isInline = entry.inline === true || (INLINE_RULE_ID.test(entry.id) && expressionRuleIds.has(entry.id));

		rulesById.set(entry.id, rule);
		if (!isInline) {
			registeredRules.set(entry.id, rule);
		}
	}

	const groups: FilterGroup[] = (migrated.groups ?? []).map((sg) => ({
		id: sg.id,
		...(sg.displayName !== undefined ? { displayName: sg.displayName } : {}),
		composition: sg.composition ?? 'or',
		filterIds: [...sg.filterIds],
	}));

	let expression: CompositeRule | null = null;

	if (migrated.expression) {
		const built = buildExpression(migrated.expression, rulesById);

		// Top-level expression must be a CompositeRule (or wrapped in one). If a single leaf is
		// at the top, wrap it in `and(...)` for type-uniformity.
		expression = built instanceof CompositeRule ? built : new CompositeRule('and', [built]);
	}

	return { expression, groups, rules: registeredRules };
}

/**
 * Apply a `FilterEngineConfig` document to a `FilterEngine`. Dispatches all mutations through
 * the engine's public API so the action log captures the replay sequence cleanly.
 *
 * @param engine - The engine to apply the config to
 * @param rawConfig - The config document (any version — auto-migrated to current)
 * @param options - Optional customizations (custom registry, migrator, clear behavior)
 * @throws Everything {@link resolveConfig} throws, before the engine is touched
 * @throws `FilterEngineModeError` (`MODE_EXPRESSION_ACTIVE`) when `clearExisting: false` keeps an
 *   active expression and the document carries flat rules but no expression of its own
 */
export function loadConfig(
	engine: LoadConfigEngineTarget,
	rawConfig: FilterEngineConfig | Record<string, unknown>,
	options: LoadConfigOptions = {},
): void {
	const resolved = resolveConfig(rawConfig, options);

	if (options.clearExisting !== false) {
		engine.clearRules();
	} else if (resolved.expression !== null) {
		// The document replaces the expression anyway. Dropping the old one first keeps the engine out
		// of expression mode while the rules land, where `addRule()` refuses a rule it would ignore.
		engine.setExpression(null);
	}

	for (const [ruleId, rule] of resolved.rules) {
		engine.addRule(ruleId, rule);
	}

	for (const group of resolved.groups) {
		engine.addGroup(group);
	}

	if (resolved.expression !== null) {
		engine.setExpression(resolved.expression);
	}
}
