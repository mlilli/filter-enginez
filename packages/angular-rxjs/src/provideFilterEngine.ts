/**
 * `provideFilterEngine` — Angular DI wiring for an `RxJsEngine`.
 *
 * @remarks
 * **This package is deliberately thin, and that is the point.** The other framework bindings
 * (`vue-signals`, `svelte-signals`, `react-signals`) exist because each of those frameworks has its
 * own reactivity primitive that must be bridged to `@preact/signals-core` — a `shallowRef` here, a
 * `readable` store there, a `useSyncExternalStore` subscription in React. Angular has no such gap:
 * `@filter-enginez/reactive-rxjs` already publishes `Observable`s, which is Angular's native async
 * currency. There is nothing to bridge.
 *
 * What Angular *does* need is a way to get the engine into components — so this package supplies
 * dependency injection and stops there. No wrapper types, no re-exported streams, no `Observable` →
 * `Signal` conversion (the app decides that at each call site).
 *
 * The engine is provided as a value rather than constructed by a factory-injected service so the
 * caller owns the boot, which is asynchronous (`bootBooksCore`) and app-specific.
 *
 * @example
 * ```ts
 * // main.ts — after booting the surface-neutral core.
 * const { core } = await bootBooksCore();
 *
 * bootstrapApplication(AppComponent, {
 *   providers: [
 *     provideZonelessChangeDetection(),
 *     provideFilterEngine(createRxJsEngine(core)),
 *   ],
 * });
 * ```
 *
 * ```ts
 * // In a component — Observables all the way down.
 * private readonly engine = injectFilterEngine<Book>();
 * protected readonly resultCount$ = this.engine.resultCount$;
 * // template: {{ resultCount$ | async }}
 * ```
 *
 * @packageDocumentation
 */

import type { RxJsEngine } from '@filter-enginez/reactive-rxjs';

import { inject, InjectionToken, type Provider } from '@angular/core';

// #region docs:filter-engine-di
/**
 * DI token holding the app's `RxJsEngine`.
 *
 * @remarks
 * Typed as `RxJsEngine<unknown>` because an `InjectionToken` cannot be generic — the item type is
 * recovered at the injection site via {@link injectFilterEngine}. This is the same erasure the Vue
 * and Svelte context bindings perform for the identical reason.
 */
export const FILTER_ENGINE = new InjectionToken<RxJsEngine<unknown>>('filter-enginez.RxJsEngine');

/**
 * Provide an already-booted engine to the application injector.
 *
 * @param engine - The engine, typically `createRxJsEngine(core)` over a booted core.
 * @returns A provider to spread into `bootstrapApplication`'s `providers` (or a route's).
 */
export function provideFilterEngine<T>(engine: RxJsEngine<T>): Provider {
	return { provide: FILTER_ENGINE, useValue: engine };
}

/**
 * Provide an engine produced by a factory, resolved lazily inside an injection context.
 *
 * @remarks
 * The counterpart to {@link provideFilterEngine} for the case where the engine isn't in hand at the
 * moment the providers array is written. The motivating case is Angular's route-resolver pattern: the
 * engine boot is asynchronous, resolvers may await, and the component then republishes the resolved
 * value into component-scoped DI:
 *
 * ```ts
 * providers: [
 *   provideFilterEngineFactory(() => inject(ActivatedRoute).snapshot.data['books'].engine),
 * ]
 * ```
 *
 * The factory runs in an injection context, so it may call `inject()` — which is the entire point.
 *
 * @param factory - Produces the engine; runs once per injector, inside an injection context.
 * @returns A provider to spread into a component's or route's `providers`.
 */
export function provideFilterEngineFactory<T>(factory: () => RxJsEngine<T>): Provider {
	return { provide: FILTER_ENGINE, useFactory: factory };
}

/**
 * Inject the application's engine, re-applying the item type erased by the token.
 *
 * @remarks
 * The cast is the price of `InjectionToken`'s invariance over generics; it is safe because
 * {@link provideFilterEngine} is the only supported way to populate the token, and it accepts a
 * correctly-typed `RxJsEngine<T>`.
 *
 * Must be called from an injection context (a field initializer, constructor, or inside
 * `runInInjectionContext`).
 *
 * @returns The engine, typed to `T`.
 */
export function injectFilterEngine<T>(): RxJsEngine<T> {
	return inject(FILTER_ENGINE) as RxJsEngine<T>;
}
// #endregion docs:filter-engine-di
