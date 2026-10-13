/**
 * @filter-enginez/reactive-rxjs
 *
 * Public RxJS Observable facade over `@filter-enginez/core`'s `subscribe(callback)` API. Lifts
 * the engine into hot, multicast Observable streams for consumers wiring filtering into a
 * full RxJS operator graph (typical for Angular / NgRx / RxJS-heavy codebases). Isomorphic.
 *
 * @remarks
 * Exports the sync `createRxJsEngine` factory + its `RxJsEngine` return-type interface (the
 * subscribe-driven `BehaviorSubject` fan-out, `distinctUntilChanged` + `shareReplay` derived
 * streams, and memoized per-rule stream cache). Consumers (and the React binding
 * `@filter-enginez/react-rxjs`) compile against this surface.
 *
 * Shape-parallel with `@filter-enginez/reactive-signals` — same property names with `$` suffix
 * and Observable type instead of ReadonlySignal type. Consumers can swap one for the other by
 * changing the import and tweaking the `.value` / subscribe pattern.
 *
 * See `docs/architecture.md` §11.2.
 *
 * @packageDocumentation
 */

export { createEngineBusyStream, type EngineBusyStream } from './createEngineBusyStream.js';
export { createRxJsEngine, type CreateRxJsEngineOptions } from './createRxJsEngine.js';
export {
	createRxJsEngineFromAsync,
	type CreateRxJsEngineFromAsyncOptions,
} from './createRxJsEngineFromAsync.js';
export { type RxJsEngine } from './RxJsEngine.js';
