/**
 * @remarks
 * Tests for `diff()` — the `microdiff`-backed snapshot differ. Covers CHANGE (a scalar field
 * differs), CREATE (a field gains an entry), and REMOVE (a field loses an entry) edits between
 * two `EngineSnapshot`s, plus the empty-diff case for identical snapshots, rule edits keyed by
 * rule id (the `Map` is compared through each rule's serialized form), expression edits,
 * `capturedAt` ignored, and non-serializable rules compared by instance.
 */

import { describe, expect, it } from 'vitest';

import type { EngineSnapshot } from '../store/snapshots.js';

import { and } from '../composition/factories.js';
import { PredicateRule } from '../rules/PredicateRule.js';
import { RangeRule } from '../rules/RangeRule.js';
import { ValueRule } from '../rules/ValueRule.js';
import { diff } from './Diff.js';

function snapshot(overrides: Partial<EngineSnapshot> = {}): EngineSnapshot {
	return {
		capturedAt: 0,
		expression: null,
		groups: [],
		lastChangeRuleId: null,
		rules: new Map(),
		sourceDataVersion: 0,
		workingSetVersion: 0,
		...overrides,
	};
}

describe('diff', () => {
	it('returns an empty edit list for identical snapshots', () => {
		const a = snapshot();

		expect(diff(a, snapshot())).toEqual([]);
	});

	it('reports a CHANGE edit when a scalar field differs', () => {
		const edits = diff(snapshot({ sourceDataVersion: 1 }), snapshot({ sourceDataVersion: 2 }));

		const change = edits.find((e) => e.type === 'CHANGE');

		expect(change).toBeDefined();
		expect(change?.path).toContain('sourceDataVersion');
	});

	it('reports a CREATE edit when a collection gains an entry', () => {
		const from = snapshot({ groups: []});
		const to = snapshot({ groups: [{ composition: 'or', filterIds: [], id: 'g1' }]});

		const created = diff(from, to).filter((e) => e.type === 'CREATE');

		expect(created.length).toBeGreaterThan(0);
	});

	it('reports a REMOVE edit when a collection loses an entry', () => {
		const from = snapshot({ groups: [{ composition: 'or', filterIds: [], id: 'g1' }]});
		const to = snapshot({ groups: []});

		const removed = diff(from, to).filter((e) => e.type === 'REMOVE');

		expect(removed.length).toBeGreaterThan(0);
	});

	it('ignores capturedAt, which differs between any two snapshots', () => {
		expect(diff(snapshot({ capturedAt: 1 }), snapshot({ capturedAt: 2 }))).toEqual([]);
	});

	it('reports rule config changes under the rule id', () => {
		const from = snapshot({ rules: new Map([['price', new RangeRule('price', { max: 50, min: 0 })]]) });
		const to = snapshot({ rules: new Map([['price', new RangeRule('price', { max: 80, min: 0 })]]) });

		expect(diff(from, to)).toEqual([
			{ oldValue: 50, path: ['rules', 'price', 'config', 'max'], type: 'CHANGE', value: 80 },
		]);
	});

	it('reports added and removed rules', () => {
		const from = snapshot({ rules: new Map([['a', new ValueRule('a', 1)]]) });
		const to = snapshot({ rules: new Map([['b', new ValueRule('b', 2)]]) });
		const types = diff(from, to).map((edit) => `${edit.type}:${edit.path.join('.')}`);

		expect(types).toEqual(expect.arrayContaining(['REMOVE:rules.a', 'CREATE:rules.b']));
	});

	it('reports expression changes through the serialized tree', () => {
		const from = snapshot({ expression: and(new ValueRule('a', 1)) });
		const to = snapshot({ expression: and(new ValueRule('a', 2)) });

		expect(diff(from, to)).toEqual([
			expect.objectContaining({ path: ['expression', 'config', 'rules', 0, 'config'], type: 'CHANGE' }),
		]);
		expect(diff(from, snapshot()).map((edit) => edit.path[0])).toContain('expression');
	});

	it('compares a non-serializable rule by instance', () => {
		const p1 = new PredicateRule<unknown>(undefined, () => true);
		const p2 = new PredicateRule<unknown>(undefined, () => true);

		expect(diff(snapshot({ rules: new Map([['p', p1]]) }), snapshot({ rules: new Map([['p', p1]]) }))).toEqual([]);
		expect(diff(snapshot({ rules: new Map([['p', p1]]) }), snapshot({ rules: new Map([['p', p2]]) }))).not.toEqual([]);
	});
});
