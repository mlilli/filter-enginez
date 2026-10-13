/**
 * @filter-enginez/worker-bridge
 *
 * Opt-in Web Worker offload via Comlink. Auto-engages above a configurable data-size
 * threshold (50,000 items by default — a reasoned estimate; pass a numeric policy to use a
 * threshold measured on your own data). Heavy operations (filter evaluation, bitmap index
 * builds) run on the worker; the main thread reads mirrored state. Browser-only.
 *
 * @remarks
 * The surface:
 *
 *   - `wrapInWorker(options)` — main-thread spawn + Comlink-wrap, returns `FilterEngineAsync`
 *   - `exposeFilterEngineWorker(factories)` — worker-side factory registration
 *   - `shouldEngageWorker(length, policy)` — auto-engagement decision function
 *   - `unsupportedOnWorker(...)` — the `MODE_WORKER_UNSUPPORTED` error the async adapters' shims throw
 *   - `FilterEngineAsync<T>` / `WorkerHostedEngine<T>` / `WorkerEngineFactory<T>` /
 *     `WorkerEngineFactories<ItemTypes>` — the types
 *
 * See `docs/architecture.md` §15.
 *
 * @packageDocumentation
 */

export {
	type FilterEngineAsync,
	type WireActionLogEntry,
	type WireDevtoolsState,
} from './FilterEngineAsync.js';

// The main-thread `engine.core.devtools` surface, shared by both async reactive adapters.
// Lives here because `wireFormat.ts` already owns the outbound half of the same wire contract
// (see `createAsyncDevtoolsShim.ts` for why the alternatives lose).
export {
	type AsyncActionLogView,
	type AsyncDevtoolsShim,
	type AsyncDevtoolsShimContext,
	createAsyncDevtoolsShim,
} from './createAsyncDevtoolsShim.js';

export { createWireRehydrator, type WireRehydrator } from './createWireRehydrator.js';

// The error both async adapters' `engine.core` shims throw for a member with no main-thread mirror.
export { unsupportedOnWorker } from './unsupportedOnWorker.js';

export { exposeFilterEngineWorker } from './exposeFilterEngineWorker.js';

export {
	type WorkerEngineFactories,
	type WorkerEngineFactory,
	type WorkerEngineInitConfig,
	type WorkerHostedEngine,
} from './WorkerHostedEngine.js';

export {
	type WorkerLike,
	wrapInWorker,
	type WrapInWorkerOptions,
} from './wrapInWorker.js';

export {
	DEFAULT_AUTO_THRESHOLD,
	shouldEngageWorker,
	type WorkerEngagementPolicy,
} from './autoEngagement.js';

// Re-export Comlink's `proxy` helper so consumers (notably the reactive-signals /
// reactive-rxjs async adapters that wrap a `FilterEngineAsync.subscribe(listener)` call)
// can wrap their main-thread listener in a postMessage-safe proxy without taking a direct
// dep on `comlink`. The re-export keeps the dependency graph clean — `comlink` lives only
// here in worker-bridge, the package that actually wires the worker tooling.
//
// Named re-export (not `import comlink from 'comlink'; export const proxy = comlink.proxy`)
// because comlink 4.4+ is pure-ESM with named exports only — no synthetic default. Vite +
// Rolldown's strict ESM bundling refuses the default-import form.
//
// `transfer` is re-exported for the same reason — advanced consumers that produce a
// transferable (e.g., an `ArrayBuffer`-backed payload to ship back from a custom worker
// factory) can mark it without a direct `comlink` dep. The `WorkerHostedEngine` router
// already uses `transfer` internally for its `getResultIndices()` zero-copy path.
export { proxy, transfer } from 'comlink';
