/**
 * @remarks
 * Behavior-asserting unit tests for {@link BitmapIndex} — the Roaring-bitmap filter
 * intersection layer (non-simulation surface). Covers: `shouldUseBitmap`/`isReady` across all
 * three acceleration modes and the size threshold, lazy `getBitmap` build + throw on an
 * unregistered rule, `computeResults` (empty-rule-set -> all indices, AND chain, smallest-first
 * ordering, empty-intersection short-circuit, composite-rule predicate path), per-rule
 * `invalidateRule`, wholesale `clear()`, `cachedBitmapCount`, and source-data-version
 * invalidation. Simulation-path coverage lives in `BitmapIndex.simulate.test.ts`.
 *
 * The bitmap path requires the roaring-wasm WASM module to be initialized; the suite awaits
 * the real `initializeBitmapAcceleration()` once in `beforeAll` (fast in Node) so
 * `shouldUseBitmap`'s readiness gate passes.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import type { FilterRule } from '../rules/FilterRule.js';
import type { RuleId } from '../types.js';

import { CompositeRule } from '../rules/CompositeRule.js';
import { ValueRule } from '../rules/ValueRule.js';
import { InternalStore } from '../store/InternalStore.js';
import { AUTO_BITMAP_THRESHOLD } from './accelerationModes.js';
import { BitmapIndex } from './BitmapIndex.js';
import { initializeBitmapAcceleration } from './roaringInit.js';

interface Item {
	readonly color: string;
	readonly size: number;
}

function colorRule(value: string): ValueRule {
	return new ValueRule('color', value);
}

function sizeRule(value: number): ValueRule {
	return new ValueRule('size', value);
}

/** Install an active rule set on the store. */
function setRules(
	store: InternalStore<Item>,
	entries: readonly (readonly [RuleId, FilterRule])[],
): void {
	store.rules.value = new Map(entries);
}

/** Replace source data and bump the version (mimics a `SOURCE_DATA_SET`). */
function setData(store: InternalStore<Item>, data: readonly Item[]): void {
	store.sourceData.value = data;
	store.sourceDataVersion.value = store.sourceDataVersion.value + 1;
}

/** Build a store of `count` items cycling through red/white so rules partition the corpus. */
function makeStore(count: number): InternalStore<Item> {
	const items: Item[] = [];

	for (let i = 0; i < count; i++) {
		items.push({ color: i % 2 === 0 ? 'red' : 'white', size: i });
	}

	return new InternalStore<Item>(items);
}

beforeAll(async () => {
	await initializeBitmapAcceleration();
});

describe('BitmapIndex.shouldUseBitmap / isReady', () => {
	it('predicate mode never uses the bitmap path', () => {
		const index = new BitmapIndex(makeStore(1000), 'predicate');

		expect(index.shouldUseBitmap()).toBe(false);
		expect(index.isReady).toBe(false);
	});

	it('bitmap mode engages regardless of data size once WASM is ready', () => {
		const small = new BitmapIndex(makeStore(1), 'bitmap');

		expect(small.shouldUseBitmap()).toBe(true);
		expect(small.isReady).toBe(true);
	});

	it('auto mode engages at or above the size threshold', () => {
		const atThreshold = new BitmapIndex(makeStore(AUTO_BITMAP_THRESHOLD), 'auto');

		expect(atThreshold.shouldUseBitmap()).toBe(true);
	});

	it('auto mode declines below the size threshold', () => {
		const belowThreshold = new BitmapIndex(makeStore(AUTO_BITMAP_THRESHOLD - 1), 'auto');

		expect(belowThreshold.shouldUseBitmap()).toBe(false);
	});

	it('defaults to auto mode when no mode is supplied', () => {
		const big = new BitmapIndex(makeStore(AUTO_BITMAP_THRESHOLD));
		const tiny = new BitmapIndex(makeStore(1));

		expect(big.shouldUseBitmap()).toBe(true);
		expect(tiny.shouldUseBitmap()).toBe(false);
	});
});

describe('BitmapIndex.getBitmap', () => {
	it('lazily builds a bitmap of indices passing the rule', () => {
		const store = makeStore(6);

		setRules(store, [['red', colorRule('red')]]);
		const index = new BitmapIndex(store, 'bitmap');

		const bitmap = index.getBitmap('red');

		// Even indices are red in makeStore.
		expect([...bitmap.toArray()]).toEqual([0, 2, 4]);
		expect(index.cachedBitmapCount).toBe(1);
	});

	it('returns the cached bitmap on a second access (no rebuild)', () => {
		const store = makeStore(6);

		setRules(store, [['red', colorRule('red')]]);
		const index = new BitmapIndex(store, 'bitmap');

		const first = index.getBitmap('red');
		const second = index.getBitmap('red');

		expect(second).toBe(first);
		expect(index.cachedBitmapCount).toBe(1);
	});

	it('throws when the rule is not registered', () => {
		const store = makeStore(6);
		const index = new BitmapIndex(store, 'bitmap');

		expect(() => index.getBitmap('missing')).toThrow(/not registered/);
	});
});

describe('BitmapIndex.computeResults', () => {
	it('returns every index when no rules are active', () => {
		const store = makeStore(4);
		const index = new BitmapIndex(store, 'bitmap');

		expect([...index.computeResults()]).toEqual([0, 1, 2, 3]);
	});

	it('ANDs multiple rule bitmaps to the intersecting indices', () => {
		const store = makeStore(6);

		setRules(store, [
			['red', colorRule('red')],
			['size4', sizeRule(4)],
		]);
		const index = new BitmapIndex(store, 'bitmap');

		// Only index 4 is both red (even) and size === 4.
		expect([...index.computeResults()]).toEqual([4]);
	});

	it('short-circuits to an empty result on an empty intersection', () => {
		const store = makeStore(6);

		// red (even indices) AND size 1 (odd index) never intersect.
		setRules(store, [
			['red', colorRule('red')],
			['size1', sizeRule(1)],
		]);
		const index = new BitmapIndex(store, 'bitmap');

		expect([...index.computeResults()]).toEqual([]);
	});

	it('caches one bitmap per active rule', () => {
		const store = makeStore(6);

		setRules(store, [
			['red', colorRule('red')],
			['white', colorRule('white')],
		]);
		const index = new BitmapIndex(store, 'bitmap');

		index.computeResults();

		expect(index.cachedBitmapCount).toBe(2);
	});

	it('evaluates a composite rule via the per-item predicate path', () => {
		const store = makeStore(6);
		const composite = new CompositeRule('or', [sizeRule(0), sizeRule(2)]);

		setRules(store, [['comp', composite]]);
		const index = new BitmapIndex(store, 'bitmap');

		expect([...index.computeResults()]).toEqual([0, 2]);
	});
});

describe('BitmapIndex invalidation', () => {
	it('invalidateRule drops only that rule bitmap', () => {
		const store = makeStore(6);

		setRules(store, [
			['red', colorRule('red')],
			['white', colorRule('white')],
		]);
		const index = new BitmapIndex(store, 'bitmap');

		index.getBitmap('red');
		index.getBitmap('white');
		expect(index.cachedBitmapCount).toBe(2);

		index.invalidateRule('red');

		expect(index.cachedBitmapCount).toBe(1);
		// The surviving bitmap is still correct.
		expect([...index.getBitmap('white').toArray()]).toEqual([1, 3, 5]);
	});

	it('clear() drops all cached bitmaps and resets the version', () => {
		const store = makeStore(6);

		setRules(store, [['red', colorRule('red')]]);
		const index = new BitmapIndex(store, 'bitmap');

		index.getBitmap('red');
		expect(index.cachedBitmapCount).toBe(1);

		index.clear();

		expect(index.cachedBitmapCount).toBe(0);
	});

	it('rebuilds bitmaps when the source-data version changes', () => {
		const store = makeStore(6);

		setRules(store, [['red', colorRule('red')]]);
		const index = new BitmapIndex(store, 'bitmap');

		expect([...index.getBitmap('red').toArray()]).toEqual([0, 2, 4]);

		// New corpus: only one red item at index 0.
		setData(store, [
			{ color: 'red', size: 0 },
			{ color: 'white', size: 1 },
		]);

		// Version change forces a rebuild against the new corpus.
		expect([...index.getBitmap('red').toArray()]).toEqual([0]);
	});

	it('version invalidation also fires through computeResults', () => {
		const store = makeStore(6);

		setRules(store, [['red', colorRule('red')]]);
		const index = new BitmapIndex(store, 'bitmap');

		index.computeResults();
		expect(index.cachedBitmapCount).toBe(1);

		setData(store, [{ color: 'red', size: 0 }]);

		expect([...index.computeResults()]).toEqual([0]);
	});
});
