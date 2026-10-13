/**
 * `WorkerHostedEngine<T>` — the type the worker exposes via `Comlink.expose(...)`. The
 * "remote object" the main-thread proxy talks to.
 *
 * @remarks
 * Per `docs/architecture.md` §15.1. Almost identical to `FilterEngineAsync` (same async
 * shape), but with one extra method: `init({ factoryName, options })`. The main-thread
 * wrapper calls `init` first to construct the underlying engine inside the worker before
 * any other call can land.
 *
 * **Why a separate type from `FilterEngineAsync`.** The init step is internal — consumers
 * using the wrapped engine never call it themselves. Keeping `init` off `FilterEngineAsync`
 * means the consumer-facing type doesn't carry a method that shouldn't be called from
 * application code.
 *
 * The runtime worker-side router + `Comlink.expose` wiring lives in
 * `./exposeFilterEngineWorker.js`; this module is the type surface only.
 *
 * @packageDocumentation
 */

import type { FilterEngine } from '@filter-enginez/core';

import type { FilterEngineAsync } from './FilterEngineAsync.js';

/**
 * Configuration sent to the worker on `init` — names the factory to instantiate and any
 * factory-specific options.
 */
export interface WorkerEngineInitConfig {
	/**
	 * Identifier (registered in the worker's factory registry) for the engine factory to use.
	 * Consumers register named factories inside their worker file via `exposeFilterEngine
	 * Worker(...)`. Decouples "which engine the worker hosts" from the main-thread wiring code.
	 */
	readonly factoryName: string;

	/**
	 * Arbitrary serializable options passed to the named factory function. Typically includes
	 * initial source data (if the worker should fetch / materialize it itself, this can be
	 * omitted and the main thread will push it post-init via `setSourceData`).
	 */
	readonly options?: Readonly<Record<string, unknown>>;
}

/**
 * The full interface the worker exposes — `FilterEngineAsync` plus the internal `init` step.
 *
 * @typeParam T - The item type the engine operates over
 */
export interface WorkerHostedEngine<T> extends FilterEngineAsync<T> {
	/**
	 * Construct the engine inside the worker using the named factory. Called exactly once by
	 * the main-thread wrapper after the worker spawns; subsequent calls throw.
	 *
	 * `callbacks` (optional) is a Comlink-proxied object of callback functions the main
	 * thread wants the factory to be able to invoke during construction (e.g., a progress
	 * reporter for streaming corpus loads). Passed as a SEPARATE top-level argument so
	 * Comlink's `proxy()` marker fires correctly — see `WrapInWorkerOptions.factoryCallbacks`.
	 */
	init(
		config: WorkerEngineInitConfig,
		callbacks?: Readonly<Record<string, unknown>>,
	): Promise<void>;
}

/**
 * Worker-side engine factory — the function consumers register under a name inside their
 * worker file. Receives the factory options sent from the main thread, returns a constructed
 * `FilterEngine` (or any object structurally compatible with the engine's surface).
 *
 * Imported as `WorkerEngineFactory<T>` from `@filter-enginez/worker-bridge`; consumers
 * write their factory file like:
 *
 *   import { exposeFilterEngineWorker, type WorkerEngineFactory } from '@filter-enginez/worker-bridge';
 *   import { createFilterEngine, type FilterEngine } from '@filter-enginez/core';
 *
 *   const wineEngineFactory: WorkerEngineFactory<Wine> = async (opts) => {
 *     const wines = await fetch('/api/wines').then(r => r.json());
 *     return createFilterEngine<Wine>({ sourceData: wines });
 *   };
 *
 *   exposeFilterEngineWorker({ wineEngine: wineEngineFactory });
 *
 * Then on the main thread:
 *
 *   const engine = await wrapInWorker<Wine>({
 *     worker: new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
 *     factoryName: 'wineEngine',
 *   });
 */
export type WorkerEngineFactory<T> = (
	options: Readonly<Record<string, unknown>>,
	callbacks?: Readonly<Record<string, unknown>>,
) => FilterEngine<T> | Promise<FilterEngine<T>>;

/**
 * The factory map `exposeFilterEngineWorker` registers: each name maps to a factory for its OWN
 * item type.
 *
 * @remarks
 * Generic over the name-to-item-type record, and inferred from the argument, so a worker hosting a
 * `FilterEngine<Wine>` and a `FilterEngine<Listing>` registers both without widening either to
 * `unknown`. A single `Record<string, WorkerEngineFactory<unknown>>` would not do: the engine is
 * invariant in its item type (it both takes items in, through `setSourceData`, and hands them out,
 * through `getResults`), so a `FilterEngine<Wine>` is not a `FilterEngine<unknown>` and a typed
 * factory would be rejected at exactly the call every worker file makes.
 *
 * @typeParam ItemTypes - Factory name to the item type its engine holds.
 */
export type WorkerEngineFactories<ItemTypes extends Readonly<Record<string, unknown>>> = {
	readonly [FactoryName in keyof ItemTypes]: WorkerEngineFactory<ItemTypes[FactoryName]>;
};
