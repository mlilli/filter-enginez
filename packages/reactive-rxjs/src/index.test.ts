/**
 * Live-binding test for the `@filter-enginez/reactive-rxjs` barrel.
 *
 * @remarks
 * Asserts the package's runtime export (`createRxJsEngine`) resolves to a function through the
 * barrel re-export.
 */

import { describe, expect, it } from 'vitest';

import { createRxJsEngine } from './index.js';

describe('@filter-enginez/reactive-rxjs barrel', () => {
	it('re-exports createRxJsEngine as a function', () => {
		expect(typeof createRxJsEngine).toBe('function');
	});
});
