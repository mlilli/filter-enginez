/**
 * `bootSignalsEngine` — size-aware boot for a {@link SignalsEngine}: spawn the engine in a Web
 * Worker for large datasets, build it on the main thread for small ones.
 *
 * @remarks
 * The size-based decision `createSignalsEngineFromAsync` documents ("auto-engaged above ~Nk items
 * per the worker-bridge policy"), wired at the boot site as a first-class, framework-neutral
 * library helper any consumer can use:
 *
 *   - `size > threshold` → **worker path**: the caller's `spawnAsyncEngine` produces a
 *     `FilterEngineAsync<T>` (typically `wrapInWorker(new Worker(...))`), which this wraps via
 *     `createSignalsEngineFromAsync`.
 *   - `size <= threshold` → **main-thread path**: the caller's `createMainEngine` produces a sync
 *     `FilterEngine<T>` (typically `createFilterEngine({ ...config, sourceData })`), which this
 *     wraps via `createSignalsEngine`.
 *
 * **Why the caller injects both factories.** Keeping the worker spawn (`worker-bridge` + the
 * bundler's worker-asset mechanism, e.g. Vite `?worker`) and the data load on the caller's side
 * means this helper imports neither — so it stays free of bundler specifics, and the package's
 * isomorphic boundary is untouched. This module lives behind the `./worker` sub-export only
 * because it references the browser-only `createSignalsEngineFromAsync` adapter.
 *
 * The result carries `mode` so callers (and tests) can assert which path actually ran.
 *
 * @packageDocumentation
 */

import type { FilterEngine } from '@filter-enginez/core';
import type { FilterEngineAsync } from '@filter-enginez/worker-bridge';

import type { SignalsEngine } from './SignalsEngine.js';

import { createSignalsEngine, type CreateSignalsEngineOptions } from './createSignalsEngine.js';
import {
	createSignalsEngineFromAsync,
	type CreateSignalsEngineFromAsyncOptions,
} from './createSignalsEngineFromAsync.js';

/**
 * Options for {@link bootSignalsEngine}.
 *
 * @typeParam T - The item type the engine operates over.
 */
export interface BootSignalsEngineOptions<T> {
	/**
	 * The number of records the engine will hold — drives the worker-vs-main decision. Use a
	 * nominal per-tier count (you don't need an exact load-time count).
	 */
	readonly size: number;
	/**
	 * Records ABOVE this count boot in a worker; this count or fewer boot on the main thread.
	 */
	readonly threshold: number;
	/**
	 * Worker path factory — produce the Comlink-wrapped async engine. Only invoked when
	 * `size > threshold`. Typically `() => wrapInWorker({ worker: new MyWorker(), ... })`.
	 */
	readonly spawnAsyncEngine: () => Promise<FilterEngineAsync<T>>;
	/**
	 * Main-thread path factory — produce the sync core engine. Only invoked when
	 * `size <= threshold`. Typically `async () => createFilterEngine({ sourceData })`.
	 */
	readonly createMainEngine: () => FilterEngine<T> | Promise<FilterEngine<T>>;
	/** Options forwarded to `createSignalsEngine` on the main-thread path. */
	readonly signalsOptions?: CreateSignalsEngineOptions;
	/** Options forwarded to `createSignalsEngineFromAsync` on the worker path. */
	readonly fromAsyncOptions?: CreateSignalsEngineFromAsyncOptions;
}

/**
 * Result of {@link bootSignalsEngine}: the engine + which path produced it.
 *
 * @typeParam T - The item type the engine operates over.
 */
export interface BootSignalsEngineResult<T> {
	readonly engine: SignalsEngine<T>;
	readonly mode: 'main-thread' | 'worker';
}

/**
 * Boot a {@link SignalsEngine} on the worker or the main thread, chosen by `size` vs `threshold`.
 *
 * @example
 *   const { engine, mode } = await bootSignalsEngine<Wine>({
 *     size: WINE_FULL_COUNT,
 *     threshold: 10_000,
 *     spawnAsyncEngine: () => wrapInWorker({ worker: new WineWorker(), factoryName: 'wineEngine' }),
 *     createMainEngine: async () => createFilterEngine({ ...buildWineFilterConfig(), sourceData: await loadDefaultWines() }),
 *   });
 */
export async function bootSignalsEngine<T>(
	options: BootSignalsEngineOptions<T>,
): Promise<BootSignalsEngineResult<T>> {
	const { createMainEngine, fromAsyncOptions, signalsOptions, size, spawnAsyncEngine, threshold } = options;

	if (size > threshold) {
		const asyncEngine = await spawnAsyncEngine();
		const engine = await createSignalsEngineFromAsync<T>(asyncEngine, fromAsyncOptions);

		return { engine, mode: 'worker' };
	}

	const core = await createMainEngine();
	const engine = createSignalsEngine<T>(core, signalsOptions);

	return { engine, mode: 'main-thread' };
}
