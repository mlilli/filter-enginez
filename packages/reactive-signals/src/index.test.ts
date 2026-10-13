/**
 * Live-binding test for the `@filter-enginez/reactive-signals` barrel.
 *
 * @remarks
 * Asserts the package's runtime exports (`createSignalsEngine`, `createEngineBusyTracker`)
 * resolve to functions through the barrel re-exports.
 */

import { describe, expect, it } from 'vitest';

import { createEngineBusyTracker, createSignalsEngine } from './index.js';

describe('@filter-enginez/reactive-signals barrel', () => {
	it('re-exports createSignalsEngine as a function', () => {
		expect(typeof createSignalsEngine).toBe('function');
	});

	it('re-exports createEngineBusyTracker as a function', () => {
		expect(typeof createEngineBusyTracker).toBe('function');
	});
});
