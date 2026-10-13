/**
 * Tests for `SessionTracker` — the bounded ring buffer of active-rule-set snapshots that
 * feeds the Bayesian co-occurrence model.
 *
 * @remarks
 * Covers the full surface: recording sessions (snapshot isolation from the caller's array),
 * the `maxSessions` eviction bound (oldest-first), the oldest-to-newest `sessions()`
 * generator, the `size` getter, `clear`, the `version` change counter, and the timestamp
 * stamping (asserted via fake timers so the test is deterministic).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RuleId } from '../types.js';

import { SessionTracker } from './SessionTracker.js';

/** Collect the recorded sessions' rule-id sets as plain arrays, oldest → newest. */
function sessionRuleIds(tracker: SessionTracker): RuleId[][] {
	return [...tracker.sessions()].map((session) => [...session.ruleIds]);
}

describe('SessionTracker', () => {
	it('defaults to a maxSessions bound of 500', () => {
		expect(new SessionTracker().maxSessions).toBe(500);
	});

	it('honors an explicit maxSessions bound', () => {
		expect(new SessionTracker(7).maxSessions).toBe(7);
	});

	it('starts empty', () => {
		const tracker = new SessionTracker();

		expect(tracker.size).toBe(0);
		expect([...tracker.sessions()]).toEqual([]);
	});

	it('records a session as a set of the given rule ids', () => {
		const tracker = new SessionTracker();

		tracker.recordSession(['red', 'cabernet']);

		expect(tracker.size).toBe(1);
		expect(sessionRuleIds(tracker)).toEqual([['red', 'cabernet']]);
	});

	it('de-duplicates rule ids within a single session (stored as a Set)', () => {
		const tracker = new SessionTracker();

		tracker.recordSession(['red', 'red', 'cabernet']);

		const [first] = [...tracker.sessions()];

		expect(first?.ruleIds.size).toBe(2);
		expect([...(first?.ruleIds ?? [])]).toEqual(['red', 'cabernet']);
	});

	it('snapshots the rule ids — later mutation of the caller array does not leak in', () => {
		const tracker = new SessionTracker();
		const active: RuleId[] = ['red'];

		tracker.recordSession(active);
		active.push('white'); // mutate the source array after recording

		expect(sessionRuleIds(tracker)).toEqual([['red']]);
	});

	it('iterates sessions oldest to newest', () => {
		const tracker = new SessionTracker();

		tracker.recordSession(['a']);
		tracker.recordSession(['b']);
		tracker.recordSession(['c']);

		expect(sessionRuleIds(tracker)).toEqual([['a'], ['b'], ['c']]);
	});

	it('evicts the oldest session when over the maxSessions bound', () => {
		const tracker = new SessionTracker(2);

		tracker.recordSession(['a']);
		tracker.recordSession(['b']);
		tracker.recordSession(['c']); // exceeds bound → evicts 'a'

		expect(tracker.size).toBe(2);
		expect(sessionRuleIds(tracker)).toEqual([['b'], ['c']]);
	});

	it('evicts repeatedly to stay at or below the bound across many records', () => {
		const tracker = new SessionTracker(3);

		for (const id of ['a', 'b', 'c', 'd', 'e']) {
			tracker.recordSession([id]);
		}

		expect(tracker.size).toBe(3);
		expect(sessionRuleIds(tracker)).toEqual([['c'], ['d'], ['e']]);
	});

	it('clear() drops all recorded sessions', () => {
		const tracker = new SessionTracker();

		tracker.recordSession(['a']);
		tracker.recordSession(['b']);
		tracker.clear();

		expect(tracker.size).toBe(0);
		expect([...tracker.sessions()]).toEqual([]);
	});

	describe('timestamps', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it('stamps each session with the current wall-clock time', () => {
			vi.setSystemTime(new Date('2026-05-31T12:00:00.000Z'));
			const tracker = new SessionTracker();

			tracker.recordSession(['a']);

			const [first] = [...tracker.sessions()];

			expect(first?.timestamp).toBe(Date.parse('2026-05-31T12:00:00.000Z'));
		});

		it('reflects time advancing between two recorded sessions', () => {
			vi.setSystemTime(new Date('2026-05-31T12:00:00.000Z'));
			const tracker = new SessionTracker();

			tracker.recordSession(['a']);
			vi.advanceTimersByTime(5_000);
			tracker.recordSession(['b']);

			const [first, second] = [...tracker.sessions()];

			expect((second?.timestamp ?? 0) - (first?.timestamp ?? 0)).toBe(5_000);
		});
	});

	describe('version', () => {
		it('moves on every record (including at a full buffer) and on clear', () => {
			const tracker = new SessionTracker(1);

			expect(tracker.version).toBe(0);
			tracker.recordSession(['a']);
			tracker.recordSession(['b']);
			expect(tracker.size).toBe(1);
			expect(tracker.version).toBe(2);
			tracker.clear();
			expect(tracker.version).toBe(3);
		});
	});
});
