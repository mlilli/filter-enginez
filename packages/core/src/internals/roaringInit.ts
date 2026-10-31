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
 * **An optional peer dependency.** `roaring-wasm` is declared in core's `peerDependencies` and
 * marked optional in `peerDependenciesMeta`, so installing core does not install it. An app that
 * enables bitmap acceleration installs it alongside core (`npm install roaring-wasm`); an app that
 * never does installs nothing extra. When it is absent, `initializeBitmapAcceleration()` rejects
 * with a `FilterEngineModeError` whose code is `MODE_ACCELERATION_PEER_MISSING` and whose message
 * is the install command. Every other load failure keeps `ACCELERATION_INIT_FAILED`.
 *
 * **Loaded on demand.** This module is the only one in core that names `roaring-wasm`, and it does
 * so only through `import()` inside `initializeBitmapAcceleration()`; the bitmap types the engine
 * uses are declared in `./roaringBitmap.ts`, so core's published declarations never name the
 * library and type-check in an app that does not install it. The library (about 259 kB minified, most of it inline WebAssembly) is therefore never part of an
 * app's static module graph: a bundler that splits code puts it in a chunk that is fetched only
 * when init runs, so an app that never enables bitmaps never downloads it. A bundler that does
 * not split code inlines the chunk, which costs bytes but not behavior.
 * `tests/tooling/lazyDependencies.test.ts` fails if any static import path from core's entry
 * points reaches the library, or if it stops being an optional peer.
 *
 * **Consumer responsibility.** Application code that wants bitmap acceleration MUST install
 * `roaring-wasm` and call `await initializeBitmapAcceleration()` once at app boot, in the browser
 * and in Node alike. Nothing in the engine calls it implicitly: `acceleration.bitmap: 'on'` and
 * `'auto'` select the bitmap path only once init has resolved. Engines constructed before init
 * completes, or after it failed, still work — they route every filter eval through the predicate
 * fallback (the `BitmapIndex` use-before-init guard declines the bitmap path). Once init resolves,
 * subsequent engine evaluations pick up the bitmap path automatically.
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

import type { RoaringBitmap32, RoaringBitmap32Constructor, RoaringLibrary } from './roaringBitmap.js';

import { FilterEngineError, FilterEngineModeError } from '../errors/index.js';

export type { RoaringBitmap32, RoaringBitmap32Constructor } from './roaringBitmap.js';

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
 * The package name of the optional peer dependency, as module-resolution errors spell it.
 *
 * @internal
 */
const ROARING_PACKAGE_NAME = 'roaring-wasm';

/**
 * What `initializeBitmapAcceleration()` says when `roaring-wasm` is not installed: the one thing
 * to do about it.
 *
 * @internal
 */
const ROARING_PEER_MISSING_MESSAGE = 'Bitmap acceleration needs the optional peer dependency `roaring-wasm`; install it '
	+ 'with `npm install roaring-wasm` (or your package manager\'s equivalent).';

/**
 * The `code` values runtimes and bundlers give a module that could not be found: Node's ES module
 * loader and Bun (`ERR_MODULE_NOT_FOUND`), and Node's `require`, webpack's runtime and Vitest
 * (`MODULE_NOT_FOUND`).
 *
 * @internal
 */
const MODULE_NOT_FOUND_CODES: ReadonlySet<unknown> = new Set(['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND']);

/**
 * The messages of a module-not-found error from the runtimes that set no `code`: Chromium
 * ("Failed to resolve module specifier"), Firefox ("was a bare specifier, but was not remapped"),
 * WebKit ("does not resolve to a valid URL"), Vite's development server ("Could not resolve …
 * Is it installed?"), resolvers that say "Module not found", and the "Cannot find module / package"
 * wording Node, Bun and webpack share.
 *
 * @remarks
 * A failed chunk FETCH ("Failed to fetch dynamically imported module: …/roaring-wasm-….js") is
 * deliberately not here: the library is installed and its chunk did not arrive, which is a network
 * failure, and installing the package again would not fix it.
 *
 * @internal
 */
const MODULE_NOT_FOUND_MESSAGE = /cannot find (?:module|package)|could not resolve|failed to resolve module specifier|bare specifier|does not resolve to a valid url|module not found/iu;

/**
 * How many links of an error's `cause` chain {@link isRoaringModuleMissing} reads. Wrappers such as
 * a test runner's module mocker put the runtime's own error one level down; a bound keeps a
 * self-referential chain from looping.
 *
 * @internal
 */
const MAX_CAUSE_DEPTH = 5;

/**
 * Whether a rejection of `import('roaring-wasm')` means the package is not installed.
 *
 * @remarks
 * Matches when an error in the `cause` chain names `roaring-wasm` AND either carries a
 * module-not-found `code` or reads like one (see {@link MODULE_NOT_FOUND_MESSAGE}). Requiring the
 * package name keeps an unrelated resolution failure from being reported as this one.
 *
 * @param error - What the dynamic import rejected with
 * @returns `true` when the rejection is a module-not-found error for `roaring-wasm`
 * @internal
 */
function isRoaringModuleMissing(error: unknown): boolean {
	let current = error;

	for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
		if (current === null || typeof current !== 'object') {
			return false;
		}

		const { cause, code, message } = current as { readonly cause?: unknown; readonly code?: unknown; readonly message?: unknown };
		const text = String(message);

		if (text.includes(ROARING_PACKAGE_NAME) && (MODULE_NOT_FOUND_CODES.has(code) || MODULE_NOT_FOUND_MESSAGE.test(text))) {
			return true;
		}
		current = cause;
	}

	return false;
}

/**
 * Whether a module namespace is the real library. A bundler told that an optional peer is absent
 * substitutes an empty module (Vite's production build, webpack's `resolve.alias` set to `false`),
 * so the import resolves and yields neither export.
 *
 * @param library - The namespace the dynamic import resolved
 * @returns `true` when it carries the library's initializer and bitmap class
 * @internal
 */
function isRoaringLibrary(library: Partial<RoaringLibrary>): library is RoaringLibrary {
	return typeof library.roaringLibraryInitialize === 'function' && typeof library.RoaringBitmap32 === 'function';
}

/**
 * The error `initializeBitmapAcceleration()` raises when `roaring-wasm` is not installed.
 *
 * @param cause - The resolution error, when the import produced one
 * @returns A `MODE_ACCELERATION_PEER_MISSING` mode error carrying the install command
 * @internal
 */
function peerMissingError(cause: unknown): FilterEngineModeError {
	return new FilterEngineModeError(
		'MODE_ACCELERATION_PEER_MISSING',
		ROARING_PEER_MISSING_MESSAGE,
		cause === undefined ? undefined : { cause },
	);
}

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
 * Whether the failed load failed because `roaring-wasm` is not installed, so every later call
 * repeats the install command rather than a generic "a prior init attempt failed".
 *
 * @internal
 */
let isPeerMissing = false;

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
 * @throws {FilterEngineModeError} `MODE_ACCELERATION_PEER_MISSING` when the package is not
 *   installed; any other load or instantiation failure propagates as the library raised it
 * @internal
 */
async function loadRoaringLibrary(): Promise<RoaringLibrary> {
	// Read through `unknown`, then checked at run time by `isRoaringLibrary`. The package's own
	// declarations type every member against its much wider `ReadonlyRoaringBitmap32`, which core's
	// narrow `RoaringBitmap32` is not assignable from, and a bundler may hand back an empty module.
	let namespace: unknown;

	// ⚠ The `try` is load-bearing for apps that do not install the peer, at BUILD time: esbuild and
	// webpack fail a bundle on a bare `import()` they cannot resolve, and inside a `try` block they
	// leave it for the runtime to reject instead (measured with esbuild 0.28 and webpack 5.112).
	// `tests/tooling/lazyDependencies.test.ts` fails if the import leaves the `try`.
	try {
		namespace = await import('roaring-wasm');
	} catch (error: unknown) {
		throw isRoaringModuleMissing(error) ? peerMissingError(error) : error;
	}

	const library = namespace as Partial<RoaringLibrary>;

	if (!isRoaringLibrary(library)) {
		throw peerMissingError(undefined);
	}

	await library.roaringLibraryInitialize();

	return library;
}

/**
 * Idempotent async initialization for roaring-wasm. Call once at app boot before
 * constructing any engine that needs bitmap acceleration.
 *
 * @remarks
 * `roaring-wasm` is an optional peer dependency of `@filter-enginez/core`: install it alongside
 * core (`npm install roaring-wasm`) in any app that calls this function. Nothing in the engine
 * calls it for you, and an engine that never sees it resolve filters through its predicate path
 * with identical results.
 *
 * @returns A promise that resolves once the library is loaded and its WASM module is ready.
 *   Concurrent calls share one promise; calls after init has already completed resolve
 *   immediately.
 * @throws {FilterEngineModeError} `MODE_ACCELERATION_PEER_MISSING` (as a rejection) when
 *   `roaring-wasm` is not installed; the message is the install command
 * @throws {FilterEngineError} `ACCELERATION_INIT_FAILED` (as a rejection) when the library or its
 *   WASM module fails to load for any other reason, with the original error as `cause`
 *
 * Both failures are terminal: every later call rejects the same way without retrying.
 *
 * @example
 *   // App entry — browser (after `npm install roaring-wasm`)
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
		if (isPeerMissing) {
			throw peerMissingError(initFailure);
		}
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
			// A missing peer is reported as-is, with the install command as its message; its `cause`
			// (the resolution error, if any) is what a later call carries.
			if (err instanceof FilterEngineModeError) {
				isPeerMissing = true;
				initFailure = err.cause;
				throw err;
			}
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
 *   otherwise (init not started, in progress, or failed — including because the optional
 *   `roaring-wasm` peer is not installed).
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
