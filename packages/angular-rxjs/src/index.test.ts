/**
 * Public-surface test for the package barrel.
 *
 * @remarks
 * The other suites import the modules directly, so without this the barrel itself is never executed —
 * it would report 0% coverage while looking fine, and a dropped re-export would break every consumer
 * without failing a single test.
 *
 * This asserts the surface EXACTLY rather than merely checking that known names are present: an
 * `toEqual` on the sorted key list also catches an accidental *addition*, which matters for a package
 * whose stated design goal is being the smallest binding in the repo. Something appearing here that
 * nobody meant to publish is exactly the drift worth catching early — every export is a compatibility
 * promise once this ships under semver.
 */

import { describe, expect, it } from 'vitest';

import * as publicApi from './index.js';

describe('public API surface', () => {
	it('exports exactly the documented DI bindings', () => {
		expect(Object.keys(publicApi).sort()).toEqual([
			'ENGINE_BUSY',
			'FILTER_ENGINE',
			'injectEngineBusy',
			'injectFilterEngine',
			'provideEngineBusy',
			'provideFilterEngine',
			'provideFilterEngineFactory',
		]);
	});

	it('exports the two tokens as usable InjectionTokens', () => {
		// A token that stringifies to its description is the observable difference between a real
		// InjectionToken and, say, a plain string or Symbol someone swapped in.
		expect(String(publicApi.FILTER_ENGINE)).toContain('filter-enginez.RxJsEngine');
		expect(String(publicApi.ENGINE_BUSY)).toContain('filter-enginez.EngineBusyStream');
	});

	it('exports the five bindings as functions', () => {
		expect(typeof publicApi.provideFilterEngine).toBe('function');
		expect(typeof publicApi.provideFilterEngineFactory).toBe('function');
		expect(typeof publicApi.injectFilterEngine).toBe('function');
		expect(typeof publicApi.provideEngineBusy).toBe('function');
		expect(typeof publicApi.injectEngineBusy).toBe('function');
	});
});
