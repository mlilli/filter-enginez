/**
 * Tests for the `./worker` sub-export barrel.
 *
 * @remarks
 * The barrel re-exports `createRxJsEngineFromAsync` (plus its option type, which is type-only
 * and erased at runtime). This asserts the value re-export is a live function binding identical
 * to the source module — the same live-binding contract the other package barrels are tested
 * against. Coverage on a pure re-export barrel is nominally 0/0; the assertion exists to catch
 * an accidental rename / dropped export.
 */

import { describe, expect, it } from 'vitest';

import { createRxJsEngineFromAsync } from './createRxJsEngineFromAsync.js';
import * as workerBarrel from './worker.js';

describe('reactive-rxjs/worker barrel', () => {
	it('re-exports createRxJsEngineFromAsync as the same live binding', () => {
		expect(typeof workerBarrel.createRxJsEngineFromAsync).toBe('function');
		expect(workerBarrel.createRxJsEngineFromAsync).toBe(createRxJsEngineFromAsync);
	});
});
