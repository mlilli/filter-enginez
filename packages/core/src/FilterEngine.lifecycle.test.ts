/**
 * @remarks
 * Lifecycle + delegation tests for the `FilterEngine` facade, split out of `FilterEngine.test.ts`
 * to keep both under the 500-line cap. Covers: `subscribe` (returns a working unsubscribe; a
 * throwing subscriber is swallowed without stopping the others), `destroy` (idempotent — the
 * second call is a no-op; awaits devtools teardown; clears subscribers), `reset`, JSON-config
 * `loadConfig` / `exportConfig` round-trip + the construction-time `config` option, `simulate`
 * delegation, and `snapshot()`.
 *
 * It also drives EVERY action type through the public surface so the private
 * `_invalidateBitmapForAction` switch runs each `case`: EXPRESSION_SET, GROUP_ADDED/REMOVED,
 * WORKING_SET_SET/RESET, RESET, RULES_CLEARED, SOURCE_DATA_SET, RULE_ADDED/CHANGED/REMOVED.
 */

import { describe, expect, it, vi } from 'vitest';

import { CURRENT_CONFIG_VERSION, type FilterEngineConfig } from './config/FilterEngineConfig.js';
import { FilterEngineDestroyedError } from './errors/index.js';
import { FilterEngine } from './FilterEngine.js';
import { value } from './rules/factories.js';

interface Item {
	readonly color: string;
	readonly price: number;
}

const SAMPLE: readonly Item[] = [
	{ color: 'red', price: 10 },
	{ color: 'blue', price: 30 },
];

describe('FilterEngine — subscribe', () => {
	it('returns an unsubscribe that stops further notifications', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });
		const seen: string[] = [];
		const unsubscribe = engine.subscribe((e) => seen.push(e.type));

		engine.addRule('color', value('color', 'red'));
		expect(seen).toContain('rule:added');

		unsubscribe();
		seen.length = 0;
		engine.removeRule('color');
		expect(seen).toHaveLength(0);
	});

	it('swallows a throwing subscriber so the others still fire', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const goodSeen: string[] = [];

		engine.subscribe(() => {
			throw new Error('boom');
		});
		engine.subscribe((e) => goodSeen.push(e.type));

		engine.addRule('color', value('color', 'red'));

		expect(goodSeen).toContain('rule:added');
		expect(errorSpy).toHaveBeenCalled();
		errorSpy.mockRestore();
	});
});

describe('FilterEngine — destroy', () => {
	it('clears subscribers and is idempotent across repeated calls', async () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });
		const destroySpy = vi.spyOn(engine.devtools, 'destroy');
		const seen: string[] = [];

		engine.subscribe((e) => seen.push(e.type));
		await engine.destroy();

		// First call tore down devtools once.
		expect(destroySpy).toHaveBeenCalledTimes(1);

		// Second call is a no-op — devtools.destroy is not invoked again.
		await engine.destroy();
		expect(destroySpy).toHaveBeenCalledTimes(1);

		// A post-destroy mutation is refused outright, and notified no one on the way out.
		expect(() => engine.addRule('color', value('color', 'red'))).toThrow(FilterEngineDestroyedError);
		expect(seen).toHaveLength(0);
	});
});

describe('FilterEngine — reset', () => {
	it('drops rules, groups, expression, and resets the working set', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });

		engine.addRule('color', value('color', 'red'));
		engine.addGroup({ composition: 'or', filterIds: ['color'], id: 'g1' });
		engine.setWorkingSet(SAMPLE.slice(0, 1));

		const seen: string[] = [];

		engine.subscribe((e) => seen.push(e.type));
		engine.reset();

		expect(engine.getRules().size).toBe(0);
		expect(engine.getGroups()).toHaveLength(0);
		expect(engine.getExpression()).toBeNull();
		expect(seen).toContain('reset');
	});
});

describe('FilterEngine — time-travel emits through the engine', () => {
	it('undo restores state AND emits a reset event to subscribers', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });

		engine.addRule('color', value('color', 'red'));
		expect(engine.getRules().size).toBe(1);

		const seen: string[] = [];
		const unsubscribe = engine.subscribe((e) => seen.push(e.type));

		// The keyboard hook / devtools panel drive undo via `engine.devtools.undo()` — a direct
		// store restore that bypasses the dispatcher. It must still notify subscribers so every
		// reactive surface (signals fan-out, URL sync, Redux mirror) re-reads the reverted state.
		engine.devtools.undo();

		expect(seen).toEqual(['reset']);
		expect(engine.getRules().size).toBe(0);
		expect(engine.exportConfig().rules).toHaveLength(0);

		unsubscribe();
	});

	it('redo re-applies state AND emits a reset event', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });

		engine.addRule('color', value('color', 'red'));
		engine.devtools.undo();

		const seen: string[] = [];

		engine.subscribe((e) => seen.push(e.type));
		engine.devtools.redo();

		expect(seen).toEqual(['reset']);
		expect(engine.getRules().size).toBe(1);
	});

	it('a no-op undo (nothing to undo) emits nothing', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });
		const seen: string[] = [];

		engine.subscribe((e) => seen.push(e.type));
		engine.devtools.undo(); // action log empty → canUndo false → no restore, no emit.

		expect(seen).toHaveLength(0);
	});
});

describe('FilterEngine — JSON config', () => {
	function configWithColor(): FilterEngineConfig {
		return {
			rules: [{ id: 'color', rule: { config: 'red', field: 'color', type: 'ValueRule' }}],
			version: CURRENT_CONFIG_VERSION,
		};
	}

	it('loadConfig applies a config document', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });

		engine.loadConfig(configWithColor());
		expect(engine.getRule('color')).toBeDefined();
		expect(engine.getResultCount()).toBe(1);
	});

	it('exportConfig round-trips a loaded config', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });

		engine.loadConfig(configWithColor());

		const exported = engine.exportConfig();

		expect(exported.version).toBe(CURRENT_CONFIG_VERSION);
		expect(exported.rules).toHaveLength(1);
		expect(exported.rules[0]?.id).toBe('color');

		const rebuilt = new FilterEngine<Item>({ config: exported, sourceData: SAMPLE });

		expect(rebuilt.getResultCount()).toBe(1);
	});
});

describe('FilterEngine — simulate', () => {
	it('delegates to the simulation cache and returns a projected result', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });
		const result = engine.simulate({ withRule: ['color', value('color', 'red')]});

		expect(result.resultCount).toBe(1);
		expect(result.wouldBeEmpty).toBe(false);
		expect(typeof result.cacheKey).toBe('string');
	});
});

describe('FilterEngine — snapshot', () => {
	it('captures the current engine snapshot', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });

		engine.addRule('color', value('color', 'red'));

		const snapshot = engine.snapshot();

		expect(snapshot.rules.size).toBe(1);
		expect(snapshot.expression).toBeNull();
		expect(typeof snapshot.capturedAt).toBe('number');
	});
});

describe('FilterEngine — _invalidateBitmapForAction action sweep', () => {
	it('runs every action-type branch through the public mutators', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });
		const clearSpy = vi.spyOn(engine.bitmapIndex, 'clear');
		const invalidateRuleSpy = vi.spyOn(engine.bitmapIndex, 'invalidateRule');
		const exclusionInvalidateSpy = vi.spyOn(engine.exclusionGraph, 'invalidate');

		// RULE_ADDED / RULE_CHANGED / RULE_REMOVED → invalidateRule + exclusion invalidate.
		engine.addRule('color', value('color', 'red'));
		engine.addRule('color', value('color', 'blue'));
		engine.removeRule('color');
		expect(invalidateRuleSpy).toHaveBeenCalledTimes(3);

		// EXPRESSION_SET / GROUP_ADDED / GROUP_REMOVED / WORKING_SET_SET / WORKING_SET_RESET
		// → early return (no bitmap clear, no invalidateRule).
		const clearBefore = clearSpy.mock.calls.length;
		const invalidateRuleBefore = invalidateRuleSpy.mock.calls.length;

		engine.setExpression(null);
		engine.addGroup({ composition: 'or', filterIds: [], id: 'g1' });
		engine.removeGroup('g1');
		engine.setWorkingSet(SAMPLE.slice(0, 1));
		engine.resetWorkingSet();

		expect(clearSpy.mock.calls.length).toBe(clearBefore);
		expect(invalidateRuleSpy.mock.calls.length).toBe(invalidateRuleBefore);

		// SOURCE_DATA_SET / RULES_CLEARED / RESET → bitmap clear + exclusion invalidate.
		const clearAfterEarly = clearSpy.mock.calls.length;

		engine.setSourceData(SAMPLE);
		engine.clearRules();
		engine.reset();
		expect(clearSpy.mock.calls.length).toBe(clearAfterEarly + 3);
		expect(exclusionInvalidateSpy).toHaveBeenCalled();

		clearSpy.mockRestore();
		invalidateRuleSpy.mockRestore();
		exclusionInvalidateSpy.mockRestore();
	});
});
