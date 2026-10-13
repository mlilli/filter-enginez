/**
 * @remarks
 * Tests for `ActionLog` — the bounded, time-travel-aware chronological log. Covers append +
 * cursor advance, FIFO eviction at `maxEntries` (cursor stays put on overflow), truncate-future
 * on append-after-jump, `get`, `size`, `currentIndex`, `setCurrentIndex` (both RangeError
 * bounds), the `Symbol.iterator`, `toArray` (a copy), `clear`, and `prepend` (earlier-session
 * entries inserted ahead, cursor shifted, oldest dropped at capacity).
 */

import { describe, expect, it } from 'vitest';

import type { Action } from '../store/Action.js';
import type { EngineSnapshot } from '../store/snapshots.js';

import { FilterEngineError } from '../errors/index.js';
import { ActionLog, type ActionLogEntry } from './ActionLog.js';

/** A throwaway snapshot — ActionLog never inspects its contents. */
function snapshot(tag: number): EngineSnapshot {
	return {
		capturedAt: tag,
		expression: null,
		groups: [],
		lastChangeRuleId: null,
		rules: new Map(),
		sourceDataVersion: 0,
		workingSetVersion: 0,
	};
}

/** Builds a distinguishable entry; the action carries the tag in its groupId. */
function entry(tag: number): ActionLogEntry {
	const action: Action = { payload: { groupId: String(tag) }, type: 'GROUP_REMOVED' };

	return {
		action,
		nextStateSnapshot: snapshot(tag),
		previousStateSnapshot: snapshot(tag - 1),
		timestamp: tag,
	};
}

describe('ActionLog', () => {
	it('starts empty with a -1 cursor', () => {
		const log = new ActionLog(10);

		expect(log.size).toBe(0);
		expect(log.currentIndex).toBe(-1);
		expect(log.get(0)).toBeUndefined();
	});

	it('append advances the cursor and grows size', () => {
		const log = new ActionLog(10);

		log.append(entry(1));
		log.append(entry(2));

		expect(log.size).toBe(2);
		expect(log.currentIndex).toBe(1);
		expect(log.get(0)?.timestamp).toBe(1);
		expect(log.get(1)?.timestamp).toBe(2);
	});

	it('evicts the oldest entry FIFO once maxEntries is exceeded', () => {
		const log = new ActionLog(2);

		log.append(entry(1));
		log.append(entry(2));
		log.append(entry(3));

		expect(log.size).toBe(2);
		// Oldest (tag 1) dropped; cursor stays at 1 (the overflow branch does NOT increment).
		expect(log.currentIndex).toBe(1);
		expect(log.get(0)?.timestamp).toBe(2);
		expect(log.get(1)?.timestamp).toBe(3);
	});

	it('truncates future entries when appending after a backward jump', () => {
		const log = new ActionLog(10);

		log.append(entry(1));
		log.append(entry(2));
		log.append(entry(3));
		log.setCurrentIndex(0);

		log.append(entry(99));

		// Entries 2 and 3 (the old "future") are dropped; 99 lands at index 1.
		expect(log.size).toBe(2);
		expect(log.currentIndex).toBe(1);
		expect(log.get(1)?.timestamp).toBe(99);
	});

	it('setCurrentIndex moves the cursor within bounds', () => {
		const log = new ActionLog(10);

		log.append(entry(1));
		log.append(entry(2));

		log.setCurrentIndex(0);
		expect(log.currentIndex).toBe(0);

		log.setCurrentIndex(-1);
		expect(log.currentIndex).toBe(-1);
	});

	it('setCurrentIndex throws DEVTOOLS_INDEX_OUT_OF_RANGE below -1', () => {
		const log = new ActionLog(10);

		log.append(entry(1));

		expect(() => log.setCurrentIndex(-2)).toThrow(
			expect.objectContaining({ code: 'DEVTOOLS_INDEX_OUT_OF_RANGE', name: 'FilterEngineError' }),
		);
		expect(() => log.setCurrentIndex(-2)).toThrow(FilterEngineError);
	});

	it('setCurrentIndex throws DEVTOOLS_INDEX_OUT_OF_RANGE at or above size', () => {
		const log = new ActionLog(10);

		log.append(entry(1));

		expect(() => log.setCurrentIndex(1)).toThrow(
			expect.objectContaining({
				code: 'DEVTOOLS_INDEX_OUT_OF_RANGE',
				message: 'ActionLog index out of range: 1 (must be -1 <= i < 1)',
			}),
		);
	});

	it('is iterable from oldest to newest', () => {
		const log = new ActionLog(10);

		log.append(entry(1));
		log.append(entry(2));

		const tags = [...log].map((e) => e.timestamp);

		expect(tags).toEqual([1, 2]);
	});

	it('toArray returns a defensive copy of the entries', () => {
		const log = new ActionLog(10);

		log.append(entry(1));
		const arr = log.toArray();

		log.append(entry(2));

		// The earlier snapshot array is not retroactively grown.
		expect(arr).toHaveLength(1);
		expect(log.toArray()).toHaveLength(2);
	});

	it('clear drops all entries and resets the cursor', () => {
		const log = new ActionLog(10);

		log.append(entry(1));
		log.append(entry(2));
		log.clear();

		expect(log.size).toBe(0);
		expect(log.currentIndex).toBe(-1);
		expect([...log]).toEqual([]);
	});

	it('exposes maxEntries from the constructor', () => {
		expect(new ActionLog(42).maxEntries).toBe(42);
	});

	describe('prepend', () => {
		it('inserts earlier entries ahead and shifts the cursor with the entries it pointed at', () => {
			const log = new ActionLog(10);

			log.append(entry(10));
			log.prepend([entry(1), entry(2)]);

			expect(log.toArray().map((e) => e.timestamp)).toEqual([1, 2, 10]);
			expect(log.currentIndex).toBe(2);
		});

		it('lands the cursor on the last inserted entry of an empty log', () => {
			const log = new ActionLog(Infinity);

			log.prepend([entry(1), entry(2)]);

			expect(log.currentIndex).toBe(1);
		});

		it('drops the oldest inserted entries beyond capacity', () => {
			const log = new ActionLog(3);

			log.append(entry(10));
			log.append(entry(11));
			log.prepend([entry(1), entry(2)]);

			expect(log.toArray().map((e) => e.timestamp)).toEqual([2, 10, 11]);
			expect(log.currentIndex).toBe(2);

			log.prepend([entry(0)]);
			expect(log.size).toBe(3);
			expect(log.currentIndex).toBe(2);
		});
	});
});
