/**
 * Roaring-wasm initialization adapter.
 *
 * @remarks
 * `@filter-enginez/core` uses Roaring Bitmaps for filter intersection acceleration. The
 * underlying library is **`roaring-wasm`** — the WebAssembly port of CRoaring by the same
 * maintainer as the Node-native `roaring` package, but built to work in **both** browser and
 * Node (and Deno, and Cloudflare Workers). This module is the single seam between
 * `BitmapIndex` and the library:
 *
 *   - Ships `initializeBitmapAcceleration()` — idempotent async init. It loads the library with
 *     a dynamic `import('roaring-wasm')`, then waits for its WASM module to instantiate. In Node
 *     both steps are essentially immediate; in the browser the first fetches the library's chunk
 *     and the second compiles the WebAssembly.
 *   - Ships `isBitmapAccelerationReady()` — sync probe so call sites can branch ("use
 *     bitmap path" vs "fall back to predicate") without await.
 *   - Ships `getRoaringBitmap32()` — the `RoaringBitmap32` constructor of the library that init
 *     loaded — and `createRoaringBitmap()`, an empty bitmap built with it, which is how
 *     `BitmapIndex` and `TextInvertedIndex` build every bitmap.
 *
 * **Loaded on demand.** This module is the only one in core that names `roaring-wasm`, and it does
 * so through `import()` inside `initializeBitmapAcceleration()` and `import type` everywhere else.
 * The library (about 259 kB minified, most of it inline WebAssembly) is therefore never part of an
 * app's static module graph: a bundler that splits code puts it in a chunk that is fetched only
 * when init runs, so an app that never enables bitmaps never downloads it. A bundler that does
 * not split code inlines the chunk, which costs bytes but not behavior.
 * `tests/tooling/lazyDependencies.test.ts` fails if any static import path from core's entry
 * points reaches the library.
 *
 * **Consumer responsibility.** Application code that wants bitmap acceleration MUST call
 * `await initializeBitmapAcceleration()` once at app boot, in the browser and in Node alike.
 * Engines constructed before init completes still work — they route every filter eval through
 * the predicate fallback (the `BitmapIndex` use-before-init guard declines the bitmap path).
 * Once init resolves, subsequent engine evaluations pick up the bitmap path automatically.
 *
 * **Why we went WASM-first vs the Node-native `roaring` package.** The native package is
 * Node-only — there's no browser binary. Shipping a browser-only stub plus a Node-only
 * binding would mean every consumer wires their own bundler alias, which is unacceptable
 * for an OSS library that advertises itself as isomorphic. `roaring-wasm` works
 * everywhere with one binary (the WASM module), at a small performance cost vs the native
 * binding that's irrelevant at any realistic dataset size.
 *
 * @packageDocumentation
 */

import type * as RoaringWasm from 'roaring-wasm';
import type { RoaringBitmap32 } from 'roaring-wasm';

import { FilterEngineError, FilterEngineModeError } from '../errors/index.js';

/**
 * The `roaring-wasm` module namespace, as the dynamic import resolves it.
 *
 * @internal
 */
type RoaringLibrary = typeof RoaringWasm;

/**
 * The constructor of the library's compressed bitmap class.
 */
export type RoaringBitmap32Constructor = typeof RoaringBitmap32;

/**
 * Init state machine — four legal transitions, all linear:
 *
 *   unstarted → pending → ready
 *                       ↘ failed
 *
 * `failed` is terminal — once the library or its WASM module fails to load, we don't retry.
 * Consumers needing retry semantics can dispose of the engine entirely and restart from a
 * fresh module graph.
 *
 * @internal
 */
type InitState = 'failed' | 'pending' | 'ready' | 'unstarted';

/**
 * How each init state reads in the error a too-early bitmap request raises.
 *
 * @internal
 */
const INIT_STATE_DESCRIPTIONS: Readonly<Record<InitState, string>> = {
	failed: 'unavailable, because initializeBitmapAcceleration() failed',
	pending: 'still loading (initializeBitmapAcceleration() has not resolved yet)',
	ready: 'ready',
	unstarted: 'not initialized (initializeBitmapAcceleration() has not been called)',
};

/**
 * Singleton init state — module-level mutable so all callers across the codebase observe
 * the same initialization. This is one of the very few module-level mutable globals in
 * the codebase, justified by the singleton nature of the underlying WASM module (it lives
 * in a single linear memory shared across all callers).
 *
 * @internal
 */
let initState: InitState = 'unstarted';

/**
 * Cached init promise — every concurrent caller awaits the same promise, so we never
 * trigger duplicate library loads.
 *
 * @internal
 */
let initPromise: Promise<void> | null = null;

/**
 * The rejection the failed load produced, kept so every later call can attach it as `cause` —
 * the original fetch or compile error is the only thing that says WHY acceleration is off.
 *
 * @internal
 */
let initFailure: unknown;

/**
 * The library namespace the dynamic import resolved, set together with `initState = 'ready'`
 * and never before, so a non-`undefined` value means its WASM module is instantiated too.
 *
 * @internal
 */
let loadedLibrary: RoaringLibrary | undefined;

/**
 * Load `roaring-wasm` and wait for its WASM module to instantiate.
 *
 * @returns The library namespace, once its bitmaps are safe to construct
 * @internal
 */
async function loadRoaringLibrary(): Promise<RoaringLibrary> {
	const library = await import('roaring-wasm');

	await library.roaringLibraryInitialize();

	return library;
}

/**
 * Idempotent async initialization for roaring-wasm. Call once at app boot before
 * constructing any engine that needs bitmap acceleration.
 *
 * @returns A promise that resolves once the library is loaded and its WASM module is ready.
 *   Concurrent calls share one promise; calls after init has already completed resolve
 *   immediately.
 *
 * @example
 *   // App entry — browser
 *   import { initializeBitmapAcceleration, createFilterEngine } from '@filter-enginez/core';
 *
 *   await initializeBitmapAcceleration();
 *   const engine = createFilterEngine<Wine>({ sourceData: wines });
 *
 * @example
 *   // App entry — Node (the load is immediate here; the call is what enables bitmaps)
 *   await initializeBitmapAcceleration();
 *   const engine = createFilterEngine<Wine>({ sourceData: wines });
 */
export async function initializeBitmapAcceleration(): Promise<void> {
	if (initState === 'ready') {
		return;
	}
	if (initState === 'failed') {
		throw new FilterEngineError(
			'ACCELERATION_INIT_FAILED',
			'initializeBitmapAcceleration: a prior init attempt failed. roaring-wasm or its WASM '
			+ 'module did not load successfully. Inspect `cause` for the underlying error '
			+ '(typically a fetch error on the library chunk or the .wasm asset in the browser).',
			{ cause: initFailure },
		);
	}
	if (initState === 'pending' && initPromise) {
		return initPromise;
	}

	initState = 'pending';
	initPromise = loadRoaringLibrary().then(
		(library) => {
			loadedLibrary = library;
			initState = 'ready';
		},
		(err: unknown) => {
			initState = 'failed';
			initFailure = err;
			// Throw inside .then's reject handler so the rejection propagates to awaiters while we
			// capture the state transition above. The library's own error rides along as `cause`.
			throw new FilterEngineError(
				'ACCELERATION_INIT_FAILED',
				'initializeBitmapAcceleration: roaring-wasm or its WASM module failed to load, so bitmap '
				+ 'acceleration stays off and the engine uses its predicate path. Inspect `cause`.',
				{ cause: err },
			);
		},
	);

	return initPromise;
}

/**
 * Synchronous probe — `true` when the library and its WASM module are loaded and
 * `RoaringBitmap32` instances are safe to construct.
 *
 * @remarks
 * Call sites use this to branch between the bitmap path and the predicate fallback
 * WITHOUT having to await. The pattern looks like:
 *
 *     if (!isBitmapAccelerationReady()) {
 *       return null; // signal caller to use predicate path
 *     }
 *     const bitmap = createRoaringBitmap();
 *     // ...
 *
 * This keeps the engine's internal control flow synchronous even though the WASM
 * initialization is async.
 *
 * @returns `true` if `RoaringBitmap32` instances can be safely constructed; `false`
 *   otherwise (init not started, in progress, or failed).
 */
export function isBitmapAccelerationReady(): boolean {
	return initState === 'ready';
}

/**
 * The `RoaringBitmap32` constructor of the library `initializeBitmapAcceleration()` loaded.
 *
 * @remarks
 * Every bitmap the engine builds comes from this constructor, so the library stays out of the
 * static module graph (see the module remarks). The engine reaches it only behind
 * {@link isBitmapAccelerationReady}; a direct call into `BitmapIndex` or `TextInvertedIndex`
 * before init has resolved throws instead of failing somewhere inside the library.
 *
 * @returns The constructor
 * @throws {FilterEngineModeError} `MODE_ACCELERATION_NOT_READY` when init has not resolved
 *   (not started, still pending, or failed)
 */
export function getRoaringBitmap32(): RoaringBitmap32Constructor {
	if (loadedLibrary === undefined) {
		throw new FilterEngineModeError(
			'MODE_ACCELERATION_NOT_READY',
			`A Roaring bitmap was requested, but bitmap acceleration is ${INIT_STATE_DESCRIPTIONS[initState]}. `
			+ 'Await initializeBitmapAcceleration() before using BitmapIndex or TextInvertedIndex directly; '
			+ 'the engine itself checks isBitmapAccelerationReady() and uses its predicate path until then.',
		);
	}

	return loadedLibrary.RoaringBitmap32;
}

/**
 * A new, empty `RoaringBitmap32` from the library `initializeBitmapAcceleration()` loaded.
 *
 * @returns The bitmap, owned by the caller
 * @throws {FilterEngineModeError} `MODE_ACCELERATION_NOT_READY` when init has not resolved,
 *   as {@link getRoaringBitmap32} does
 */
export function createRoaringBitmap(): RoaringBitmap32 {
	const RoaringBitmap = getRoaringBitmap32();

	return new RoaringBitmap();
}
