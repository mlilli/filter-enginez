/**
 * Compile-shape test for the `RxJsEngine<T>` type.
 *
 * @remarks
 * `RxJsEngine` is a type-only interface — it emits no runtime code (0/0 coverage expected).
 * This test asserts the type stays structurally satisfiable by the factory's return value,
 * catching accidental shape drift at type-check time.
 */

import { createFilterEngine } from '@filter-enginez/core';
import { describe, expect, it } from 'vitest';

import type { RxJsEngine } from './RxJsEngine.js';

import { createRxJsEngine } from './createRxJsEngine.js';

interface Item {
	readonly price: number;
}

describe('RxJsEngine (type shape)', () => {
	it('is satisfied by the createRxJsEngine return value', () => {
		const core = createFilterEngine<Item>({ sourceData: [{ price: 1 }]});
		const engine: RxJsEngine<Item> = createRxJsEngine(core);

		expect(typeof engine.dispose).toBe('function');
		expect(typeof engine.rule$).toBe('function');
		expect(engine.isDisposed).toBe(false);
		engine.dispose();
	});
});
