/**
 * Tests for `shouldEngageWorker` — the `'auto'` worker-engagement policy: never/always/boolean
 * shorthands, the `Worker`-availability fallback, and the auto + numeric thresholds.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_AUTO_THRESHOLD, shouldEngageWorker } from './autoEngagement.js';

// jsdom has no `Worker` global; drive the availability branches explicitly and restore after.
const globalWithWorker = globalThis as { Worker?: unknown };
const originalWorker = globalWithWorker.Worker;

afterEach(() => {
	globalWithWorker.Worker = originalWorker;
});

/** Set (or clear) the `Worker` global so the availability branch is deterministic. */
function setWorkerAvailable(available: boolean): void {
	// `shouldEngageWorker` only checks `typeof Worker !== 'undefined'`, so any non-undefined
	// value stands in for a real Worker constructor.
	globalWithWorker.Worker = available ? {} : undefined;
}

describe('shouldEngageWorker', () => {
	it('never engages for the "never" / false policies, regardless of size', () => {
		setWorkerAvailable(true);

		expect(shouldEngageWorker(1_000_000, 'never')).toBe(false);
		expect(shouldEngageWorker(1_000_000, false)).toBe(false);
	});

	it('always engages for the "always" / true policies, even without a Worker', () => {
		setWorkerAvailable(false);

		expect(shouldEngageWorker(0, 'always')).toBe(true);
		expect(shouldEngageWorker(0, true)).toBe(true);
	});

	it('does not engage "auto" / numeric policies when Worker is unavailable', () => {
		setWorkerAvailable(false);

		expect(shouldEngageWorker(1_000_000, 'auto')).toBe(false);
		expect(shouldEngageWorker(1_000_000, 100)).toBe(false);
	});

	it('engages "auto" at or above the default threshold when Worker is present', () => {
		setWorkerAvailable(true);

		expect(shouldEngageWorker(DEFAULT_AUTO_THRESHOLD, 'auto')).toBe(true);
		expect(shouldEngageWorker(DEFAULT_AUTO_THRESHOLD - 1, 'auto')).toBe(false);
	});

	it('engages a numeric policy at or above its threshold when Worker is present', () => {
		setWorkerAvailable(true);

		expect(shouldEngageWorker(100, 100)).toBe(true);
		expect(shouldEngageWorker(99, 100)).toBe(false);
	});

	it('exposes the calibrated default threshold', () => {
		expect(DEFAULT_AUTO_THRESHOLD).toBe(50_000);
	});
});
