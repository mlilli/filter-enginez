/**
 * @remarks
 * Tests for `DevtoolsPersistence` — cross-reload action-log persistence over a `StorageAdapter`.
 * Covers `load` (empty/null storage → [], non-object → [], non-array `entries` → [], valid
 * encoded entries revived, undecodable entries skipped), the JSON round-trip of real rules and
 * expressions (an open `RangeRule` bound included), `scheduleSave` debounce (collapsing rapid
 * calls; fake timers), `flushNow` (clears a pending timer, truncates to `maxPersistedEntries`,
 * skips entries it cannot store, calls `adapter.save`), config defaults vs overrides, and `clear`
 * (delegates to `adapter.remove`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StorageAdapter } from '../storage/StorageAdapter.js';
import type { ActionLogEntry } from './ActionLog.js';

import { and } from '../composition/factories.js';
import { PredicateRule } from '../rules/PredicateRule.js';
import { RangeRule } from '../rules/RangeRule.js';
import { ValueRule } from '../rules/ValueRule.js';
import { DevtoolsPersistence } from './DevtoolsPersistence.js';
import { serializeEntry } from './snapshotCodec.js';

/** In-memory adapter recording every call for assertions. */
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

/** A minimal rule-free entry, distinguishable by its timestamp. */
function entry(tag: number): ActionLogEntry {
	return {
		action: { payload: { groupId: String(tag) }, type: 'GROUP_REMOVED' },
		nextStateSnapshot: {
			capturedAt: tag,
			expression: null,
			groups: [],
			lastChangeRuleId: null,
			rules: new Map(),
			sourceDataVersion: 0,
			workingSetVersion: 0,
		},
		previousStateSnapshot: {
			capturedAt: tag - 1,
			expression: null,
			groups: [],
			lastChangeRuleId: null,
			rules: new Map(),
			sourceDataVersion: 0,
			workingSetVersion: 0,
		},
		timestamp: tag,
	};
}

describe('DevtoolsPersistence', () => {
	describe('load', () => {
		it('returns [] when storage is empty (null)', async () => {
			const adapter = new RecordingAdapter();
			const persistence = new DevtoolsPersistence({ adapter, key: 'k' });

			expect(await persistence.load()).toEqual([]);
		});

		it('returns [] when storage holds a non-object value', async () => {
			const adapter = new RecordingAdapter();

			adapter.store = 'not-an-object';
			const persistence = new DevtoolsPersistence({ adapter, key: 'k' });

			expect(await persistence.load()).toEqual([]);
		});

		it('returns [] when the stored object has a non-array entries field', async () => {
			const adapter = new RecordingAdapter();

			adapter.store = { entries: 'nope' };
			const persistence = new DevtoolsPersistence({ adapter, key: 'k' });

			expect(await persistence.load()).toEqual([]);
		});

		it('revives the stored encoded entries', async () => {
			const adapter = new RecordingAdapter();
			const entries = [serializeEntry(entry(1)), serializeEntry(entry(2))];

			adapter.store = { entries };
			const persistence = new DevtoolsPersistence({ adapter, key: 'k' });

			const loaded = await persistence.load();

			expect(loaded).toHaveLength(2);
			expect(loaded[0]?.timestamp).toBe(1);
			expect(loaded[0]?.nextStateSnapshot.rules).toBeInstanceOf(Map);
		});

		it('skips entries that are malformed or name an unregistered rule type', async () => {
			const adapter = new RecordingAdapter();
			const unknownRule = {
				...serializeEntry(entry(3)),
				action: { payload: { rule: { config: {}, field: 'x', type: 'NoSuchRule' }, ruleId: 'r' }, type: 'RULE_ADDED' },
			};

			adapter.store = { entries: [null, { action: 42 }, unknownRule, serializeEntry(entry(4))]};
			const loaded = await new DevtoolsPersistence({ adapter, key: 'k' }).load();

			expect(loaded.map((e) => e.timestamp)).toEqual([4]);
		});

		it('keeps an open range bound through JSON, which writes it as null', async () => {
			const adapter = new RecordingAdapter();
			const persistence = new DevtoolsPersistence({ adapter, key: 'k' });
			const price = new RangeRule('price', { max: Number.POSITIVE_INFINITY, min: 60 });
			const withRange: ActionLogEntry = {
				...entry(7),
				action: { payload: { rule: price, ruleId: 'price' }, type: 'RULE_ADDED' },
				nextStateSnapshot: { ...entry(7).nextStateSnapshot, rules: new Map([['price', price]]) },
			};

			await persistence.flushNow([withRange]);
			adapter.store = JSON.parse(JSON.stringify(adapter.store));
			const [loaded] = await persistence.load();
			const revived = loaded?.nextStateSnapshot.rules.get('price');

			expect(revived?.config).toEqual({ max: Number.POSITIVE_INFINITY, min: 60 });
			expect(revived?.action({ price: 1e9 }, revived)).toBe(true);
		});

		it('round-trips real rules and expressions through JSON', async () => {
			const adapter = new RecordingAdapter();
			const persistence = new DevtoolsPersistence({ adapter, key: 'k' });
			const red = new ValueRule('color', 'red');
			const expression = and(new ValueRule('size', 'L'), red);
			const withRules: ActionLogEntry = {
				...entry(5),
				action: { payload: { rule: red, ruleId: 'color' }, type: 'RULE_ADDED' },
				nextStateSnapshot: { ...entry(5).nextStateSnapshot, expression, rules: new Map([['color', red]]) },
			};
			const exprEntry: ActionLogEntry = { ...entry(6), action: { payload: { expression }, type: 'EXPRESSION_SET' }};

			await persistence.flushNow([withRules, exprEntry]);
			adapter.store = JSON.parse(JSON.stringify(adapter.store));
			const [loaded, loadedExpr] = await persistence.load();

			expect(loaded?.action).toMatchObject({ payload: { ruleId: 'color' }, type: 'RULE_ADDED' });
			const revived = loaded?.nextStateSnapshot.rules.get('color');

			expect(revived).toBeInstanceOf(ValueRule);
			expect(revived?.action({ color: 'red' }, revived)).toBe(true);
			expect(loaded?.nextStateSnapshot.expression?.config.op).toBe('and');
			expect(loadedExpr?.action).toMatchObject({ type: 'EXPRESSION_SET' });
		});
	});

	describe('scheduleSave (debounce)', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it('collapses rapid scheduleSave calls into a single save after the debounce window', async () => {
			const adapter = new RecordingAdapter();
			const persistence = new DevtoolsPersistence({ adapter, debounceMs: 1000, key: 'k' });

			persistence.scheduleSave([entry(1)]);
			persistence.scheduleSave([entry(1), entry(2)]);
			persistence.scheduleSave([entry(1), entry(2), entry(3)]);

			expect(adapter.saved).toHaveLength(0);

			await vi.advanceTimersByTimeAsync(1000);

			expect(adapter.saved).toHaveLength(1);
			expect((adapter.saved[0]?.value as { entries: ActionLogEntry[] }).entries).toHaveLength(3);
		});

		it('hands a failed debounced save to onSaveFailure', async () => {
			const adapter = new RecordingAdapter();
			const quota = new Error('QuotaExceededError');

			adapter.save = (): void => {
				throw quota;
			};
			const onSaveFailure = vi.fn();
			const persistence = new DevtoolsPersistence({ adapter, debounceMs: 10, key: 'k' }, onSaveFailure);

			persistence.scheduleSave([entry(1)]);
			await vi.advanceTimersByTimeAsync(10);

			expect(onSaveFailure).toHaveBeenCalledExactlyOnceWith(quota);
		});

		it('contains a failed debounced save when no callback is given', async () => {
			const adapter = new RecordingAdapter();

			adapter.save = (): void => {
				throw new Error('revoked');
			};
			const persistence = new DevtoolsPersistence({ adapter, debounceMs: 10, key: 'k' });

			persistence.scheduleSave([entry(1)]);

			// An unhandled rejection would fail the run; the default callback absorbs it.
			await expect(vi.advanceTimersByTimeAsync(10)).resolves.toBeDefined();
		});

		it('does not save before the debounce window elapses', async () => {
			const adapter = new RecordingAdapter();
			const persistence = new DevtoolsPersistence({ adapter, debounceMs: 1000, key: 'k' });

			persistence.scheduleSave([entry(1)]);
			await vi.advanceTimersByTimeAsync(999);

			expect(adapter.saved).toHaveLength(0);
		});
	});

	describe('flushNow', () => {
		it('saves immediately and wraps entries in an { entries } envelope', async () => {
			const adapter = new RecordingAdapter();
			const persistence = new DevtoolsPersistence({ adapter, key: 'k' });

			await persistence.flushNow([entry(1), entry(2)]);

			expect(adapter.saved).toHaveLength(1);
			expect(adapter.saved[0]?.key).toBe('k');
			expect((adapter.saved[0]?.value as { entries: ActionLogEntry[] }).entries).toHaveLength(2);
		});

		it('truncates to the last maxPersistedEntries entries', async () => {
			const adapter = new RecordingAdapter();
			const persistence = new DevtoolsPersistence({
				adapter,
				key: 'k',
				maxPersistedEntries: 2,
			});

			await persistence.flushNow([entry(1), entry(2), entry(3)]);

			const saved = (adapter.saved[0]?.value as { entries: ActionLogEntry[] }).entries;

			expect(saved.map((e) => e.timestamp)).toEqual([2, 3]);
		});

		it('clears a pending debounced timer so it does not double-write', async () => {
			vi.useFakeTimers();
			const adapter = new RecordingAdapter();
			const persistence = new DevtoolsPersistence({ adapter, debounceMs: 1000, key: 'k' });

			persistence.scheduleSave([entry(1)]);
			await persistence.flushNow([entry(1), entry(2)]);

			// The scheduled timer was cancelled by flushNow; advancing time triggers no extra save.
			await vi.advanceTimersByTimeAsync(2000);

			expect(adapter.saved).toHaveLength(1);
			vi.useRealTimers();
		});
	});

	describe('entries that cannot be stored', () => {
		it('skips data-replacing actions and entries holding a PredicateRule', async () => {
			const adapter = new RecordingAdapter();
			const persistence = new DevtoolsPersistence({ adapter, key: 'k' });
			const predicate = new PredicateRule<unknown>(undefined, () => true);
			const dataEntry: ActionLogEntry = { ...entry(7), action: { payload: { items: [1]}, type: 'SOURCE_DATA_SET' }};
			const predicateEntry: ActionLogEntry = {
				...entry(8),
				action: { payload: { rule: predicate, ruleId: 'p' }, type: 'RULE_ADDED' },
			};

			await persistence.flushNow([dataEntry, predicateEntry, entry(9)]);
			const saved = (adapter.saved[0]?.value as { entries: { timestamp: number }[] }).entries;

			expect(saved.map((e) => e.timestamp)).toEqual([9]);
		});
	});

	describe('clear', () => {
		it('removes the persisted key via the adapter', async () => {
			const adapter = new RecordingAdapter();
			const persistence = new DevtoolsPersistence({ adapter, key: 'log-key' });

			await persistence.clear();

			expect(adapter.removed).toEqual(['log-key']);
		});
	});
});
