/**
 * Tests for the engine DI bindings.
 *
 * @remarks
 * **No TestBed, no zone, no DOM.** This package is pure dependency-injection plumbing — the whole
 * argument for its existence is that Angular consumes `Observable`s natively and there is no
 * reactivity to bridge. So the tests use `Injector.create` + `runInInjectionContext` directly, which
 * exercises the real Angular injector without booting a component harness. That keeps the suite in the
 * `node` Vitest project (no jsdom) and makes the tests fast and honest about what is actually wired.
 *
 * A stub stands in for `RxJsEngine`: these functions never touch the engine's members, they only carry
 * it through DI. Constructing a real engine would test `reactive-rxjs`, not this package.
 */

import type { RxJsEngine } from '@filter-enginez/reactive-rxjs';

import { inject, InjectionToken, Injector, runInInjectionContext } from '@angular/core';
import { describe, expect, it } from 'vitest';

import { FILTER_ENGINE, injectFilterEngine, provideFilterEngine, provideFilterEngineFactory } from './provideFilterEngine.js';

interface Book {
	readonly title: string;
}

/**
 * Stands in for the `ActivatedRoute` a real factory reads.
 *
 * @remarks
 * Deliberately a token OTHER than `FILTER_ENGINE` — injecting the very token the factory provides is
 * a genuine cycle, which is what the documented `inject(ActivatedRoute)` usage avoids by reading a
 * different dependency.
 */
const ROUTE_DATA = new InjectionToken<{ engine: RxJsEngine<Book> }>('test.RouteData');

/**
 * A stand-in for a booted engine.
 *
 * @remarks
 * Identity is all that matters here — every assertion checks that the SAME object comes back out of
 * DI. The cast is confined to this helper rather than sprayed across the tests.
 *
 * @param tag - Distinguishes instances when a test needs two.
 * @returns An object usable wherever an `RxJsEngine<Book>` is expected.
 */
function createStubEngine(tag: string): RxJsEngine<Book> {
	return { tag } as unknown as RxJsEngine<Book>;
}

describe('provideFilterEngine', () => {
	it('makes the engine injectable under the FILTER_ENGINE token', () => {
		const engine = createStubEngine('primary');
		const injector = Injector.create({ providers: [provideFilterEngine(engine)]});

		expect(injector.get(FILTER_ENGINE)).toBe(engine);
	});

	it('returns the engine through injectFilterEngine inside an injection context', () => {
		const engine = createStubEngine('primary');
		const injector = Injector.create({ providers: [provideFilterEngine(engine)]});

		const injected = runInInjectionContext(injector, () => injectFilterEngine<Book>());

		expect(injected).toBe(engine);
	});

	it('lets a child injector override the engine — the route-scoped republish pattern', () => {
		// An app may boot the engine in a route resolver and republish it into component-scoped DI.
		// If a child provider did not win, every route would see the root engine instead of its own.
		const rootEngine = createStubEngine('root');
		const routeEngine = createStubEngine('route');
		const root = Injector.create({ providers: [provideFilterEngine(rootEngine)]});
		const child = Injector.create({ parent: root, providers: [provideFilterEngine(routeEngine)]});

		expect(child.get(FILTER_ENGINE)).toBe(routeEngine);
		expect(root.get(FILTER_ENGINE)).toBe(rootEngine);
	});
});

describe('provideFilterEngineFactory', () => {
	it('resolves the engine from the factory', () => {
		const engine = createStubEngine('from-factory');
		const injector = Injector.create({ providers: [provideFilterEngineFactory(() => engine)]});

		expect(injector.get(FILTER_ENGINE)).toBe(engine);
	});

	it('does not call the factory until the token is first requested', () => {
		// The reason this overload exists: the engine is not in hand when the providers array is
		// written. An eagerly-invoked factory would defeat the entire purpose.
		let callCount = 0;
		const engine = createStubEngine('lazy');
		const injector = Injector.create({
			providers: [
				provideFilterEngineFactory(() => {
					callCount += 1;

					return engine;
				}),
			],
		});

		expect(callCount).toBe(0);

		injector.get(FILTER_ENGINE);

		expect(callCount).toBe(1);
	});

	it('calls the factory once per injector and caches the result', () => {
		let callCount = 0;
		const engine = createStubEngine('cached');
		const injector = Injector.create({
			providers: [
				provideFilterEngineFactory(() => {
					callCount += 1;

					return engine;
				}),
			],
		});

		injector.get(FILTER_ENGINE);
		injector.get(FILTER_ENGINE);

		expect(callCount).toBe(1);
	});

	it('runs the factory inside an injection context so it may call inject()', () => {
		// This is the whole point of the factory overload — the documented usage is
		// `provideFilterEngineFactory(() => inject(ActivatedRoute).snapshot.data['books'].engine)`.
		// If the factory did not run in an injection context, that `inject()` would throw NG0203.
		//
		// The injected dependency must be a DIFFERENT token: injecting FILTER_ENGINE from inside the
		// factory that provides FILTER_ENGINE is a real cyclic dependency, and Angular correctly says
		// so. ROUTE_DATA stands in for the ActivatedRoute the real call site reads.
		const routeEngine = createStubEngine('from-route-data');
		const injector = Injector.create({
			providers: [
				{ provide: ROUTE_DATA, useValue: { engine: routeEngine }},
				provideFilterEngineFactory(() => inject(ROUTE_DATA).engine),
			],
		});

		expect(injector.get(FILTER_ENGINE)).toBe(routeEngine);
	});
});

describe('injectFilterEngine', () => {
	it('throws outside an injection context', () => {
		// Guards the documented precondition. Angular raises NG0203 here; asserting it throws (rather
		// than matching the message) keeps the test from breaking on Angular's error-text changes.
		expect(() => injectFilterEngine<Book>()).toThrow();
	});

	it('throws when no engine was provided', () => {
		const empty = Injector.create({ providers: []});

		expect(() => runInInjectionContext(empty, () => injectFilterEngine<Book>())).toThrow();
	});
});
