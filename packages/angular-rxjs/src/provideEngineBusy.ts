/**
 * `provideEngineBusy` — Angular DI wiring for the shared engine-busy tracker.
 *
 * @remarks
 * The busy tracker is app-scoped rather than engine-scoped: commit handlers all over the filter panel
 * call `markUserAction()`, and the results header reads `isBusy$`. Passing it down as an `@Input`
 * through every intervening component would be noise, so it goes through DI like the engine itself.
 *
 * Provided as a value (not a factory) so the app controls its lifetime and can `dispose()` it.
 *
 * @example
 * ```ts
 * providers: [provideEngineBusy(createEngineBusyStream())]
 * ```
 *
 * @packageDocumentation
 */

import type { EngineBusyStream } from '@filter-enginez/reactive-rxjs';

import { inject, InjectionToken, type Provider } from '@angular/core';

/** DI token holding the app-wide engine-busy tracker. */
export const ENGINE_BUSY = new InjectionToken<EngineBusyStream>('filter-enginez.EngineBusyStream');

/**
 * Provide an engine-busy tracker to the application injector.
 *
 * @param busy - The tracker, typically `createEngineBusyStream()`.
 * @returns A provider to spread into the application's `providers`.
 */
export function provideEngineBusy(busy: EngineBusyStream): Provider {
	return { provide: ENGINE_BUSY, useValue: busy };
}

/**
 * Inject the app-wide engine-busy tracker.
 *
 * @remarks
 * Must be called from an injection context (field initializer, constructor, or
 * `runInInjectionContext`).
 *
 * @returns The tracker.
 */
export function injectEngineBusy(): EngineBusyStream {
	return inject(ENGINE_BUSY);
}
