/**
 * @remarks
 * Behavior-asserting unit tests for {@link BitmapIndex}'s WASM-readiness gate — the arm of
 * `shouldUseBitmap()` that returns `false` when `isBitmapAccelerationReady()` is `false`
 * (the engine stays usable during the early page-load ticks before the consumer has awaited
 * `initializeBitmapAcceleration()`).
 *
 * This is the one scenario the main `BitmapIndex.test.ts` suite cannot reach: that suite
 * `beforeAll`-initializes the genuine WASM module process-wide, so readiness is permanently
 * `true` there. Here we mock `./roaringInit.js` so `isBitmapAccelerationReady()` returns
 * `false`, then assert that both `'bitmap'` and `'auto'` modes decline the bitmap path and
 * that `simulateIntersection` returns `null` (signalling the caller to use the predicate
 * fallback). Vitest scopes the mock to this file, so sibling suites keep the real library.
 */

import { describe, expect, it, vi } from 'vitest';

import { ValueRule } from '../rules/ValueRule.js';
import { InternalStore } from '../store/InternalStore.js';
import { BitmapIndex } from './BitmapIndex.js';

vi.mock('./roaringInit.js', () => ({
	// These tests never reach bitmap construction because the readiness gate short-circuits
	// first; a call would mean the gate let a bitmap through before init.
	createRoaringBitmap: (): never => {
		throw new Error('createRoaringBitmap reached past the readiness gate');
	},
	// Force the use-before-init guard: the WASM module is "not ready".
	isBitmapAccelerationReady: (): boolean => false,
}));

interface Item {
	readonly color: string;
}

function makeStore(count: number): InternalStore<Item> {
	const items: Item[] = [];

	for (let i = 0; i < count; i++) {
		items.push({ color: i % 2 === 0 ? 'red' : 'white' });
	}

	return new InternalStore<Item>(items);
}

describe('BitmapIndex — WASM not ready', () => {
	it('declines the bitmap path in explicit bitmap mode (readiness gate)', () => {
		const index = new BitmapIndex(makeStore(1000), 'bitmap');

		expect(index.shouldUseBitmap()).toBe(false);
		expect(index.isReady).toBe(false);
	});

	it('declines the bitmap path in auto mode even above the size threshold', () => {
		const index = new BitmapIndex(makeStore(1000), 'auto');

		expect(index.shouldUseBitmap()).toBe(false);
	});

	it('simulateIntersection returns null when not ready', () => {
		const store = makeStore(1000);

		store.rules.value = new Map([['red', new ValueRule('color', 'red')]]);
		const index = new BitmapIndex(store, 'bitmap');

		expect(index.simulateIntersection({})).toBeNull();
	});
});
