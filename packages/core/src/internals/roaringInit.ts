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
 *   - Re-exports `RoaringBitmap32` so internal code imports from one stable path.
 *   - Ships `initializeBitmapAcceleration()` — idempotent async init that resolves once the
 *     WASM module has loaded + instantiated. In Node this is essentially synchronous (the
 *     library auto-initializes on first import); in the browser it kicks off the WASM
 *     fetch + compilation and resolves when ready.
 *   - Ships `isBitmapAccelerationReady()` — sync probe so call sites can branch ("use
 *     bitmap path" vs "fall back to predicate") without await.
 *
 * **Consumer responsibility.** Application code that wants bitmap acceleration in the
 * browser MUST call `await initializeBitmapAcceleration()` once at app boot, before
 * constructing any engine that needs it. Engines constructed before init completes still
 * work — they just route every filter eval through the predicate fallback (the
 * `BitmapIndex` use-before-init guard turns into a no-op). Once init resolves, subsequent
 * engine evaluations pick up the bitmap path automatically.
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

import { RoaringBitmap32, roaringLibraryInitialize } from 'roaring-wasm';

import { FilterEngineError } from '../errors/index.js';

/**
 * Init state machine — four legal transitions, all linear:
 *
 *   unstarted → pending → ready
 *                       ↘ failed
 *
 * `failed` is terminal — once the WASM load errors, we don't retry. Consumers needing
 * retry semantics can dispose of the engine entirely and restart from a fresh module
 * graph.
 *
 * @internal
 */
type InitState = 'failed' | 'pending' | 'ready' | 'unstarted';

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
 * trigger duplicate WASM loads.
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
 * Idempotent async initialization for roaring-wasm. Call once at app boot before
 * constructing any engine that needs bitmap acceleration.
 *
 * @returns A promise that resolves once the WASM module is loaded + ready. Concurrent
 *   calls share one promise; calls after init has already completed resolve immediately.
 *
 * @example
 *   // App entry — browser
 *   import { initializeBitmapAcceleration, createFilterEngine } from '@filter-enginez/core';
 *
 *   await initializeBitmapAcceleration();
 *   const engine = createFilterEngine<Wine>({ sourceData: wines });
 *
 * @example
 *   // App entry — Node (init is a no-op here, but safe to call for portability)
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
			'initializeBitmapAcceleration: a prior init attempt failed. The roaring-wasm WASM '
			+ 'module did not load successfully. Inspect `cause` for the underlying error '
			+ '(typically a fetch error on the .wasm asset in the browser).',
			{ cause: initFailure },
		);
	}
	if (initState === 'pending' && initPromise) {
		return initPromise;
	}

	initState = 'pending';
	initPromise = roaringLibraryInitialize().then(
		() => {
			initState = 'ready';
		},
		(err: unknown) => {
			initState = 'failed';
			initFailure = err;
			// Throw inside .then's reject handler so the rejection propagates to awaiters while we
			// capture the state transition above. The library's own error rides along as `cause`.
			throw new FilterEngineError(
				'ACCELERATION_INIT_FAILED',
				'initializeBitmapAcceleration: the roaring-wasm WASM module failed to load, so bitmap '
				+ 'acceleration stays off and the engine uses its predicate path. Inspect `cause`.',
				{ cause: err },
			);
		},
	);

	return initPromise;
}

/**
 * Synchronous probe — `true` when the WASM module is loaded and `RoaringBitmap32`
 * instances are safe to construct.
 *
 * @remarks
 * Call sites use this to branch between the bitmap path and the predicate fallback
 * WITHOUT having to await. The pattern looks like:
 *
 *     if (!isBitmapAccelerationReady()) {
 *       return null; // signal caller to use predicate path
 *     }
 *     const bitmap = new RoaringBitmap32();
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
 * Re-export the `RoaringBitmap32` class so internal modules import from one stable path
 * and the underlying library can be swapped without touching every BitmapIndex import site.
 */
export { RoaringBitmap32 };
