/**
 * Tests for the engine-busy DI bindings.
 *
 * @remarks
 * Mirrors `provideFilterEngine.test.ts` in approach — `Injector.create` rather than TestBed, since
 * this is DI plumbing with no reactivity to bridge. See that file's header for the full rationale.
 *
 * The tracker is stubbed: these bindings never call its members, they only carry it through DI.
 * Exercising a real `createEngineBusyStream()` would be testing `reactive-rxjs`.
 */

import type { EngineBusyStream } from '@filter-enginez/reactive-rxjs';

import { Injector, runInInjectionContext } from '@angular/core';
import { describe, expect, it } from 'vitest';

import { ENGINE_BUSY, injectEngineBusy, provideEngineBusy } from './provideEngineBusy.js';
import { FILTER_ENGINE } from './provideFilterEngine.js';

/**
 * A stand-in for the busy tracker.
 *
 * @param tag - Distinguishes instances when a test needs two.
 * @returns An object usable wherever an `EngineBusyStream` is expected.
 */
function createStubBusy(tag: string): EngineBusyStream {
	return { tag } as unknown as EngineBusyStream;
}

describe('provideEngineBusy', () => {
	it('makes the tracker injectable under the ENGINE_BUSY token', () => {
		const busy = createStubBusy('primary');
		const injector = Injector.create({ providers: [provideEngineBusy(busy)]});

		expect(injector.get(ENGINE_BUSY)).toBe(busy);
	});

	it('returns the tracker through injectEngineBusy inside an injection context', () => {
		const busy = createStubBusy('primary');
		const injector = Injector.create({ providers: [provideEngineBusy(busy)]});

		expect(runInInjectionContext(injector, () => injectEngineBusy())).toBe(busy);
	});

	it('yields the SAME instance to every consumer', () => {
		// This is the reason the tracker goes through DI at all: commit handlers across the filter panel
		// call markUserAction() and the results header reads isBusy$. Two instances would mean the
		// header silently never observes the panel's activity.
		const busy = createStubBusy('shared');
		const injector = Injector.create({ providers: [provideEngineBusy(busy)]});

		const first = runInInjectionContext(injector, () => injectEngineBusy());
		const second = runInInjectionContext(injector, () => injectEngineBusy());

		expect(first).toBe(second);
		expect(first).toBe(busy);
	});

	it('is independent of the engine token', () => {
		// Both bindings live in this package, both are provided as values, and the two files are near
		// copies of each other — so a copy-paste slip pointing provideEngineBusy at FILTER_ENGINE is a
		// live risk. That slip would leave ENGINE_BUSY unresolvable while silently overwriting the
		// engine, so the assertion has to check BOTH directions: the tracker resolves, and providing it
		// does not populate the engine token.
		const busy = createStubBusy('busy-only');
		const injector = Injector.create({ providers: [provideEngineBusy(busy)]});

		expect(injector.get(ENGINE_BUSY)).toBe(busy);
		expect(injector.get(FILTER_ENGINE, null)).toBeNull();
	});

	it('lets a child injector override the tracker', () => {
		const root = Injector.create({ providers: [provideEngineBusy(createStubBusy('root'))]});
		const scoped = createStubBusy('scoped');
		const child = Injector.create({ parent: root, providers: [provideEngineBusy(scoped)]});

		expect(child.get(ENGINE_BUSY)).toBe(scoped);
	});
});

describe('injectEngineBusy', () => {
	it('throws outside an injection context', () => {
		expect(() => injectEngineBusy()).toThrow();
	});

	it('throws when no tracker was provided', () => {
		const empty = Injector.create({ providers: []});

		expect(() => runInInjectionContext(empty, () => injectEngineBusy())).toThrow();
	});
});
