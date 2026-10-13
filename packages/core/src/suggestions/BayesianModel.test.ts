/**
 * Tests for `BayesianModel` — the empirical co-occurrence model over session records.
 *
 * @remarks
 * Covers training (full rebuild on first call, the lazy short-circuit when the tracker has
 * recorded nothing new, and re-training whenever its version moves — growth, eviction at a full
 * buffer, clear-and-refill, or a different tracker), the symmetric pair-count population, the
 * `conditionalsFor` generator (both empty-iterable early-exits and the yield path), the
 * `marginal` ratio (including the zero-sessions guard), `allKnownRules`, the `vocabularySize`
 * and `trainedSessionCount` getters, and `clear`.
 */

import { describe, expect, it } from 'vitest';

import type { RuleId } from '../types.js';

import { BayesianModel } from './BayesianModel.js';
import { SessionTracker } from './SessionTracker.js';

/** Build a tracker pre-loaded with the given sessions (each an array of rule ids). */
function trackerWith(sessions: readonly RuleId[][]): SessionTracker {
	const tracker = new SessionTracker();

	for (const session of sessions) {
		tracker.recordSession(session);
	}

	return tracker;
}

/** Collect a model's conditionals for a rule into a plain `Record` for easy assertion. */
function conditionals(model: BayesianModel, ruleId: RuleId): Record<string, number> {
	return Object.fromEntries(model.conditionalsFor(ruleId));
}

describe('BayesianModel', () => {
	describe('initial state', () => {
		it('is empty before any training', () => {
			const model = new BayesianModel();

			expect(model.trainedSessionCount).toBe(0);
			expect(model.vocabularySize).toBe(0);
			expect([...model.allKnownRules()]).toEqual([]);
		});

		it('marginal is 0 for any rule when no sessions have been seen', () => {
			const model = new BayesianModel();

			expect(model.marginal('anything')).toBe(0);
		});

		it('conditionalsFor yields nothing before training', () => {
			const model = new BayesianModel();

			expect([...model.conditionalsFor('x')]).toEqual([]);
		});
	});

	describe('trainIfStale — counting', () => {
		it('counts single occurrences across sessions', () => {
			const model = new BayesianModel();
			const tracker = trackerWith([['red'], ['red', 'white'], ['white']]);

			model.trainIfStale(tracker);

			expect(model.trainedSessionCount).toBe(3);
			expect(model.vocabularySize).toBe(2);
			// 'red' in 2 of 3 sessions, 'white' in 2 of 3.
			expect(model.marginal('red')).toBeCloseTo(2 / 3);
			expect(model.marginal('white')).toBeCloseTo(2 / 3);
		});

		it('marginal is 0 for a rule never seen even after training', () => {
			const model = new BayesianModel();

			model.trainIfStale(trackerWith([['red']]));

			expect(model.marginal('unseen')).toBe(0);
		});

		it('populates pair counts symmetrically — P(Y|X) and P(X|Y) both available', () => {
			const model = new BayesianModel();
			// 'red' and 'cabernet' co-occur in both sessions; both appear alone nowhere else.
			const tracker = trackerWith([
				['red', 'cabernet'],
				['red', 'cabernet'],
			]);

			model.trainIfStale(tracker);

			// P(cabernet | red) = sessions(red ∧ cabernet) / sessions(red) = 2/2 = 1.
			expect(conditionals(model, 'red')).toEqual({ cabernet: 1 });
			// Symmetric: P(red | cabernet) = 2/2 = 1.
			expect(conditionals(model, 'cabernet')).toEqual({ red: 1 });
		});

		it('computes partial conditionals when co-occurrence is incomplete', () => {
			const model = new BayesianModel();
			// 'red' appears in 3 sessions; co-occurs with 'syrah' in 1 of them.
			const tracker = trackerWith([['red', 'syrah'], ['red'], ['red']]);

			model.trainIfStale(tracker);

			// P(syrah | red) = 1/3.
			expect(model.conditionalsFor('red')).toBeDefined();
			expect(conditionals(model, 'red')).toEqual({ syrah: 1 / 3 });
			// P(red | syrah) = 1/1 = 1 (syrah only ever appeared with red).
			expect(conditionals(model, 'syrah')).toEqual({ red: 1 });
		});

		it('does not create a self-conditional (i === j is skipped)', () => {
			const model = new BayesianModel();

			model.trainIfStale(trackerWith([['red', 'white']]));

			expect(Object.keys(conditionals(model, 'red'))).not.toContain('red');
			expect(conditionals(model, 'red')).toEqual({ white: 1 });
		});

		it('handles a single-rule session (no pairs to count)', () => {
			const model = new BayesianModel();

			model.trainIfStale(trackerWith([['solo']]));

			expect(model.marginal('solo')).toBe(1);
			expect([...model.conditionalsFor('solo')]).toEqual([]);
		});

		it('tracks every distinct rule in the vocabulary', () => {
			const model = new BayesianModel();

			model.trainIfStale(trackerWith([['a', 'b'], ['b', 'c']]));

			expect(model.vocabularySize).toBe(3);
			expect([...model.allKnownRules()].sort()).toEqual(['a', 'b', 'c']);
		});
	});

	describe('trainIfStale — laziness', () => {
		it('is a no-op when the session count is unchanged since the last training', () => {
			const model = new BayesianModel();
			const tracker = trackerWith([['red']]);

			model.trainIfStale(tracker);
			expect(model.trainedSessionCount).toBe(1);

			// Reach past the tracker's API to mutate counts without changing size — a real
			// no-op would leave the model untouched. We assert via observable state instead:
			// training again with the same size must not double-count.
			model.trainIfStale(tracker);

			expect(model.trainedSessionCount).toBe(1);
			expect(model.marginal('red')).toBe(1);
		});

		it('re-trains when the session count grows', () => {
			const model = new BayesianModel();
			const tracker = trackerWith([['red']]);

			model.trainIfStale(tracker);
			tracker.recordSession(['white']);
			model.trainIfStale(tracker);

			expect(model.trainedSessionCount).toBe(2);
			expect(model.marginal('red')).toBeCloseTo(1 / 2);
			expect(model.marginal('white')).toBeCloseTo(1 / 2);
		});

		it('re-trains when a full buffer evicts, even though the size stays the same', () => {
			const model = new BayesianModel();
			const tracker = new SessionTracker(1); // bound forces eviction

			tracker.recordSession(['red']);
			model.trainIfStale(tracker);
			expect(model.marginal('red')).toBe(1);

			tracker.recordSession(['white']); // evicts 'red'; size stays 1
			model.trainIfStale(tracker);

			expect(model.trainedSessionCount).toBe(1);
			expect(model.marginal('red')).toBe(0);
			expect(model.marginal('white')).toBe(1);
		});

		it('re-trains after clear-and-refill to the same size, and for a different tracker', () => {
			const model = new BayesianModel();
			const tracker = trackerWith([['red']]);

			model.trainIfStale(tracker);
			tracker.clear();
			tracker.recordSession(['white']);
			model.trainIfStale(tracker);
			expect(model.marginal('white')).toBe(1);

			model.trainIfStale(trackerWith([['rose']]));
			expect(model.marginal('rose')).toBe(1);
			expect(model.marginal('white')).toBe(0);
		});
	});

	describe('conditionalsFor — early exits', () => {
		it('yields nothing for a rule never seen in training (no condition count)', () => {
			const model = new BayesianModel();

			model.trainIfStale(trackerWith([['red']]));

			expect([...model.conditionalsFor('never-seen')]).toEqual([]);
		});

		it('yields nothing for a rule that was seen but never co-occurred (no inner table)', () => {
			const model = new BayesianModel();

			// 'lonely' is seen but always alone, so it gets a single-count but no pair table.
			model.trainIfStale(trackerWith([['lonely'], ['red', 'white']]));

			// 'lonely' appears in 1 of the 2 training sessions.
			expect(model.marginal('lonely')).toBeCloseTo(1 / 2);
			expect([...model.conditionalsFor('lonely')]).toEqual([]);
		});
	});

	describe('clear', () => {
		it('drops all learned counts and resets training state', () => {
			const model = new BayesianModel();

			model.trainIfStale(trackerWith([['red', 'white']]));
			model.clear();

			expect(model.trainedSessionCount).toBe(0);
			expect(model.vocabularySize).toBe(0);
			expect([...model.allKnownRules()]).toEqual([]);
			expect(model.marginal('red')).toBe(0);
			expect([...model.conditionalsFor('red')]).toEqual([]);
		});

		it('forces a full rebuild on the next trainIfStale after clear', () => {
			const model = new BayesianModel();
			const tracker = trackerWith([['red']]);

			model.trainIfStale(tracker);
			model.clear();
			// Same tracker (size 1) — after clear, the version counter is -1 so this rebuilds
			// rather than short-circuiting on the unchanged size.
			model.trainIfStale(tracker);

			expect(model.trainedSessionCount).toBe(1);
			expect(model.marginal('red')).toBe(1);
		});
	});
});
