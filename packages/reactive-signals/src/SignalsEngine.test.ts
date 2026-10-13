/**
 * Compile-shape test for the `SignalsEngine<T>` type.
 *
 * @remarks
 * `SignalsEngine` is a type-only interface — it emits no runtime code, so there is nothing to
 * cover at runtime (0/0 coverage is expected). This test exists to assert the type stays
 * structurally satisfiable by the factory's return value, catching accidental shape drift at
 * type-check time.
 */

import { createFilterEngine } from '@filter-enginez/core';
import { describe, expect, it } from 'vitest';

import type { SignalsEngine } from './SignalsEngine.js';

import { createSignalsEngine } from './createSignalsEngine.js';

interface Item {
	readonly price: number;
}

describe('SignalsEngine (type shape)', () => {
	it('is satisfied by the createSignalsEngine return value', () => {
		const core = createFilterEngine<Item>({ sourceData: [{ price: 1 }]});
		const engine: SignalsEngine<Item> = createSignalsEngine(core);

		expect(typeof engine.dispose).toBe('function');
		expect(typeof engine.rule).toBe('function');
		expect(engine.isDisposed).toBe(false);
		engine.dispose();
	});
});
