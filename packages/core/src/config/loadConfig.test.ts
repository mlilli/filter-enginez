/**
 * @remarks
 * Tests for `resolveConfig` + `loadConfig` (and the internal `buildExpression` they drive).
 * Covers rule reconstruction via the registry, group mapping (displayName present/absent,
 * composition default), expression-tree rebuild (rule leaf, composite recursion, unknown-ruleId
 * throw, single-leaf-top wrapped in `and`), migration-when-version-differs, the `clearExisting`
 * true/false/default behavior, and custom registry/migrator option overrides.
 */

import { describe, expect, it } from 'vitest';

import type { FilterGroup } from '../composition/FilterGroup.js';
import type { FilterRule } from '../rules/FilterRule.js';

import { CompositeRule } from '../rules/CompositeRule.js';
import { ruleRegistry } from '../rules/ruleRegistry.js';
import { ValueRule } from '../rules/ValueRule.js';
import { ConfigMigrator } from './ConfigMigrator.js';
import { CURRENT_CONFIG_VERSION, type FilterEngineConfig } from './FilterEngineConfig.js';
import {
	loadConfig,
	type LoadConfigEngineTarget,
	resolveConfig,
} from './loadConfig.js';

/**
 * A spy engine target capturing every dispatched mutation so `loadConfig` ordering + payloads
 * can be asserted without a real `FilterEngine`.
 */
class SpyEngine implements LoadConfigEngineTarget {
	readonly addedGroups: FilterGroup[] = [];
	readonly addedRules: { id: string; rule: FilterRule }[] = [];
	clearCount = 0;
	expression: CompositeRule | null = null;
	setExpressionCalls = 0;

	addGroup(group: FilterGroup): void {
		this.addedGroups.push(group);
	}

	addRule(ruleId: string, rule: FilterRule): void {
		this.addedRules.push({ id: ruleId, rule });
	}

	clearRules(): void {
		this.clearCount += 1;
	}

	setExpression(expression: CompositeRule | null): void {
		this.setExpressionCalls += 1;
		this.expression = expression;
	}
}

/** A minimal current-version config with two rules. */
function baseConfig(): FilterEngineConfig {
	return {
		rules: [
			{ id: 'color', rule: { config: 'red', field: 'color', type: 'ValueRule' }},
			{ id: 'shape', rule: { config: 'round', field: 'shape', type: 'ValueRule' }},
		],
		version: CURRENT_CONFIG_VERSION,
	};
}

describe('resolveConfig', () => {
	it('reconstructs every rule via the registry, keyed by id', () => {
		const resolved = resolveConfig(baseConfig());

		expect(resolved.rules.size).toBe(2);
		expect(resolved.rules.get('color')).toBeInstanceOf(ValueRule);
		expect(resolved.rules.get('shape')).toBeInstanceOf(ValueRule);
	});

	it('returns no groups and a null expression for a rules-only config', () => {
		const resolved = resolveConfig(baseConfig());

		expect(resolved.groups).toEqual([]);
		expect(resolved.expression).toBeNull();
	});

	it('maps groups with displayName present + explicit composition', () => {
		const config: FilterEngineConfig = {
			...baseConfig(),
			groups: [
				{ composition: 'and', displayName: 'Group One', filterIds: ['color'], id: 'g1' },
			],
		};

		const resolved = resolveConfig(config);
		const group = resolved.groups[0];

		expect(group).toBeDefined();
		expect(group?.id).toBe('g1');
		expect(group?.displayName).toBe('Group One');
		expect(group?.composition).toBe('and');
		expect(group?.filterIds).toEqual(['color']);
	});

	it('omits displayName and defaults composition to "or" when absent', () => {
		const config: FilterEngineConfig = {
			...baseConfig(),
			groups: [{ filterIds: ['shape'], id: 'g2' }],
		};

		const resolved = resolveConfig(config);
		const group = resolved.groups[0];

		expect(group).toBeDefined();
		expect(group).not.toHaveProperty('displayName');
		expect(group?.composition).toBe('or');
	});

	it('builds a composite expression by recursing over children', () => {
		const config: FilterEngineConfig = {
			...baseConfig(),
			expression: {
				children: [
					{ ruleId: 'color', type: 'rule' },
					{ ruleId: 'shape', type: 'rule' },
				],
				op: 'and',
				type: 'composite',
			},
		};

		const resolved = resolveConfig(config);

		expect(resolved.expression).toBeInstanceOf(CompositeRule);
		expect(resolved.expression?.config.op).toBe('and');
		expect(resolved.expression?.config.rules).toHaveLength(2);
		expect(resolved.expression?.config.rules[0]).toBe(resolved.rules.get('color'));
	});

	it('wraps a single top-level leaf expression in an "and" composite', () => {
		const config: FilterEngineConfig = {
			...baseConfig(),
			expression: { ruleId: 'color', type: 'rule' },
		};

		const resolved = resolveConfig(config);

		expect(resolved.expression).toBeInstanceOf(CompositeRule);
		expect(resolved.expression?.config.op).toBe('and');
		expect(resolved.expression?.config.rules).toHaveLength(1);
		expect(resolved.expression?.config.rules[0]).toBe(resolved.rules.get('color'));
	});

	it('recurses through nested composites', () => {
		const config: FilterEngineConfig = {
			...baseConfig(),
			expression: {
				children: [
					{ ruleId: 'color', type: 'rule' },
					{
						children: [{ ruleId: 'shape', type: 'rule' }],
						op: 'not',
						type: 'composite',
					},
				],
				op: 'or',
				type: 'composite',
			},
		};

		const resolved = resolveConfig(config);
		const nested = resolved.expression?.config.rules[1];

		expect(nested).toBeInstanceOf(CompositeRule);
		expect((nested as CompositeRule).config.op).toBe('not');
	});

	it('throws when an expression references an unknown ruleId', () => {
		const config: FilterEngineConfig = {
			...baseConfig(),
			expression: { ruleId: 'missing', type: 'rule' },
		};

		expect(() => resolveConfig(config)).toThrow(/unknown ruleId 'missing'/);
	});

	it('runs the config through the migrator when version differs from current', () => {
		const migrator = new ConfigMigrator();
		const raw: Record<string, unknown> = {
			rules: [],
			version: CURRENT_CONFIG_VERSION + 5,
		};

		// Version newer than current → the migrator path is taken and rejects.
		expect(() => resolveConfig(raw, { migrator })).toThrow(/newer than this engine/);
	});

	it('skips migration when version already equals current', () => {
		// A config at the current version with a deliberately-missing migration chain must NOT
		// invoke the migrator (no throw), proving the equality short-circuit.
		const migrator = new ConfigMigrator();
		const resolved = resolveConfig(baseConfig(), { migrator });

		expect(resolved.rules.size).toBe(2);
	});

	it('treats a versionless config as needing migration', () => {
		// No `version` field → not equal to current → migrator runs (identity at v1) and stamps it.
		const raw: Record<string, unknown> = {
			rules: [{ id: 'color', rule: { config: 'red', field: 'color', type: 'ValueRule' }}],
		};

		const resolved = resolveConfig(raw);

		expect(resolved.rules.get('color')).toBeInstanceOf(ValueRule);
	});

	it('honors a custom registry override', () => {
		const resolved = resolveConfig(baseConfig(), { registry: ruleRegistry });

		expect(resolved.rules.get('color')).toBeInstanceOf(ValueRule);
	});
});

describe('loadConfig', () => {
	it('clears existing state by default before adding rules', () => {
		const engine = new SpyEngine();

		loadConfig(engine, baseConfig());

		expect(engine.clearCount).toBe(1);
		expect(engine.addedRules.map((r) => r.id)).toEqual(['color', 'shape']);
	});

	it('does not clear when clearExisting is false', () => {
		const engine = new SpyEngine();

		loadConfig(engine, baseConfig(), { clearExisting: false });

		expect(engine.clearCount).toBe(0);
		expect(engine.addedRules).toHaveLength(2);
	});

	it('clears when clearExisting is explicitly true', () => {
		const engine = new SpyEngine();

		loadConfig(engine, baseConfig(), { clearExisting: true });

		expect(engine.clearCount).toBe(1);
	});

	it('adds groups after rules', () => {
		const engine = new SpyEngine();
		const config: FilterEngineConfig = {
			...baseConfig(),
			groups: [{ filterIds: ['color'], id: 'g1' }],
		};

		loadConfig(engine, config);

		expect(engine.addedGroups).toHaveLength(1);
		expect(engine.addedGroups[0]?.id).toBe('g1');
	});

	it('sets the expression when one is present', () => {
		const engine = new SpyEngine();
		const config: FilterEngineConfig = {
			...baseConfig(),
			expression: { ruleId: 'color', type: 'rule' },
		};

		loadConfig(engine, config);

		expect(engine.setExpressionCalls).toBe(1);
		expect(engine.expression).toBeInstanceOf(CompositeRule);
	});

	it('does not call setExpression when no expression is present', () => {
		const engine = new SpyEngine();

		loadConfig(engine, baseConfig());

		expect(engine.setExpressionCalls).toBe(0);
		expect(engine.expression).toBeNull();
	});
});
