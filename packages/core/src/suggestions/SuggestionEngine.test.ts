/**
 * Tests for `SuggestionEngine` — the consumer-facing top-k filter-suggestion API.
 *
 * @remarks
 * Covers all four ranking paths: the empty-model short-circuit, the cold-start marginal
 * ranking (empty selection), the noisy-OR co-occurrence combination over a non-empty
 * selection, and the discounted marginal tie-breaker that backfills when fewer than `k`
 * co-occurrence candidates exist. Also covers selection exclusion, the default `k`, the
 * descending sort + slice, and lazy training being driven from the query path.
 */

import { describe, expect, it } from 'vitest';

import type { RuleId } from '../types.js';

import { BayesianModel } from './BayesianModel.js';
import { SessionTracker } from './SessionTracker.js';
import { SuggestionEngine } from './SuggestionEngine.js';

/** Wire a tracker + model + engine, pre-loading the tracker with the given sessions. */
function engineWith(sessions: readonly RuleId[][]): {
	engine: SuggestionEngine;
	model: BayesianModel;
	tracker: SessionTracker;
} {
	const tracker = new SessionTracker();

	for (const session of sessions) {
		tracker.recordSession(session);
	}
	const model = new BayesianModel();
	const engine = new SuggestionEngine(tracker, model);

	return { engine, model, tracker };
}

/** Just the ranked rule ids, in order. */
function suggestedIds(engine: SuggestionEngine, selection: readonly RuleId[], k?: number): RuleId[] {
	return engine.getSuggestions(selection, k).map((result) => result.ruleId);
}

describe('SuggestionEngine', () => {
	describe('empty model', () => {
		it('returns [] when no sessions have been recorded', () => {
			const { engine } = engineWith([]);

			expect(engine.getSuggestions([])).toEqual([]);
			expect(engine.getSuggestions(['anything'])).toEqual([]);
		});

		it('trains lazily from the query path (no explicit train call needed)', () => {
			const { engine, model } = engineWith([['red', 'white']]);

			expect(model.trainedSessionCount).toBe(0); // not yet trained

			engine.getSuggestions([]);

			expect(model.trainedSessionCount).toBe(1); // query path trained it
		});
	});

	describe('cold start (empty selection)', () => {
		it('ranks by marginal popularity descending', () => {
			// 'red' in 3 sessions, 'white' in 2, 'rose' in 1.
			const { engine } = engineWith([
				['red'],
				['red'],
				['red', 'white'],
				['white', 'rose'],
			]);

			expect(suggestedIds(engine, [])).toEqual(['red', 'white', 'rose']);
		});

		it('honors k (default 3)', () => {
			const { engine } = engineWith([['a'], ['b'], ['c'], ['d'], ['e']]);

			expect(suggestedIds(engine, [])).toHaveLength(3); // default k
			expect(suggestedIds(engine, [], 2)).toHaveLength(2);
			expect(suggestedIds(engine, [], 10)).toHaveLength(5); // capped at vocabulary
		});

		it('attaches the marginal probability to each result', () => {
			const { engine } = engineWith([['red'], ['red'], ['white']]);

			const [top] = engine.getSuggestions([], 1);

			expect(top?.ruleId).toBe('red');
			expect(top?.probability).toBeCloseTo(2 / 3);
		});

		it('returns every candidate when the selection is empty', () => {
			const { engine } = engineWith([['red'], ['white']]);

			expect(suggestedIds(engine, []).sort()).toEqual(['red', 'white']);
		});
	});

	describe('co-occurrence (non-empty selection)', () => {
		it('suggests rules that co-occur with the current selection, excluding the selection', () => {
			// 'red' co-occurs strongly with 'cabernet' and 'syrah'.
			const { engine } = engineWith([
				['red', 'cabernet', 'syrah'],
				['red', 'cabernet'],
				['red', 'syrah'],
			]);

			const ids = suggestedIds(engine, ['red']);

			expect(ids).not.toContain('red'); // selection excluded
			expect(ids).toContain('cabernet');
			expect(ids).toContain('syrah');
		});

		it('ranks the stronger co-occurrence higher', () => {
			// Given 'red': cabernet co-occurs 3/3, syrah 1/3.
			const { engine } = engineWith([
				['red', 'cabernet', 'syrah'],
				['red', 'cabernet'],
				['red', 'cabernet'],
			]);

			expect(suggestedIds(engine, ['red'])).toEqual(['cabernet', 'syrah']);
		});

		it('combines evidence across a multi-rule selection via noisy-OR', () => {
			// 'target' co-occurs with both 'a' (1/2) and 'b' (1/2). Noisy-OR:
			// 1 - (1 - 0.5)(1 - 0.5) = 0.75 — higher than either single conditional.
			const { engine } = engineWith([
				['a', 'b', 'target'],
				['a', 'c'],
				['b', 'd'],
			]);

			const target = engine.getSuggestions(['a', 'b'], 10).find((r) => r.ruleId === 'target');

			expect(target).toBeDefined();
			expect(target?.probability).toBeCloseTo(0.75);
		});

		it('excludes every rule in a multi-rule selection from the results', () => {
			const { engine } = engineWith([
				['a', 'b', 'c'],
				['a', 'b', 'd'],
			]);

			const ids = suggestedIds(engine, ['a', 'b']);

			expect(ids).not.toContain('a');
			expect(ids).not.toContain('b');
		});
	});

	describe('discounted-marginal tie-breaker', () => {
		it('backfills with discounted marginals when fewer than k co-occurrence candidates exist', () => {
			// Given 'red': only 'cabernet' co-occurs. But 'orphan' is popular elsewhere.
			// k=3 forces the backfill path to pull in 'orphan' at a heavy discount.
			const { engine } = engineWith([
				['red', 'cabernet'],
				['orphan'],
				['orphan'],
			]);

			const results = engine.getSuggestions(['red'], 3);
			const ids = results.map((r) => r.ruleId);

			expect(ids).toContain('cabernet');
			expect(ids).toContain('orphan');

			const cab = results.find((r) => r.ruleId === 'cabernet');
			const orphan = results.find((r) => r.ruleId === 'orphan');

			// Co-occurrence candidate ranks strictly above the discounted backfill.
			expect(cab?.probability ?? 0).toBeGreaterThan(orphan?.probability ?? 0);
			// Backfill is the marginal (2/3) times the 0.01 discount.
			expect(orphan?.probability).toBeCloseTo((2 / 3) * 0.01);
		});

		it('ranks the backfill below even a weak co-occurrence score', () => {
			// P(cabernet | red) = 1/200; 'orphan' is far more popular overall.
			const sessions: string[][] = [['red', 'cabernet']];

			for (let i = 0; i < 199; i++) {
				sessions.push(['red']);
			}
			for (let i = 0; i < 300; i++) {
				sessions.push(['orphan']);
			}
			const results = engineWith(sessions).engine.getSuggestions(['red'], 2);

			expect(results.map((r) => r.ruleId)).toEqual(['cabernet', 'orphan']);
			expect(results[0]?.probability).toBeCloseTo(1 / 200);
			expect(results[1]?.probability).toBeCloseTo((300 / 500) * 0.01 * (1 / 200));
		});

		it('does NOT backfill when k co-occurrence candidates already exist', () => {
			// Given 'red': both 'cabernet' and 'syrah' co-occur, satisfying k=2 with no backfill.
			const { engine } = engineWith([
				['red', 'cabernet', 'syrah'],
				['orphan'],
			]);

			const ids = suggestedIds(engine, ['red'], 2);

			expect(ids.sort()).toEqual(['cabernet', 'syrah']);
			expect(ids).not.toContain('orphan');
		});

		it('skips backfill candidates already scored or already in the selection', () => {
			// 'red' co-occurs with 'cabernet'; backfill should skip 'red' (selected) and
			// 'cabernet' (already scored), leaving only genuinely-new candidates.
			const { engine } = engineWith([
				['red', 'cabernet'],
				['red', 'cabernet'],
				['extra'],
			]);

			const ids = suggestedIds(engine, ['red'], 3);

			expect(ids).not.toContain('red');
			// 'cabernet' appears exactly once (from co-occurrence, not duplicated by backfill).
			expect(ids.filter((id) => id === 'cabernet')).toHaveLength(1);
			expect(ids).toContain('extra');
		});
	});

	describe('sorting and slicing', () => {
		it('returns results sorted by probability descending', () => {
			const { engine } = engineWith([
				['red'],
				['red'],
				['red'],
				['white'],
				['white'],
				['rose'],
			]);

			const probabilities = engine.getSuggestions([], 3).map((r) => r.probability);

			expect(probabilities).toEqual([...probabilities].sort((a, b) => b - a));
		});

		it('slices to exactly k results when more candidates are available', () => {
			const { engine } = engineWith([['a'], ['b'], ['c'], ['d']]);

			expect(engine.getSuggestions([], 2)).toHaveLength(2);
		});
	});
});
