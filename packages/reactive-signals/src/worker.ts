/**
 * @filter-enginez/reactive-signals/worker — browser-only sub-export.
 *
 * @remarks
 * Hosts `createSignalsEngineFromAsync`, the adapter that wraps a `FilterEngineAsync<T>`
 * (from `@filter-enginez/worker-bridge`'s `wrapInWorker`) in a `SignalsEngine<T>` reactive
 * facade. Lives in this sub-export rather than the main `@filter-enginez/reactive-signals`
 * barrel because its runtime depends on `comlink` + the `postMessage` browser primitive —
 * the main barrel is isomorphic (Node + browser + edge runtimes) by contract.
 *
 * Import path:
 *
 *   import { createSignalsEngineFromAsync } from '@filter-enginez/reactive-signals/worker';
 *
 * See `createSignalsEngineFromAsync.ts` for full design notes (the `.core` sync shim,
 * the SWR simulate cache, the subscribe-loop wiring).
 *
 * @packageDocumentation
 */

export {
	createSignalsEngineFromAsync,
	type CreateSignalsEngineFromAsyncOptions,
} from './createSignalsEngineFromAsync.js';
export {
	bootSignalsEngine,
	type BootSignalsEngineOptions,
	type BootSignalsEngineResult,
} from './bootSignalsEngine.js';
