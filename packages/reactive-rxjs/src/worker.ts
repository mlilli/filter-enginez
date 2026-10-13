/**
 * @filter-enginez/reactive-rxjs/worker — browser-only sub-export.
 *
 * @remarks
 * Hosts `createRxJsEngineFromAsync`, the adapter that wraps a `FilterEngineAsync<T>`
 * (from `@filter-enginez/worker-bridge`'s `wrapInWorker`) in an `RxJsEngine<T>` reactive
 * facade. Lives here rather than the main barrel because its runtime depends on `comlink` +
 * `postMessage` — the main `@filter-enginez/reactive-rxjs` barrel is isomorphic.
 *
 * Import path:
 *
 *   import { createRxJsEngineFromAsync } from '@filter-enginez/reactive-rxjs/worker';
 *
 * @packageDocumentation
 */

export {
	createRxJsEngineFromAsync,
	type CreateRxJsEngineFromAsyncOptions,
} from './createRxJsEngineFromAsync.js';
