/**
 * @remarks
 * Tests for `Replay` — re-applies logged actions via `Dispatcher.apply` (not `dispatch`, so no
 * re-logging). Covers replay from an index to the end (effects land on the store), replay with a
 * `startingFrom` snapshot restored first, replay from a mid-log index (earlier actions skipped),
 * and the skip of `undefined`-indexed entries. Assertions read store state after replay. Also covers
 * the owner hooks: `beforeRestore` runs first and one `reset` event is emitted at the end.
 */

import { describe, expect, it, vi } from 'vitest';

import { PredicateRule } from '../rules/PredicateRule.js';
import { Dispatcher } from '../store/Dispatcher.js';
import { InternalStore } from '../store/InternalStore.js';
import { captureSnapshot } from '../store/snapshots.js';
import { ActionLog, type ActionLogEntry } from './ActionLog.js';
import { Replay } from './Replay.js';

interface Item {
	readonly price: number;
}

function ruleAbove(threshold: number): PredicateRule<Item> {
	return new PredicateRule<Item>('price', (item) => item.price > threshold);
}

function logEntry(id: string, rule: PredicateRule<Item>): ActionLogEntry {
	return {
		action: { payload: { rule, ruleId: id }, type: 'RULE_ADDED' },
		nextStateSnapshot: captureSnapshot(new InternalStore<Item>()),
		previousStateSnapshot: captureSnapshot(new InternalStore<Item>()),
		timestamp: Date.now(),
	};
}

describe('Replay', () => {
	it('re-applies actions from the given index to the end of the log', () => {
		const store = new InternalStore<Item>();
		const dispatcher = new Dispatcher(store);
		const actionLog = new ActionLog(100);

		actionLog.append(logEntry('a', ruleAbove(1)));
		actionLog.append(logEntry('b', ruleAbove(2)));

		const replay = new Replay(store, dispatcher, actionLog);

		replay.replay(0);

		expect([...store.rules.value.keys()]).toEqual(['a', 'b']);
	});

	it('skips earlier actions when replaying from a mid-log index', () => {
		const store = new InternalStore<Item>();
		const dispatcher = new Dispatcher(store);
		const actionLog = new ActionLog(100);

		actionLog.append(logEntry('a', ruleAbove(1)));
		actionLog.append(logEntry('b', ruleAbove(2)));
		actionLog.append(logEntry('c', ruleAbove(3)));

		const replay = new Replay(store, dispatcher, actionLog);

		replay.replay(2);

		// Only the action at index 2 was applied.
		expect([...store.rules.value.keys()]).toEqual(['c']);
	});

	it('restores a startingFrom snapshot before replaying', () => {
		const store = new InternalStore<Item>();
		const dispatcher = new Dispatcher(store);
		const actionLog = new ActionLog(100);

		// Capture a snapshot that has rule 'seed', then drift the store away from it.
		store.rules.value = new Map([['seed', ruleAbove(0)]]);
		const startingFrom = captureSnapshot(store);

		store.rules.value = new Map([['drift', ruleAbove(9)]]);

		actionLog.append(logEntry('a', ruleAbove(1)));

		const replay = new Replay(store, dispatcher, actionLog);

		replay.replay(0, { startingFrom });

		// 'seed' restored from the snapshot, 'a' applied on top; 'drift' gone.
		expect([...store.rules.value.keys()]).toEqual(['seed', 'a']);
	});

	it('replaying from an index past the end is a no-op', () => {
		const store = new InternalStore<Item>();
		const dispatcher = new Dispatcher(store);
		const actionLog = new ActionLog(100);

		actionLog.append(logEntry('a', ruleAbove(1)));

		const replay = new Replay(store, dispatcher, actionLog);

		replay.replay(5);

		expect(store.rules.value.size).toBe(0);
	});

	it('calls beforeRestore first and emits one reset event when done', () => {
		const store = new InternalStore<Item>();
		const actionLog = new ActionLog(100);
		const order: string[] = [];
		const emit = vi.fn(() => order.push('emit'));

		actionLog.append(logEntry('a', ruleAbove(1)));
		actionLog.append(logEntry('b', ruleAbove(2)));
		new Replay(store, new Dispatcher(store), actionLog, emit, () => order.push('before')).replay(0);

		expect(order).toEqual(['before', 'emit']);
		expect(emit).toHaveBeenCalledExactlyOnceWith({ type: 'reset' });
	});
});
