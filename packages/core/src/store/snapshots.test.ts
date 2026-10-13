/**
 * Tests for the Memento-pattern snapshot helpers — `captureSnapshot` + `restoreSnapshot`.
 *
 * @remarks
 * Covers the capture → mutate → restore round-trip: that a snapshot is an immutable, defensively
 * copied view (mutating the live store after capture does not bleed into the snapshot, and vice
 * versa), that `capturedAt` is timestamped, that source data is intentionally excluded from a
 * restore (only rules / expression / groups / lastChangeRuleId are rolled back), and that the
 * restore writes happen atomically inside a single `batch` (one effect re-run, not four).
 */

import { effect } from '@preact/signals-core';
import { afterEach, describe, expect, it } from 'vitest';

import { CompositeRule } from '../rules/CompositeRule.js';
import { PredicateRule } from '../rules/PredicateRule.js';
import { InternalStore } from './InternalStore.js';
import { captureSnapshot, restoreSnapshot } from './snapshots.js';

const disposers: (() => void)[] = [];

afterEach(() => {
	while (disposers.length > 0) {
		disposers.pop()?.();
	}
});

interface Item {
	readonly price: number;
}

function priceAbove(threshold: number): PredicateRule<Item> {
	return new PredicateRule<Item>('price', (item) => item.price > threshold);
}

describe('captureSnapshot', () => {
	it('captures the full state metadata plus a fresh `capturedAt` timestamp', () => {
		const store = new InternalStore<Item>([{ price: 10 }]);
		const rule = priceAbove(5);
		const group = { composition: 'or', filterIds: ['r'], id: 'g1' } as const;

		store.rules.value = new Map([['r', rule]]);
		store.groups.value = [group];
		store.lastChangeRuleId.value = 'r';
		store.sourceDataVersion.value = 3;
		store.workingSetVersion.value = 2;

		const before = Date.now();
		const snapshot = captureSnapshot(store);

		expect(snapshot.rules.get('r')).toBe(rule);
		expect(snapshot.groups).toEqual([group]);
		expect(snapshot.lastChangeRuleId).toBe('r');
		expect(snapshot.expression).toBeNull();
		expect(snapshot.sourceDataVersion).toBe(3);
		expect(snapshot.workingSetVersion).toBe(2);
		expect(snapshot.capturedAt).toBeGreaterThanOrEqual(before);
	});

	it('captures the expression when in expression mode', () => {
		const store = new InternalStore<Item>();
		const expr = new CompositeRule('and', [priceAbove(5)]);

		store.expression.value = expr;

		expect(captureSnapshot(store).expression).toBe(expr);
	});

	it('defensively copies `rules` and `groups` so later store mutations do not bleed in', () => {
		const store = new InternalStore<Item>();

		store.rules.value = new Map([['a', priceAbove(1)]]);
		store.groups.value = [{ composition: 'or', filterIds: ['a'], id: 'g' }];

		const snapshot = captureSnapshot(store);

		// Mutate the live store after capture.
		store.rules.value = new Map([['b', priceAbove(2)]]);
		store.groups.value = [];

		// Snapshot retains the captured-at-time values.
		expect([...snapshot.rules.keys()]).toEqual(['a']);
		expect(snapshot.groups.map((g) => g.id)).toEqual(['g']);
	});
});

describe('restoreSnapshot', () => {
	it('restores rules / expression / groups / lastChangeRuleId from the snapshot', () => {
		const store = new InternalStore<Item>();
		const rule = priceAbove(5);

		store.rules.value = new Map([['r', rule]]);
		store.groups.value = [{ composition: 'or', filterIds: ['r'], id: 'g1' }];
		store.lastChangeRuleId.value = 'r';
		const snapshot = captureSnapshot(store);

		// Drift the store away from the captured state.
		store.rules.value = new Map();
		store.groups.value = [];
		store.lastChangeRuleId.value = null;
		store.expression.value = new CompositeRule('or', []);

		restoreSnapshot(store, snapshot);

		expect([...store.rules.value.keys()]).toEqual(['r']);
		expect(store.rules.value.get('r')).toBe(rule);
		expect(store.groups.value.map((g) => g.id)).toEqual(['g1']);
		expect(store.lastChangeRuleId.value).toBe('r');
		// Snapshot's expression was null, so restore clears the drifted expression.
		expect(store.expression.value).toBeNull();
	});

	it('does NOT touch source data or its version on restore', () => {
		const store = new InternalStore<Item>([{ price: 1 }]);
		const snapshot = captureSnapshot(store);

		// Change source data + version after capture.
		store.sourceData.value = [{ price: 99 }, { price: 100 }];
		store.sourceDataVersion.value = 7;

		restoreSnapshot(store, snapshot);

		// Source data + version are left exactly as the live store had them.
		expect(store.sourceData.value).toEqual([{ price: 99 }, { price: 100 }]);
		expect(store.sourceDataVersion.value).toBe(7);
	});

	it('copies the snapshot maps/arrays so restored state is decoupled from the snapshot', () => {
		const store = new InternalStore<Item>();

		store.rules.value = new Map([['r', priceAbove(5)]]);
		store.groups.value = [{ composition: 'or', filterIds: ['r'], id: 'g1' }];
		const snapshot = captureSnapshot(store);

		restoreSnapshot(store, snapshot);

		// The store's restored containers are fresh instances, not the snapshot's own.
		expect(store.rules.value).not.toBe(snapshot.rules);
		expect(store.groups.value).not.toBe(snapshot.groups);
	});

	it('applies all four restored writes in a single batch (one effect re-run)', () => {
		const store = new InternalStore<Item>();

		store.rules.value = new Map([['r', priceAbove(5)]]);
		store.groups.value = [{ composition: 'or', filterIds: ['r'], id: 'g1' }];
		store.lastChangeRuleId.value = 'r';
		store.expression.value = new CompositeRule('and', [priceAbove(1)]);
		const snapshot = captureSnapshot(store);

		// Drift, then start counting effect runs.
		store.rules.value = new Map();
		store.expression.value = null;
		store.groups.value = [];
		store.lastChangeRuleId.value = null;

		let runs = 0;

		disposers.push(
			effect(() => {
				// Touch every restored signal so the effect is subscribed to all four.
				void store.rules.value;
				void store.expression.value;
				void store.groups.value;
				void store.lastChangeRuleId.value;
				runs++;
			}),
		);

		// One synchronous run on subscription.
		expect(runs).toBe(1);

		restoreSnapshot(store, snapshot);

		// Despite four signal writes, batching collapses them into exactly one extra run.
		expect(runs).toBe(2);
	});
});
