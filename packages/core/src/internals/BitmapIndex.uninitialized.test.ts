/**
 * @remarks
 * What a caller sees when it reaches the bitmap classes directly before
 * `initializeBitmapAcceleration()` has run, with the GENUINE `roaringInit` adapter (no mocks).
 *
 * `roaring-wasm` is loaded only by that init, so before it there is no `RoaringBitmap32` to build
 * with. The engine never gets here — `BitmapIndex.shouldUseBitmap()` declines until init resolves
 * (`BitmapIndex.notready.test.ts`) — but `BitmapIndex` and `TextInvertedIndex` are exported for
 * advanced use, and a direct call must fail with the engine's own error and a message that names
 * the fix, not somewhere inside the library. This file never initializes, and Vitest isolates
 * module state per test file, so readiness stays `false` here whatever the sibling suites do.
 */

import { describe, expect, it } from 'vitest';

import { FilterEngineModeError } from '../errors/index.js';
import { TextSearchRule } from '../rules/TextSearchRule.js';
import { ValueRule } from '../rules/ValueRule.js';
import { InternalStore } from '../store/InternalStore.js';
import { BitmapIndex } from './BitmapIndex.js';
import { isBitmapAccelerationReady } from './roaringInit.js';
import { TextInvertedIndex } from './TextInvertedIndex.js';

interface Item {
	readonly color: string;
	readonly note: string;
}

/**
 * A store of `count` items alternating red and white.
 *
 * @param count - How many items
 * @returns The store
 */
function makeStore(count: number): InternalStore<Item> {
	return new InternalStore<Item>(
		Array.from({ length: count }, (_, i) => ({ color: i % 2 === 0 ? 'red' : 'white', note: `item ${String(i)}` })),
	);
}

describe('bitmap classes before initializeBitmapAcceleration()', () => {
	it('starts uninitialized in this file', () => {
		expect(isBitmapAccelerationReady()).toBe(false);
	});

	it('BitmapIndex.getBitmap throws MODE_ACCELERATION_NOT_READY', () => {
		const store = makeStore(10);

		store.rules.value = new Map([['red', new ValueRule('color', 'red')]]);
		const index = new BitmapIndex(store, 'bitmap');

		expect(() => index.getBitmap('red')).toThrow(FilterEngineModeError);
		expect(() => index.getBitmap('red')).toThrow(expect.objectContaining({
			code: 'MODE_ACCELERATION_NOT_READY',
			message: expect.stringContaining('Await initializeBitmapAcceleration()') as unknown,
		}));
	});

	it('BitmapIndex.buildEphemeralBitmap throws the same error', () => {
		const index = new BitmapIndex(makeStore(10), 'bitmap');

		expect(() => index.buildEphemeralBitmap(new ValueRule('color', 'white'))).toThrow(
			expect.objectContaining({ code: 'MODE_ACCELERATION_NOT_READY' }),
		);
	});

	it('TextInvertedIndex.queryAllWords throws the same error', () => {
		const store = makeStore(10);
		const index = new TextInvertedIndex(store, (item) => item.note);

		expect(() => index.queryAllWords(['item'])).toThrow(
			expect.objectContaining({ code: 'MODE_ACCELERATION_NOT_READY' }),
		);
	});

	it('the engine path declines bitmaps instead of throwing', () => {
		const store = makeStore(1000);

		store.rules.value = new Map([['note', new TextSearchRule('note', { mode: 'allWords', query: 'item 1' })]]);
		const index = new BitmapIndex(store, 'bitmap');

		expect(index.tryComputeResults()).toBeNull();
		expect(index.simulateIntersection({})).toBeNull();
	});
});
