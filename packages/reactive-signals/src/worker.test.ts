/**
 * Tests for the `./worker` sub-export barrel.
 *
 * @remarks
 * The barrel re-exports `createSignalsEngineFromAsync` + `bootSignalsEngine` (plus their option
 * types, which are type-only and erased at runtime). This asserts the value re-exports are live
 * function bindings identical to the source modules — the same live-binding contract the other
 * package barrels are tested against. Coverage on a pure re-export barrel is nominally 0/0;
 * the assertions exist to catch an accidental rename / dropped export.
 */

import { describe, expect, it } from 'vitest';

import { bootSignalsEngine } from './bootSignalsEngine.js';
import { createSignalsEngineFromAsync } from './createSignalsEngineFromAsync.js';
import * as workerBarrel from './worker.js';

describe('reactive-signals/worker barrel', () => {
	it('re-exports createSignalsEngineFromAsync as the same live binding', () => {
		expect(typeof workerBarrel.createSignalsEngineFromAsync).toBe('function');
		expect(workerBarrel.createSignalsEngineFromAsync).toBe(createSignalsEngineFromAsync);
	});

	it('re-exports bootSignalsEngine as the same live binding', () => {
		expect(typeof workerBarrel.bootSignalsEngine).toBe('function');
		expect(workerBarrel.bootSignalsEngine).toBe(bootSignalsEngine);
	});
});
