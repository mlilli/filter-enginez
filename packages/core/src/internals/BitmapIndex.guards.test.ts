/**
 * @remarks
 * Tests for the exactness guards around the bitmap path: {@link BitmapIndex.tryComputeResults}
 * (declines in expression mode, for a narrowed working set, for a disjunctive group and when
 * bitmaps are not engaged; otherwise equals the predicate answer), the matching declines added
 * to {@link BitmapIndex.simulateIntersection}, and {@link BitmapIndex.buildEphemeralBitmap}.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import type { FilterRule } from '../rules/FilterRule.js';

import { CompositeRule } from '../rules/CompositeRule.js';
import { ValueRule } from '../rules/ValueRule.js';
import { InternalStore } from '../store/InternalStore.js';
import { BitmapIndex } from './BitmapIndex.js';
import { initializeBitmapAcceleration } from './roaringInit.js';

interface Item {
	readonly color: string;
	readonly size: number;
}

/** Six items, even = red, odd = white, size = index. */
function makeStore(): InternalStore<Item> {
	const items: Item[] = [];

	for (let i = 0; i < 6; i++) {
		items.push({ color: i % 2 === 0 ? 'red' : 'white', size: i });
	}

	return new InternalStore<Item>(items);
}

beforeAll(async () => {
	await initializeBitmapAcceleration();
});

describe('BitmapIndex.tryComputeResults', () => {
	it('answers a conjunction over the source data, equal to the predicate evaluator', () => {
		const store = makeStore();

		store.rules.value = new Map<string, FilterRule>([['red', new ValueRule('color', 'red')]]);
		store.groups.value = [{ composition: 'and', filterIds: ['red'], id: 'g' }];
		const index = new BitmapIndex(store, 'bitmap');

		expect([...(index.tryComputeResults() ?? [])]).toEqual([0, 2, 4]);
	});

	it('declines in expression mode, for a narrowed working set, and for a disjunctive group', () => {
		const store = makeStore();
		const index = new BitmapIndex(store, 'bitmap');

		store.rules.value = new Map<string, FilterRule>([
			['red', new ValueRule('color', 'red')],
			['one', new ValueRule('size', 1)],
		]);
		store.expression.value = new CompositeRule('and', []);
		expect(index.tryComputeResults()).toBeNull();

		store.expression.value = null;
		store.workingSet.value = store.sourceData.value.slice(0, 3);
		expect(index.tryComputeResults()).toBeNull();

		store.workingSet.value = store.sourceData.value;
		store.groups.value = [{ composition: 'or', filterIds: ['red', 'one'], id: 'g' }];
		expect(index.tryComputeResults()).toBeNull();
	});

	it('declines when bitmaps are not engaged', () => {
		expect(new BitmapIndex(makeStore(), 'predicate').tryComputeResults()).toBeNull();
	});
});

describe('BitmapIndex.simulateIntersection — exactness declines', () => {
	it('declines for a narrowed working set', () => {
		const store = makeStore();

		store.workingSet.value = store.sourceData.value.slice(0, 2);

		expect(new BitmapIndex(store, 'bitmap').simulateIntersection({ withRule: ['r', new ValueRule('size', 1)]})).toBeNull();
	});

	it('declines when the hypothetical rule joins an "or" group with a registered rule', () => {
		const store = makeStore();
		const index = new BitmapIndex(store, 'bitmap');

		store.rules.value = new Map<string, FilterRule>([['red', new ValueRule('color', 'red')]]);
		store.groups.value = [{ composition: 'or', filterIds: ['red', 'one'], id: 'g' }];

		expect(index.simulateIntersection({ withRule: ['one', new ValueRule('size', 1)]})).toBeNull();
		expect(index.simulateIntersection({ withRule: ['other', new ValueRule('size', 2)]})).toEqual([{ color: 'red', size: 2 }]);
	});
});

describe('BitmapIndex.buildEphemeralBitmap', () => {
	it('builds an uncached bitmap for any rule', () => {
		const index = new BitmapIndex(makeStore(), 'bitmap');
		const bitmap = index.buildEphemeralBitmap(new ValueRule('color', 'white'));

		expect(bitmap.toArray()).toEqual([1, 3, 5]);
		expect(index.cachedBitmapCount).toBe(0);
	});
});
