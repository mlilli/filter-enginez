/**
 * @remarks
 * Tests for the `Devtools` coordinator — composes ActionLog, TimeTravel, Replay, Diff, the
 * Redux bridge, and persistence over a real `InternalStore` + `Dispatcher`. Covers construction
 * defaults + config (actionLogSize, `bridgeToReduxDevtools: false` → null bridge, persistence
 * present/absent), the time-travel passthroughs, diff passthrough (valid + out-of-range → []),
 * replay passthrough, `recordAction` (appends, forwards to bridge, schedules persistence),
 * `init` (with/without persistence; loads persisted entries ahead of this session's; survives a
 * storage failure; inits and subscribes the bridge), routing of Redux DevTools scrub messages to
 * time-travel, `enabled: false`, and `destroy` (flushes persistence, disconnects bridge).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StorageAdapter } from '../storage/StorageAdapter.js';
import type { ActionLogEntry } from './ActionLog.js';

import { PredicateRule } from '../rules/PredicateRule.js';
import { Dispatcher } from '../store/Dispatcher.js';
import { InternalStore } from '../store/InternalStore.js';
import { captureSnapshot, type EngineSnapshot } from '../store/snapshots.js';
import { Devtools } from './Devtools.js';
import { serializeEntry } from './snapshotCodec.js';

interface Item {
	readonly price: number;
}

function ruleAbove(threshold: number): PredicateRule<Item> {
	return new PredicateRule<Item>('price', (item) => item.price > threshold);
}

function harness(config: ConstructorParameters<typeof Devtools<Item>>[2] = {}): {
	devtools: Devtools<Item>;
	dispatcher: Dispatcher<Item>;
	store: InternalStore<Item>;
} {
	const store = new InternalStore<Item>();
	const dispatcher = new Dispatcher(store);
	const devtools = new Devtools(store, dispatcher, config);

	return { devtools, dispatcher, store };
}

/** Records two real before/after snapshots around a rule add and returns them. */
function recordRule(
	devtools: Devtools<Item>,
	store: InternalStore<Item>,
	id: string,
): { next: EngineSnapshot; previous: EngineSnapshot } {
	const previous = captureSnapshot(store);

	store.rules.value = new Map([...store.rules.value, [id, ruleAbove(1)]]);
	const next = captureSnapshot(store);

	devtools.recordAction({ payload: { rule: ruleAbove(1), ruleId: id }, type: 'RULE_ADDED' }, previous, next);

	return { next, previous };
}

class RecordingAdapter implements StorageAdapter {
	readonly removed: string[] = [];
	readonly saved: { key: string; value: unknown }[] = [];
	store: unknown = null;

	load(_key: string): unknown {
		return this.store;
	}

	remove(key: string): void {
		this.removed.push(key);
	}

	save(key: string, value: unknown): void {
		this.saved.push({ key, value });
		this.store = value;
	}
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('Devtools', () => {
	describe('construction', () => {
		it('builds an action log with the default size and a Redux bridge by default', () => {
			vi.stubGlobal('__REDUX_DEVTOOLS_EXTENSION__', undefined);
			const { devtools } = harness();

			expect(devtools.actionLog.maxEntries).toBe(100);
			// Bridge is constructed (default bridgeToReduxDevtools true) but inert with no extension.
			expect(devtools.reduxBridge).not.toBeNull();
			expect(devtools.persistence).toBeNull();
		});

		it('honors a custom actionLogSize', () => {
			const { devtools } = harness({ actionLogSize: 5 });

			expect(devtools.actionLog.maxEntries).toBe(5);
		});

		it('sets reduxBridge to null when bridgeToReduxDevtools is false', () => {
			const { devtools } = harness({ bridgeToReduxDevtools: false });

			expect(devtools.reduxBridge).toBeNull();
		});

		it('constructs a persistence instance when a persistence config is given', () => {
			const adapter = new RecordingAdapter();
			const { devtools } = harness({ persistence: { adapter, key: 'k' }});

			expect(devtools.persistence).not.toBeNull();
		});
	});

	describe('time-travel passthroughs', () => {
		it('exposes currentIndex / canUndo / canRedo and jumpTo / undo / redo', () => {
			const { devtools, store } = harness({ bridgeToReduxDevtools: false });

			expect(devtools.currentIndex).toBe(-1);
			expect(devtools.canUndo).toBe(false);
			expect(devtools.canRedo).toBe(false);

			recordRule(devtools, store, 'a');
			recordRule(devtools, store, 'b');

			expect(devtools.currentIndex).toBe(1);
			expect(devtools.canUndo).toBe(true);

			devtools.undo();
			expect(devtools.currentIndex).toBe(0);
			expect(devtools.canRedo).toBe(true);

			devtools.redo();
			expect(devtools.currentIndex).toBe(1);

			devtools.jumpTo(0);
			expect(devtools.currentIndex).toBe(0);
			expect([...store.rules.value.keys()]).toEqual(['a']);
		});

		it('forwards the emitChange callback to TimeTravel so undo/redo/jumpTo emit reset', () => {
			const emit = vi.fn();
			const store = new InternalStore<Item>();
			const dispatcher = new Dispatcher(store);
			const devtools = new Devtools(store, dispatcher, { bridgeToReduxDevtools: false }, emit);

			recordRule(devtools, store, 'a');
			recordRule(devtools, store, 'b');
			expect(emit).not.toHaveBeenCalled(); // recordAction alone must not emit.

			devtools.undo();
			devtools.redo();
			devtools.jumpTo(0);

			expect(emit).toHaveBeenCalledTimes(3);
			expect(emit).toHaveBeenNthCalledWith(1, { type: 'reset' });
			expect(emit).toHaveBeenNthCalledWith(2, { type: 'reset' });
			expect(emit).toHaveBeenNthCalledWith(3, { type: 'reset' });
		});
	});

	describe('diff passthrough', () => {
		it('diffs the snapshots at two action-log indices', () => {
			const { devtools, store } = harness({ bridgeToReduxDevtools: false });

			// Bump a scalar field between the two records so the diff is deterministic regardless
			// of microdiff's Map-handling (and independent of same-millisecond `capturedAt`).
			recordRule(devtools, store, 'a');
			store.sourceDataVersion.value = 99;
			recordRule(devtools, store, 'b');

			const edits = devtools.diff(0, 1);

			expect(edits.some((e) => e.path.includes('sourceDataVersion'))).toBe(true);
		});

		it('returns [] when the from index is out of range', () => {
			const { devtools, store } = harness({ bridgeToReduxDevtools: false });

			recordRule(devtools, store, 'a');

			expect(devtools.diff(99, 0)).toEqual([]);
		});

		it('returns [] when the to index is out of range', () => {
			const { devtools, store } = harness({ bridgeToReduxDevtools: false });

			recordRule(devtools, store, 'a');

			expect(devtools.diff(0, 99)).toEqual([]);
		});
	});

	describe('replay passthrough', () => {
		it('delegates to the replayer', () => {
			const { devtools, store } = harness({ bridgeToReduxDevtools: false });

			recordRule(devtools, store, 'a');
			recordRule(devtools, store, 'b');

			// Drift the store, then replay the whole log back onto it.
			store.rules.value = new Map();
			devtools.replay(0);

			expect([...store.rules.value.keys()]).toEqual(['a', 'b']);
		});
	});

	describe('recordAction', () => {
		it('appends an entry, forwards to the bridge, and schedules persistence', () => {
			vi.useFakeTimers();
			const connection = { init: vi.fn(), send: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() };

			vi.stubGlobal('__REDUX_DEVTOOLS_EXTENSION__', { connect: vi.fn(() => connection) });
			const adapter = new RecordingAdapter();
			const { devtools, store } = harness({ persistence: { adapter, debounceMs: 100, key: 'k' }});

			recordRule(devtools, store, 'a');

			expect(devtools.actionLog.size).toBe(1);
			expect(connection.send).toHaveBeenCalledTimes(1);
		});

		it('attaches optional meta to the appended entry', () => {
			const { devtools, store } = harness({ bridgeToReduxDevtools: false });
			const previous = captureSnapshot(store);

			store.rules.value = new Map([['a', ruleAbove(1)]]);
			const next = captureSnapshot(store);

			devtools.recordAction(
				{ payload: { rule: ruleAbove(1), ruleId: 'a' }, type: 'RULE_ADDED' },
				previous,
				next,
				{ source: 'devtools' },
			);

			const entry = devtools.actionLog.get(0) as ActionLogEntry;

			expect(entry.meta).toEqual({ source: 'devtools' });
		});

		it('omits meta when none is supplied', () => {
			const { devtools, store } = harness({ bridgeToReduxDevtools: false });

			recordRule(devtools, store, 'a');

			expect(devtools.actionLog.get(0)).not.toHaveProperty('meta');
		});
	});

	describe('init', () => {
		it('resolves without persistence and inits the bridge', async () => {
			const connection = { init: vi.fn(), send: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() };

			vi.stubGlobal('__REDUX_DEVTOOLS_EXTENSION__', { connect: vi.fn(() => connection) });
			const { devtools } = harness();

			await devtools.init(null);

			expect(connection.init).toHaveBeenCalledWith(null);
		});

		it('loads persisted entries ahead of this session\'s entries', async () => {
			const adapter = new RecordingAdapter();

			adapter.store = {
				entries: [
					serializeEntry({
						action: { payload: { groupId: '1' }, type: 'GROUP_REMOVED' },
						nextStateSnapshot: captureSnapshot(new InternalStore<Item>()),
						previousStateSnapshot: captureSnapshot(new InternalStore<Item>()),
						timestamp: 1,
					}),
				],
			};
			const { devtools, store } = harness({
				bridgeToReduxDevtools: false,
				persistence: { adapter, debounceMs: 100_000, key: 'k' },
			});
			const ready = devtools.init(null);

			// An action recorded while the load is in flight stays the newest entry.
			recordRule(devtools, store, 'a');
			await ready;
			await devtools.ready;

			expect(devtools.actionLog.size).toBe(2);
			expect(devtools.actionLog.get(0)?.timestamp).toBe(1);
			expect(devtools.actionLog.get(1)?.action.type).toBe('RULE_ADDED');
			expect(devtools.currentIndex).toBe(1);
		});

		it('keeps this session\'s log when the storage load fails, and reports it to onError', async () => {
			const adapter = new RecordingAdapter();
			const unavailable = new Error('storage unavailable');

			adapter.load = (): unknown => {
				throw unavailable;
			};
			const onError = vi.fn();
			const { devtools } = harness({ bridgeToReduxDevtools: false, onError, persistence: { adapter, key: 'k' }});

			await expect(devtools.init(null)).resolves.toBeUndefined();
			expect(devtools.actionLog.size).toBe(0);
			expect(onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
				cause: unavailable,
				code: 'DEVTOOLS_PERSISTENCE_FAILED',
				message: expect.stringContaining('loading the persisted action log failed') as unknown,
				name: 'FilterEngineError',
			}));
		});

		it('warns once per code through console.warn when no onError is given', async () => {
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
			const adapter = new RecordingAdapter();

			adapter.load = (): unknown => {
				throw new Error('storage unavailable');
			};
			adapter.save = (): void => {
				throw new Error('quota');
			};
			const { devtools } = harness({ bridgeToReduxDevtools: false, persistence: { adapter, key: 'k' }});

			await devtools.init(null);
			// The same code again (the final save on destroy fails too): still one warning.
			await devtools.destroy();

			expect(warn).toHaveBeenCalledOnce();
			expect(warn.mock.calls[0]?.[0]).toMatchObject({ code: 'DEVTOOLS_PERSISTENCE_FAILED' });
			warn.mockRestore();
		});

		it('reports a failed debounced save', async () => {
			vi.useFakeTimers();
			const adapter = new RecordingAdapter();
			const quota = new Error('quota');

			adapter.save = (): void => {
				throw quota;
			};
			const onError = vi.fn();
			const { devtools, store } = harness({
				bridgeToReduxDevtools: false,
				onError,
				persistence: { adapter, debounceMs: 10, key: 'k' },
			});

			recordRule(devtools, store, 'a');
			await vi.advanceTimersByTimeAsync(10);
			vi.useRealTimers();

			expect(onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
				cause: quota,
				code: 'DEVTOOLS_PERSISTENCE_FAILED',
				message: expect.stringContaining('saving the action log failed') as unknown,
			}));
		});

		it('resolves ready at once when init was never called', async () => {
			const { devtools } = harness({ bridgeToReduxDevtools: false });

			await expect(devtools.ready).resolves.toBeUndefined();
		});
	});

	describe('Redux DevTools scrubbing', () => {
		/** Boot devtools against a fake extension and return the message listener it subscribed. */
		function connected(): {
			devtools: Devtools<Item>;
			listener: (message: unknown) => void;
			store: InternalStore<Item>;
		} {
			let listener: (message: unknown) => void = () => undefined;
			const connection = {
				init: vi.fn(),
				send: vi.fn(),
				subscribe: vi.fn((next: (message: unknown) => void) => {
					listener = next;
				}),
				unsubscribe: vi.fn(),
			};

			vi.stubGlobal('__REDUX_DEVTOOLS_EXTENSION__', { connect: vi.fn(() => connection) });
			const { devtools, store } = harness();

			void devtools.init(captureSnapshot(store));
			recordRule(devtools, store, 'a');
			recordRule(devtools, store, 'b');

			return { devtools, listener: (message) => {
				listener(message);
			}, store };
		}

		it('jumps to the entry the extension numbered, for JUMP_TO_ACTION and JUMP_TO_STATE', () => {
			const { devtools, listener, store } = connected();

			listener({ payload: { actionId: 1, type: 'JUMP_TO_ACTION' }, type: 'DISPATCH' });
			expect(devtools.currentIndex).toBe(0);
			expect([...store.rules.value.keys()]).toEqual(['a']);

			listener({ payload: { actionId: 2, type: 'JUMP_TO_STATE' }, type: 'DISPATCH' });
			expect(devtools.currentIndex).toBe(1);
		});

		it('maps action 0 (the initial state) to the state before the oldest entry', () => {
			const { devtools, listener, store } = connected();

			listener({ payload: { actionId: 0, type: 'JUMP_TO_STATE' }, type: 'DISPATCH' });

			expect(devtools.currentIndex).toBe(-1);
			expect(store.rules.value.size).toBe(0);
		});

		it('ignores unknown action numbers and every other message', () => {
			const { devtools, listener } = connected();

			for (const message of [
				null,
				{ type: 'START' },
				{ payload: { type: 'COMMIT' }, type: 'DISPATCH' },
				{ payload: { actionId: '1', type: 'JUMP_TO_ACTION' }, type: 'DISPATCH' },
				{ payload: { actionId: 99, type: 'JUMP_TO_ACTION' }, type: 'DISPATCH' },
			]) {
				listener(message);
			}

			expect(devtools.currentIndex).toBe(1);
		});
	});

	describe('enabled: false', () => {
		it('records nothing and builds no bridge or persistence', () => {
			const adapter = new RecordingAdapter();
			const { devtools, store } = harness({ enabled: false, persistence: { adapter, key: 'k' }});

			recordRule(devtools, store, 'a');

			expect(devtools.enabled).toBe(false);
			expect(devtools.actionLog.size).toBe(0);
			expect(devtools.reduxBridge).toBeNull();
			expect(devtools.persistence).toBeNull();
		});
	});

	describe('destroy', () => {
		it('flushes persistence and disconnects the bridge', async () => {
			const connection = { init: vi.fn(), send: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() };

			vi.stubGlobal('__REDUX_DEVTOOLS_EXTENSION__', { connect: vi.fn(() => connection) });
			const adapter = new RecordingAdapter();
			// Long debounce so the recordAction-scheduled save never fires on its own — destroy's
			// flushNow is the sole writer, proving the flush-on-teardown path in isolation.
			const { devtools, store } = harness({
				persistence: { adapter, debounceMs: 100_000, key: 'k' },
			});

			recordRule(devtools, store, 'a');
			expect(adapter.saved).toHaveLength(0);

			await devtools.destroy();

			expect(adapter.saved.length).toBeGreaterThan(0);
			expect(connection.unsubscribe).toHaveBeenCalled();
		});

		it('resolves cleanly with no persistence and no extension', async () => {
			vi.stubGlobal('__REDUX_DEVTOOLS_EXTENSION__', undefined);
			const { devtools } = harness();

			await expect(devtools.destroy()).resolves.toBeUndefined();
		});

		it('reports a failed final save and still disconnects the bridge', async () => {
			const connection = { init: vi.fn(), send: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() };

			vi.stubGlobal('__REDUX_DEVTOOLS_EXTENSION__', { connect: vi.fn(() => connection) });
			const adapter = new RecordingAdapter();
			const quota = new Error('quota');

			adapter.save = (): void => {
				throw quota;
			};
			const onError = vi.fn();
			const { devtools } = harness({ onError, persistence: { adapter, debounceMs: 100_000, key: 'k' }});

			await expect(devtools.destroy()).resolves.toBeUndefined();
			expect(onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
				cause: quota,
				code: 'DEVTOOLS_PERSISTENCE_FAILED',
				message: expect.stringContaining('on destroy') as unknown,
			}));
			expect(connection.unsubscribe).toHaveBeenCalled();
		});
	});

	describe('a failing Redux DevTools extension', () => {
		it('reports DEVTOOLS_EXTENSION_FAILED and keeps recording the action', () => {
			const boom = new Error('send boom');
			const connection = {
				init: vi.fn(),
				send: vi.fn(() => {
					throw boom;
				}),
				subscribe: vi.fn(),
				unsubscribe: vi.fn(),
			};

			vi.stubGlobal('__REDUX_DEVTOOLS_EXTENSION__', { connect: vi.fn(() => connection) });
			const onError = vi.fn();
			const { devtools, store } = harness({ onError });

			recordRule(devtools, store, 'a');

			expect(devtools.actionLog.size).toBe(1);
			expect(devtools.reduxBridge?.isConnected).toBe(false);
			expect(onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
				cause: boom,
				code: 'DEVTOOLS_EXTENSION_FAILED',
				name: 'FilterEngineError',
			}));
		});
	});
});
