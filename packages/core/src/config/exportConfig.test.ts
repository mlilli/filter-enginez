/**
 * @remarks
 * Tests for `exportConfig` (and the internal `serializeGroup` + `serializeExpression` it drives).
 * Covers registered-rule serialization, composite-expression recursion, synthetic `__inline_N`
 * id minting for unregistered inline rules, conditional spreads (label / metadata / groups /
 * expression), and a full export -> load round-trip via `resolveConfig`.
 */

import { describe, expect, it } from 'vitest';

import type { FilterGroup } from '../composition/FilterGroup.js';
import type { FilterRule } from '../rules/FilterRule.js';
import type { RuleId } from '../types.js';

import { CompositeRule } from '../rules/CompositeRule.js';
import { ValueRule } from '../rules/ValueRule.js';
import { exportConfig, type ExportConfigEngineSource } from './exportConfig.js';
import { CURRENT_CONFIG_VERSION } from './FilterEngineConfig.js';
import { resolveConfig } from './loadConfig.js';

/**
 * A read-only spy engine source whose state is configured per-test.
 */
class SourceEngine implements ExportConfigEngineSource {
	expression: CompositeRule | null = null;
	readonly groups: FilterGroup[] = [];
	readonly rules = new Map<RuleId, FilterRule>();

	getExpression(): CompositeRule | null {
		return this.expression;
	}

	getGroups(): readonly FilterGroup[] {
		return this.groups;
	}

	getRules(): ReadonlyMap<RuleId, FilterRule> {
		return this.rules;
	}
}

describe('exportConfig', () => {
	it('stamps the current version and serializes registered rules', () => {
		const engine = new SourceEngine();

		engine.rules.set('color', new ValueRule('color', 'red'));

		const config = exportConfig(engine);

		expect(config.version).toBe(CURRENT_CONFIG_VERSION);
		expect(config.rules).toHaveLength(1);
		expect(config.rules[0]?.id).toBe('color');
		expect(config.rules[0]?.rule).toEqual({ config: 'red', field: 'color', type: 'ValueRule' });
	});

	it('omits label, metadata, groups, and expression when none are provided', () => {
		const engine = new SourceEngine();

		engine.rules.set('color', new ValueRule('color', 'red'));

		const config = exportConfig(engine);

		expect(config).not.toHaveProperty('label');
		expect(config).not.toHaveProperty('metadata');
		expect(config).not.toHaveProperty('groups');
		expect(config).not.toHaveProperty('expression');
	});

	it('includes label and metadata when supplied', () => {
		const engine = new SourceEngine();

		engine.rules.set('color', new ValueRule('color', 'red'));

		const config = exportConfig(engine, { label: 'My Filters', metadata: { theme: 'dark' }});

		expect(config.label).toBe('My Filters');
		expect(config.metadata).toEqual({ theme: 'dark' });
	});

	it('serializes groups with displayName present', () => {
		const engine = new SourceEngine();

		engine.rules.set('color', new ValueRule('color', 'red'));
		engine.groups.push({
			composition: 'and',
			displayName: 'Group One',
			filterIds: ['color'],
			id: 'g1',
		});

		const config = exportConfig(engine);

		expect(config.groups).toHaveLength(1);
		expect(config.groups?.[0]).toEqual({
			composition: 'and',
			displayName: 'Group One',
			filterIds: ['color'],
			id: 'g1',
		});
	});

	it('serializes groups omitting displayName when absent', () => {
		const engine = new SourceEngine();

		engine.rules.set('color', new ValueRule('color', 'red'));
		engine.groups.push({ composition: 'or', filterIds: ['color'], id: 'g2' });

		const config = exportConfig(engine);

		expect(config.groups?.[0]).not.toHaveProperty('displayName');
		expect(config.groups?.[0]?.composition).toBe('or');
	});

	it('serializes an expression of registered rules by their ids', () => {
		const engine = new SourceEngine();
		const color = new ValueRule('color', 'red');
		const shape = new ValueRule('shape', 'round');

		engine.rules.set('color', color);
		engine.rules.set('shape', shape);
		engine.expression = new CompositeRule('and', [color, shape]);

		const config = exportConfig(engine);

		expect(config.expression).toEqual({
			children: [
				{ ruleId: 'color', type: 'rule' },
				{ ruleId: 'shape', type: 'rule' },
			],
			op: 'and',
			type: 'composite',
		});
	});

	it('mints synthetic __inline_N ids for unregistered inline rules', () => {
		const engine = new SourceEngine();
		// No registered rules — the expression's leaves are all inline.
		const a = new ValueRule('a', 1);
		const b = new ValueRule('b', 2);

		engine.expression = new CompositeRule('or', [a, b]);

		const config = exportConfig(engine);

		expect(config.expression).toEqual({
			children: [
				{ ruleId: '__inline_0', type: 'rule' },
				{ ruleId: '__inline_1', type: 'rule' },
			],
			op: 'or',
			type: 'composite',
		});

		// Minted rules get appended to the rules array so the round-trip can resolve them.
		const ids = config.rules.map((r) => r.id);

		expect(ids).toContain('__inline_0');
		expect(ids).toContain('__inline_1');
	});

	it('mixes registered + inline leaves, minting only for the inline one', () => {
		const engine = new SourceEngine();
		const registered = new ValueRule('color', 'red');
		const inline = new ValueRule('shape', 'round');

		engine.rules.set('color', registered);
		engine.expression = new CompositeRule('and', [registered, inline]);

		const config = exportConfig(engine);

		expect(config.expression).toEqual({
			children: [
				{ ruleId: 'color', type: 'rule' },
				{ ruleId: '__inline_0', type: 'rule' },
			],
			op: 'and',
			type: 'composite',
		});
	});

	it('produces no groups key when the groups array is empty', () => {
		const engine = new SourceEngine();

		engine.rules.set('color', new ValueRule('color', 'red'));

		const config = exportConfig(engine);

		expect(config).not.toHaveProperty('groups');
	});

	it('round-trips through resolveConfig preserving rule identity by id', () => {
		const engine = new SourceEngine();

		engine.rules.set('color', new ValueRule('color', 'red'));
		engine.rules.set('price', new ValueRule('price', 42));
		engine.groups.push({ composition: 'or', filterIds: ['color', 'price'], id: 'g1' });

		const exported = exportConfig(engine, { label: 'rt' });
		const resolved = resolveConfig(exported);

		expect(resolved.rules.size).toBe(2);
		expect(resolved.rules.get('color')).toBeInstanceOf(ValueRule);
		expect(resolved.rules.get('price')).toBeInstanceOf(ValueRule);
		expect(resolved.groups[0]?.filterIds).toEqual(['color', 'price']);
	});

	it('round-trips an inline expression through resolveConfig', () => {
		const engine = new SourceEngine();
		const a = new ValueRule('a', 1);
		const b = new ValueRule('b', 2);

		engine.expression = new CompositeRule('and', [a, b]);

		const exported = exportConfig(engine);
		const resolved = resolveConfig(exported);

		expect(resolved.expression).toBeInstanceOf(CompositeRule);
		expect(resolved.expression?.config.op).toBe('and');
		expect(resolved.expression?.config.rules).toHaveLength(2);
	});
});
