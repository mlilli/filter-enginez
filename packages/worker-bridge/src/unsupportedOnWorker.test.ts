/**
 * `unsupportedOnWorker` — the shared `MODE_WORKER_UNSUPPORTED` error for the async adapters' shims.
 */

import { FilterEngineModeError } from '@filter-enginez/core';
import { describe, expect, it } from 'vitest';

import { unsupportedOnWorker } from './unsupportedOnWorker.js';

describe('unsupportedOnWorker', () => {
	it('throws a FilterEngineModeError naming the adapter and the member', () => {
		expect(() => unsupportedOnWorker('someAdapter', 'bitmapIndex')).toThrow(FilterEngineModeError);
		expect(() => unsupportedOnWorker('someAdapter', 'bitmapIndex')).toThrow(
			expect.objectContaining({ code: 'MODE_WORKER_UNSUPPORTED' }),
		);
		expect(() => unsupportedOnWorker('someAdapter', 'bitmapIndex')).toThrow(
			'someAdapter: `engine.core.bitmapIndex` is not available on worker-backed engines; it has no main-thread mirror.',
		);
	});

	it('offers every async alternative it is given', () => {
		expect(() => unsupportedOnWorker('someAdapter', 'simulate()', 'a()', 'b()')).toThrow(
			'someAdapter: `engine.core.simulate()` is not available on worker-backed engines; await `a()` or `b()` instead.',
		);
	});
});
