/**
 * @filter-enginez/reactive-signals
 *
 * Public signals facade over `@filter-enginez/core`'s `subscribe(callback)` API. Wraps the
 * engine into `@preact/signals-core` signals for fine-grained reactive consumption. Isomorphic.
 *
 * @remarks
 * Exports the sync `createSignalsEngine` factory + its `SignalsEngine` return-type interface
 * (the subscribe-driven mirror loop and memoized per-rule signal cache), plus the
 * framework-neutral `createEngineBusyTracker`. Consumers (and the React binding
 * `@filter-enginez/react-signals`) compile against this surface.
 *
 * See `docs/architecture.md` §11.1.
 *
 * @packageDocumentation
 */

export { createSignalsEngine, type CreateSignalsEngineOptions } from './createSignalsEngine.js';
export { type SignalsEngine } from './SignalsEngine.js';
export { createEngineBusyTracker, type EngineBusyTracker } from './createEngineBusyTracker.js';
// `createSignalsEngineFromAsync` is the browser-only async adapter — it imports
// `comlink` (postMessage-based) and is reachable only via the `./worker` sub-export
// to preserve the main barrel's isomorphic guarantee.
