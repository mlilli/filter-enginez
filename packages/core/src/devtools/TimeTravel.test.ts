/**
 * @remarks
 * Tests for `TimeTravel` — undo / redo / jumpTo over an `ActionLog` + `InternalStore`. Each
 * entry's snapshots are real `captureSnapshot` results taken before/after a store mutation, so
 * `jumpTo` actually restores state. Covers `currentIndex`, `canUndo`/`canRedo` both arms,
 * `jumpTo(-1)` with and without an entry 0, `jumpTo(valid)`, the out-of-range RangeError, and
 * undo/redo including the no-op-at-bounds guards.
 */

import { describe, expect, it, vi } from 'vitest';

import type { ChangeEvent } from '../types.js';

import { FilterEngineError } from '../errors/index.js';
import { PredicateRule } from '../rules/PredicateRule.js';
import { InternalStore } from '../store/InternalStore.js';
import { captureSnapshot } from '../store/snapshots.js';
import { ActionLog, type ActionLogEntry } from './ActionLog.js';
import { TimeTravel } from './TimeTravel.js';

interface Item {
	readonly price: number;
}

function ruleAbove(threshold: number): PredicateRule<Item> {
	return new PredicateRule<Item>('price', (item) => item.price > threshold);
}

/**
 * Build a store + action log + time-travel where appending three rule mutations leaves snapshots
 * captured at each step. Returns the harness for assertions.
 *
 * @param emit - Optional emit spy forwarded to `TimeTravel`, for asserting the `'reset'`
 *   notification that fires after a real restore.
 */
function harness(emit?: (event: ChangeEvent) => void): {
	actionLog: ActionLog;
	store: InternalStore<Item>;
	timeTravel: TimeTravel<Item>;
} {
	const store = new InternalStore<Item>();
	const actionLog = new ActionLog(100);
	const timeTravel = new TimeTravel(store, actionLog, emit);

	const mutate = (id: string, rule: PredicateRule<Item>): ActionLogEntry => {
		const previousStateSnapshot = captureSnapshot(store);

		store.rules.value = new Map([...store.rules.value, [id, rule]]);

		return {
			action: { payload: { rule, ruleId: id }, type: 'RULE_ADDED' },
			nextStateSnapshot: captureSnapshot(store),
			previousStateSnapshot,
			timestamp: Date.now(),
		};
	};

	actionLog.append(mutate('a', ruleAbove(1)));
	actionLog.append(mutate('b', ruleAbove(2)));
	actionLog.append(mutate('c', ruleAbove(3)));

	return { actionLog, store, timeTravel };
}

describe('TimeTravel', () => {
	it('currentIndex tracks the action-log cursor', () => {
		const { actionLog, timeTravel } = harness();

		expect(timeTravel.currentIndex).toBe(actionLog.currentIndex);
		expect(timeTravel.currentIndex).toBe(2);
	});

	it('canUndo is true when the cursor is at or past 0, false at -1', () => {
		const { actionLog, timeTravel } = harness();

		expect(timeTravel.canUndo).toBe(true);

		actionLog.setCurrentIndex(-1);
		expect(timeTravel.canUndo).toBe(false);
	});

	it('canRedo is true mid-log, false at the latest entry', () => {
		const { actionLog, timeTravel } = harness();

		expect(timeTravel.canRedo).toBe(false);

		actionLog.setCurrentIndex(0);
		expect(timeTravel.canRedo).toBe(true);
	});

	it('jumpTo restores the post-action state at the target index', () => {
		const { store, timeTravel } = harness();

		timeTravel.jumpTo(0);

		// After the first mutation only rule 'a' existed.
		expect([...store.rules.value.keys()]).toEqual(['a']);
		expect(timeTravel.currentIndex).toBe(0);
	});

	it('jumpTo(-1) restores entry 0 previous-state and sets cursor to -1', () => {
		const { store, timeTravel } = harness();

		timeTravel.jumpTo(-1);

		// Entry 0's previousStateSnapshot was the empty pre-first-action store.
		expect(store.rules.value.size).toBe(0);
		expect(timeTravel.currentIndex).toBe(-1);
	});

	it('jumpTo(-1) on an empty log only resets the cursor (no entry 0 to restore)', () => {
		const store = new InternalStore<Item>();
		const actionLog = new ActionLog(10);
		const timeTravel = new TimeTravel(store, actionLog);

		// Drift the store so we can prove restore did NOT run.
		store.rules.value = new Map([['x', ruleAbove(1)]]);

		timeTravel.jumpTo(-1);

		expect(store.rules.value.size).toBe(1);
		expect(timeTravel.currentIndex).toBe(-1);
	});

	it('jumpTo throws DEVTOOLS_INDEX_OUT_OF_RANGE for an out-of-range index', () => {
		const { timeTravel } = harness();

		expect(() => timeTravel.jumpTo(99)).toThrow(FilterEngineError);
		expect(() => timeTravel.jumpTo(99)).toThrow(expect.objectContaining({ code: 'DEVTOOLS_INDEX_OUT_OF_RANGE' }));
	});

	it('undo steps back one action', () => {
		const { store, timeTravel } = harness();

		timeTravel.undo();

		expect(timeTravel.currentIndex).toBe(1);
		expect([...store.rules.value.keys()]).toEqual(['a', 'b']);
	});

	it('undo is a no-op once the cursor is at -1', () => {
		const { actionLog, store, timeTravel } = harness();

		actionLog.setCurrentIndex(-1);
		store.rules.value = new Map([['sentinel', ruleAbove(0)]]);

		timeTravel.undo();

		// No jumpTo fired — cursor unchanged, store untouched by time-travel.
		expect(timeTravel.currentIndex).toBe(-1);
		expect([...store.rules.value.keys()]).toEqual(['sentinel']);
	});

	it('redo steps forward one action', () => {
		const { actionLog, store, timeTravel } = harness();

		actionLog.setCurrentIndex(0);
		timeTravel.redo();

		expect(timeTravel.currentIndex).toBe(1);
		expect([...store.rules.value.keys()]).toEqual(['a', 'b']);
	});

	it('redo is a no-op once the cursor is at the latest entry', () => {
		const { store, timeTravel } = harness();

		store.rules.value = new Map([['sentinel', ruleAbove(0)]]);

		timeTravel.redo();

		expect(timeTravel.currentIndex).toBe(2);
		expect([...store.rules.value.keys()]).toEqual(['sentinel']);
	});

	describe('emit-on-restore', () => {
		it('jumpTo(valid) emits a single reset event after restoring', () => {
			const emit = vi.fn();
			const { timeTravel } = harness(emit);

			timeTravel.jumpTo(0);

			expect(emit).toHaveBeenCalledTimes(1);
			expect(emit).toHaveBeenCalledWith({ type: 'reset' });
		});

		it('jumpTo(-1) emits reset when entry 0 exists to restore', () => {
			const emit = vi.fn();
			const { timeTravel } = harness(emit);

			timeTravel.jumpTo(-1);

			expect(emit).toHaveBeenCalledExactlyOnceWith({ type: 'reset' });
		});

		it('jumpTo(-1) on an empty log does NOT emit — no state was restored', () => {
			const emit = vi.fn();
			const store = new InternalStore<Item>();
			const timeTravel = new TimeTravel(store, new ActionLog(10), emit);

			timeTravel.jumpTo(-1);

			expect(emit).not.toHaveBeenCalled();
		});

		it('jumpTo out-of-range throws and does NOT emit', () => {
			const emit = vi.fn();
			const { timeTravel } = harness(emit);

			expect(() => timeTravel.jumpTo(99)).toThrow(/Cannot jumpTo index 99/);
			expect(emit).not.toHaveBeenCalled();
		});

		it('undo emits reset when it steps back', () => {
			const emit = vi.fn();
			const { timeTravel } = harness(emit);

			timeTravel.undo();

			expect(emit).toHaveBeenCalledExactlyOnceWith({ type: 'reset' });
		});

		it('undo at -1 is a no-op and does NOT emit', () => {
			const emit = vi.fn();
			const { actionLog, timeTravel } = harness(emit);

			actionLog.setCurrentIndex(-1);
			timeTravel.undo();

			expect(emit).not.toHaveBeenCalled();
		});

		it('redo emits reset when it steps forward', () => {
			const emit = vi.fn();
			const { actionLog, timeTravel } = harness(emit);

			actionLog.setCurrentIndex(0);
			timeTravel.redo();

			expect(emit).toHaveBeenCalledExactlyOnceWith({ type: 'reset' });
		});

		it('redo at the latest entry is a no-op and does NOT emit', () => {
			const emit = vi.fn();
			const { timeTravel } = harness(emit);

			timeTravel.redo();

			expect(emit).not.toHaveBeenCalled();
		});

		it('a bare TimeTravel with no emit callback still restores (no throw)', () => {
			const { store, timeTravel } = harness();

			expect(() => timeTravel.jumpTo(0)).not.toThrow();
			expect([...store.rules.value.keys()]).toEqual(['a']);
		});
	});

	describe('beforeRestore hook', () => {
		it('runs before each restore, including a jump to -1, and not for an empty-log jump', () => {
			const store = new InternalStore<Item>();
			const actionLog = new ActionLog(100);
			const order: string[] = [];
			const timeTravel = new TimeTravel(store, actionLog, () => order.push('emit'), () => order.push('before'));

			timeTravel.jumpTo(-1);
			expect(order).toEqual([]);

			actionLog.append({
				action: { type: 'RESET' },
				nextStateSnapshot: captureSnapshot(store),
				previousStateSnapshot: captureSnapshot(store),
				timestamp: 0,
			});
			timeTravel.jumpTo(0);
			timeTravel.jumpTo(-1);

			expect(order).toEqual(['before', 'emit', 'before', 'emit']);
		});
	});
});
