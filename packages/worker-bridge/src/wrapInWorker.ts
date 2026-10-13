/**
 * `wrapInWorker` — the main-thread factory that takes a pre-spawned Web Worker, wraps it
 * with Comlink, and returns a `FilterEngineAsync<T>` facade.
 *
 * @remarks
 * Per `docs/architecture.md` §15.1. The consumer-facing entry point. Behind the scenes:
 *
 *   1. Consumer pre-spawns the worker via their bundler's worker syntax (Vite's `?worker`
 *      import, Webpack's `worker-loader`, etc.) and passes the `Worker` instance in
 *   2. `Comlink.wrap<WorkerHostedEngine<T>>(worker)` produces the remote proxy
 *   3. `await proxy.init({ factoryName, options }, callbacks?)` constructs the engine inside
 *      the worker; any `factoryCallbacks` ride as a separate top-level argument so Comlink's
 *      proxy-marker transfer handler fires correctly
 *   4. Optional `eagerly` pre-warms (e.g., signature index build) so the first query is fast
 *   5. Returns a `FilterEngineAsync<T>` facade — the proxy with `init` removed and
 *      Comlink-specific quirks hidden behind a clean Promise-based API
 *
 * **Why consumers spawn the worker (not this function).** Bundler worker-detection is
 * static-analysis based and call-site-sensitive — Vite + Webpack 5+ + esbuild only emit a
 * separate worker chunk when they see `new Worker(new URL('./x.ts', import.meta.url), ...)`
 * (or the `?worker` query form) inline at the spawn site. If this function spawned the
 * worker from a URL parameter, the analyzer would lose the trail and the worker file would
 * be served as a regular ESM module (with HMR client injected in dev), which breaks the
 * Comlink wiring. Pushing the spawn to the consumer keeps bundler magic where it belongs.
 *
 * @packageDocumentation
 */

import {
	type ChangeListener,
	FilterEngineDestroyedError,
	FilterEngineError,
	type Unsubscribe,
} from '@filter-enginez/core';
import { proxy as comlinkProxy, releaseProxy, wrap } from 'comlink';

import type { FilterEngineAsync } from './FilterEngineAsync.js';
import type { WorkerHostedEngine } from './WorkerHostedEngine.js';

import { installErrorTransferHandler } from './errorTransfer.js';

// `console` is universally available (Node, browser, workers) but the no-DOM-lib isomorphic
// tsconfigs in transitively-compiling consumers don't declare it. Structural.
declare const console: {
	error(...args: unknown[]): void;
	info(...args: unknown[]): void;
};
/**
 * Structural shape of a browser `Worker` instance — the bits this package actually uses.
 * We declare it minimally rather than depending on DOM lib so the package's transitive
 * compiles stay isomorphic.
 *
 * @remarks
 * Exported because `WrapInWorkerOptions.worker` is consumer-supplied by design (see its docblock),
 * so anything that PASSES a spawn function around — rather than calling `wrapInWorker` directly at
 * the site where it constructs the worker — needs to name this type. A shared app boot module, for
 * example, can take the spawn as a parameter so the Vite-only `?worker` import lives in one module
 * and an Angular app can supply its own spawn.
 */
export interface WorkerLike {
	addEventListener(type: string, listener: (ev: unknown) => void): void;
	postMessage(message: unknown, transfer?: readonly unknown[]): void;
	removeEventListener(type: string, listener: (ev: unknown) => void): void;
	terminate(): void;
}

/**
 * Options for `wrapInWorker`.
 */
export interface WrapInWorkerOptions {
	/**
	 * Pre-spawned worker instance. The consumer is responsible for spawning — bundler-specific
	 * worker spawning belongs at the call site, not buried inside this library.
	 *
	 * **Why pre-spawned vs accepting a URL.** Vite, Webpack 5+, and esbuild all detect worker
	 * imports via static analysis at the `new Worker(...)` call site. Detection requires the
	 * argument to be a literal `new URL('./worker.ts', import.meta.url)` expression INLINE at
	 * the call site — passing a variable URL defeats the analysis and the worker file gets
	 * served as a regular ESM module (with HMR client injected, no separate worker chunk),
	 * which breaks Comlink wiring. The recommended consumer pattern with Vite is:
	 *
	 *   import WineWorker from './wine.worker.ts?worker';
	 *   const engine = await wrapInWorker<Wine>({
	 *     worker: new WineWorker(),
	 *     factoryName: 'wineEngine',
	 *   });
	 *
	 * Or the `new URL(...)` form when the consumer wants control over the type/options:
	 *
	 *   const worker = new Worker(
	 *     new URL('./wine.worker.ts', import.meta.url),
	 *     { type: 'module' },
	 *   );
	 *   const engine = await wrapInWorker<Wine>({ worker, factoryName: 'wineEngine' });
	 *
	 * Both work; the first is preferred because Vite handles `?worker` URLs first-class.
	 */
	readonly worker: WorkerLike;

	/**
	 * Name of the factory to instantiate inside the worker — matches a key registered via
	 * `exposeFilterEngineWorker({ [factoryName]: factory })` in the worker file.
	 */
	readonly factoryName: string;

	/**
	 * Serializable options passed to the named worker-side factory. Typically the initial
	 * source data, or fetch parameters the worker uses to load data itself.
	 *
	 * **Must be structuredClone-safe.** Functions, class instances with private fields, DOM
	 * nodes, and MessagePorts all fail to clone — Comlink runs `structuredClone` on this
	 * object whole when serializing the `init` call. If you need to pass a callback (e.g.
	 * progress reporter), use `factoryCallbacks` instead, which proxies each callback
	 * across the postMessage boundary correctly.
	 */
	readonly factoryOptions?: Readonly<Record<string, unknown>>;

	/**
	 * Callbacks the worker-side factory can invoke back on the main thread. Each value is
	 * proxied via Comlink before being sent to the worker, so the worker can call them
	 * like ordinary functions and Comlink routes the call back here via postMessage.
	 *
	 * **Why this exists separately from `factoryOptions`.** Functions cannot be cloned by
	 * `structuredClone`, which Comlink uses to serialize nested values inside `factoryOptions`.
	 * Comlink's `proxy()` marker only takes effect on TOP-LEVEL arguments of a method call;
	 * a function nested inside an options object falls through to clone and explodes. The
	 * callbacks here are passed as a separate top-level argument to the worker's `init`,
	 * each wrapped in `proxy()` before transit so the proxy transfer handler fires correctly.
	 *
	 * The worker-side factory receives them as its second argument:
	 *
	 *   const factory: WorkerEngineFactory<Wine> = async (options, callbacks) => {
	 *     const onProgress = callbacks?.['onProgress'] as ((n: number) => void) | undefined;
	 *     // ...
	 *   };
	 */

	readonly factoryCallbacks?: Readonly<Record<string, (...args: any[]) => unknown>>;

	/**
	 * Optional list of method names to call immediately after `init` succeeds — useful for
	 * pre-warming caches the consumer knows they'll need (e.g., the MinHash signature index
	 * for a "more like this" panel that's always present). Each entry is a method name on the
	 * `FilterEngineAsync` interface; the wrapper calls them sequentially.
	 *
	 * Pre-warm errors are swallowed — the real consumer call will surface them if persistent.
	 * The point of pre-warming is to amortize cold-start cost, not to validate correctness.
	 */
	readonly eagerly?: readonly (keyof FilterEngineAsync<unknown>)[];

	/**
	 * Whether `engine.destroy()` should also call `worker.terminate()`. Default `true` — the
	 * common case is that destroying the engine should release the worker thread. Set to
	 * `false` only if you're managing the worker lifecycle externally (e.g., the worker hosts
	 * multiple engines and you only want to tear down one).
	 */
	readonly terminateOnDestroy?: boolean;
}

/**
 * Wrap a pre-spawned Web Worker that hosts a `FilterEngine` in an async facade.
 *
 * @typeParam T - The item type the engine operates over
 * @param options - Worker instance + factory name + factory options + callbacks + lifecycle config
 * @returns A `FilterEngineAsync<T>` proxy ready for the consumer to call against
 *
 * @example
 *   // worker.ts
 *   import { exposeFilterEngineWorker } from '@filter-enginez/worker-bridge';
 *   import { createFilterEngine } from '@filter-enginez/core';
 *
 *   exposeFilterEngineWorker({
 *     wineEngine: async (opts) => {
 *       const wines = opts['initialWines'] as Wine[];
 *       return createFilterEngine<Wine>({ sourceData: wines });
 *     },
 *   });
 *
 *   // main.ts (Vite consumer — recommended)
 *   import WineWorker from './wine.worker.ts?worker';
 *   import { wrapInWorker } from '@filter-enginez/worker-bridge';
 *
 *   const engine = await wrapInWorker<Wine>({
 *     worker: new WineWorker(),
 *     factoryName: 'wineEngine',
 *     factoryOptions: { initialWines: wines },
 *     eagerly: ['getResults'],
 *   });
 *
 *   const results = await engine.getResults();
 */
export async function wrapInWorker<T>(options: WrapInWorkerOptions): Promise<FilterEngineAsync<T>> {
	// #region docs:options-and-ready-handshake
	const {
		eagerly,
		factoryCallbacks,
		factoryName,
		factoryOptions,
		terminateOnDestroy: shouldTerminateOnDestroy = true,
		worker,
	} = options;

	// Before any message crosses: a worker-side rejection then arrives as the same
	// `FilterEngineError` subclass, with its `code` and `cause`, instead of a plain `Error`.
	installErrorTransferHandler();
	let isDestroyed = false;

	// `messageerror` fires when a postMessage payload fails to be structured-cloned at the worker
	// boundary; nothing else reports it, so it is logged.
	worker.addEventListener('messageerror', (ev: unknown) => {
		const data = (ev as { data?: unknown }).data;

		console.error('[wrapInWorker] worker messageerror event (cloning failed):', data ?? ev);
	});

	// ─── Wait for the worker-ready handshake ────────────────────────────────
	// The worker's `exposeFilterEngineWorker` posts a `{__filterEnginezWorkerReady: true}`
	// sentinel after Comlink's `expose` has wired its message listener. We MUST NOT send
	// any postMessage to the worker before this arrives — early messages get silently
	// dropped (observed under Vite `?worker` dev mode). Wait for the sentinel before
	// instantiating Comlink's wrap or calling init. A worker that fails to load or evaluate
	// fires `error` instead and never posts the sentinel, so `error` before the sentinel
	// rejects with `WORKER_LOAD_FAILED` and terminates the worker, rather than waiting forever.
	await new Promise<void>((resolve, reject) => {
		const settle = (): void => {
			worker.removeEventListener('message', readyHandler);
			worker.removeEventListener('error', loadFailureHandler);
		};
		const readyHandler = (ev: unknown): void => {
			const data: unknown = (ev as { data?: unknown }).data;

			/* v8 ignore next 4 -- defensive: the handshake filter's false branches (a non-sentinel
			   message arriving before this listener removes itself) are unreachable in-harness —
			   the ready sentinel is the only message the worker posts pre-removal. */
			if (data && typeof data === 'object' && (data as Record<string, unknown>)['__filterEnginezWorkerReady'] === true) {
				settle();
				resolve();
			}
		};
		const loadFailureHandler = (ev: unknown): void => {
			const message = (ev as { message?: unknown }).message;

			settle();
			worker.terminate();
			reject(new FilterEngineError(
				'WORKER_LOAD_FAILED',
				`wrapInWorker: the worker failed before its ready handshake${typeof message === 'string' ? ` (${message})` : ''}. `
				+ 'Check that the worker file loads and calls exposeFilterEngineWorker.',
				{ cause: ev },
			));
		};

		worker.addEventListener('message', readyHandler);
		worker.addEventListener('error', loadFailureHandler);
	});

	// After the handshake, an `error` event is an error the running worker did not catch outside any
	// call (a throw inside a call rejects that call through Comlink). Logged so it is visible.
	worker.addEventListener('error', (ev: unknown) => {
		const message = (ev as { message?: unknown }).message;

		console.error('[wrapInWorker] worker error event:', message ?? ev, ev);
	});

	// Wrap the worker endpoint as a Comlink proxy onto the `WorkerHostedEngine<T>` surface.
	// The cast bridges our structural Worker declaration to Comlink's `Endpoint` type at this
	// single edge point.

	const proxy = wrap<WorkerHostedEngine<T>>(worker);
	// #endregion docs:options-and-ready-handshake

	// Pre-process the callbacks: each one gets its own `proxy()` wrap so Comlink's transfer
	// handler fires when the callbacks object is serialized as a TOP-LEVEL init argument.
	// The wrap is per-value because `proxy()` mutates a single object/function — wrapping
	// the entire `factoryCallbacks` would only mark the OUTER object, leaving inner callbacks
	// un-proxied and the worker would receive a proxy that lets it call `.onProgress()`
	// (via Comlink's normal method-dispatch), so that approach DOES work too — but per-value
	// wrapping keeps each callback independently usable in the factory.
	let proxiedCallbacks: Record<string, unknown> | undefined;

	if (factoryCallbacks) {
		proxiedCallbacks = {};
		for (const [name, fn] of Object.entries(factoryCallbacks)) {
			proxiedCallbacks[name] = comlinkProxy(fn);
		}
		// Mark the container too so the whole object is treated as a remote proxy on the
		// worker side. Either approach (container-only OR per-value) is sufficient; doing
		// both is harmless and gives us symmetric behavior regardless of how the worker-side
		// factory chooses to invoke them.
		comlinkProxy(proxiedCallbacks);
	}

	try {
		// Initialize the engine inside the worker using the named factory. This is the single
		// guaranteed first call — every subsequent method on the facade assumes the engine exists.
		// `proxiedCallbacks` rides as a SEPARATE top-level argument so Comlink's transfer handler
		// fires on its proxy marker (it would not if we nested it inside the first arg).
		await proxy.init({
			factoryName,
			options: factoryOptions,
		}, proxiedCallbacks);
	} catch (err) {
		// Init failed — tear down the worker we just spawned so we don't leak a thread.
		// Release the Comlink proxy first to clean up its event listeners on the endpoint.
		try {
			proxy[releaseProxy]();
		} catch {
			// Best-effort cleanup — if the proxy is already in a bad state, ignore.
		}
		worker.terminate();
		throw err;
	}

	// Optional pre-warm: call each listed method once so the worker builds whatever lazy
	// indices it needs (MinHash signatures, R-tree, Mutual Exclusion Graph, etc.) before the
	// consumer's first real query. Errors are swallowed — pre-warming is opportunistic.
	if (eagerly && eagerly.length > 0) {
		for (const methodName of eagerly) {
			try {
				// Pre-warm calls target zero-arg engine methods (e.g., `getResults`,
				// `getResultIndices`). A Comlink remote exposes every property as a callable
				// proxy, so `proxy[methodName]` is always a function; invoke it with no arguments.
				// Methods that need arguments aren't valid pre-warm targets — any resulting
				// rejection is swallowed below.
				const method = proxy[methodName] as unknown as () => Promise<unknown>;

				await method.call(proxy);
			} catch {
				// Swallow pre-warm errors — the real consumer call will surface them if persistent.
			}
		}
	}

	// Build the consumer-facing facade. Every `FilterEngineAsync<T>` method delegates to the
	// Comlink proxy. `init` is intentionally omitted — consumers must not call it (we just did,
	// and the worker-side guard throws on a second call). `subscribe` wraps the listener in
	// `Comlink.proxy(...)` so the worker can invoke it across the boundary. `destroy` wraps to
	// also terminate the worker when configured.
	const facade: FilterEngineAsync<T> = {
		// ─── Groups ────────────────────────────────────────────────────────
		addGroup: async (group) => proxy.addGroup(group),
		// ─── Rules ─────────────────────────────────────────────────────────
		addRule: async (ruleId, rule) => proxy.addRule(ruleId, rule),
		// `applyFiltersAndQuery` — the single-round-trip bundle method. Comlink handles the
		// transferable unwrap automatically; we get back a FilterBundle whose typed arrays
		// are now owned by the main thread (worker can no longer read them, but it doesn't
		// need to — they're fresh copies it allocated specifically to ship).
		applyFiltersAndQuery: async (query) => proxy.applyFiltersAndQuery(query),
		clearRules: async () => proxy.clearRules(),

		/**
		 * Tear down the engine. Awaits `proxy.destroy()` so the worker-side engine can release
		 * its caches, then releases the Comlink proxy (cleans up its endpoint listeners), then
		 * optionally terminates the worker thread itself when `terminateOnDestroy` is true (the
		 * default). The `finally` block ensures cleanup runs even if `destroy()` throws.
		 */
		async destroy(): Promise<void> {
			// Idempotent, like the core's `destroy()`: the proxy is already released on a second call.
			if (isDestroyed) {
				return;
			}
			isDestroyed = true;
			try {
				await proxy.destroy();
			} finally {
				try {
					proxy[releaseProxy]();
				} catch {
					// Best-effort proxy cleanup.
				}
				if (shouldTerminateOnDestroy) {
					worker.terminate();
				}
			}
		},
		exportConfig: async () => proxy.exportConfig(),
		// ─── Devtools (action log + time-travel across the worker boundary) ─
		// Thin pass-throughs to the Comlink proxy. Wire-safe types live in
		// `FilterEngineAsync.ts`; the worker-side router uses the `Devtools` instance on the
		// underlying engine. Casts here unwrap Comlink's MessageChannel-flavored return
		// types into the declared FilterEngineAsync method shapes.
		getActionLogSnapshot: async () => proxy.getActionLogSnapshot(),
		getActiveRuleIds: async () => proxy.getActiveRuleIds(),
		getDevtoolsState: async () => proxy.getDevtoolsState(),

		getExpression: async () => proxy.getExpression(),
		// `getFilteredFieldValuesExcept` round-trips the Float64Array as a postMessage TRANSFER.
		// Same pattern as `getResultIndices`: the worker-side router allocates a fresh buffer
		// and marks it transferable; Comlink on this side unwraps the envelope and gives us a
		// normal Float64Array whose buffer is now ours. Zero-copy regardless of payload size.
		getFilteredFieldValuesExcept: async (excludeRuleId, fieldKey) =>
			proxy.getFilteredFieldValuesExcept(excludeRuleId, fieldKey),

		getGroups: async () => proxy.getGroups(),
		getResultCount: async () => proxy.getResultCount(),
		// `getResultIndices` round-trips the Uint32Array as a postMessage TRANSFER, not a copy.
		// The worker-side router (`WorkerHostedEngine`) allocates a fresh buffer and marks it
		// transferable via `Comlink.transfer`; Comlink on this side unwraps the transfer
		// envelope and gives us back a normal Uint32Array whose buffer is now ours. The
		// physical bytes never get cloned across the thread boundary — constant-time hand-off
		// regardless of corpus size.
		getResultIndices: async () => proxy.getResultIndices(),

		// ─── Results ───────────────────────────────────────────────────────
		getResults: async () => proxy.getResults(),
		getRule: async (ruleId) => proxy.getRule(ruleId),
		getRules: async () => proxy.getRules(),
		getSourceData: async () => proxy.getSourceData(),
		jumpToDevtoolsIndex: async (index) => proxy.jumpToDevtoolsIndex(index),
		// ─── JSON config ───────────────────────────────────────────────────
		loadConfig: async (config) => proxy.loadConfig(config),

		redoDevtools: async () => proxy.redoDevtools(),

		removeGroup: async (groupId) => proxy.removeGroup(groupId),

		removeRule: async (ruleId) => proxy.removeRule(ruleId),

		// ─── Lifecycle ─────────────────────────────────────────────────────
		reset: async () => proxy.reset(),
		resetWorkingSet: async () => proxy.resetWorkingSet(),

		// ─── Expression ────────────────────────────────────────────────────
		setExpression: async (expression) => proxy.setExpression(expression),

		// ─── Source data + working set ─────────────────────────────────────
		setSourceData: async (items) => proxy.setSourceData(items),
		setWorkingSet: async (items) => proxy.setWorkingSet(items),
		// ─── Simulation ────────────────────────────────────────────────────
		simulate: async (modification) => proxy.simulate(modification),
		/**
		 * Subscribe to engine change events from the worker.
		 *
		 * The listener is wrapped in `Comlink.proxy(...)` so the worker can postMessage back
		 * across the boundary and invoke the consumer's function. The returned unsubscribe is
		 * itself a Comlink-proxied function — calling it from the main thread round-trips back
		 * to the worker to actually remove the listener from the engine. We wrap that in a
		 * synchronous fire-and-forget shim so the returned `Unsubscribe` matches the core's
		 * synchronous `() => void` contract; consumers who need to await teardown can use
		 * `engine.destroy()` instead.
		 */
		async subscribe(listener: ChangeListener): Promise<Unsubscribe> {
			const wrappedListener = comlinkProxy(listener);
			const remoteUnsubscribe = await proxy.subscribe(wrappedListener);

			return (): void => {
				// Fire-and-forget — the round-trip removes the listener on the worker side.

				void (remoteUnsubscribe as unknown as () => Promise<void>)();
			};
		},
		undoDevtools: async () => proxy.undoDevtools(),
	};

	return Object.freeze(rejectCallsAfterDestroy(facade, () => isDestroyed));
}

/**
 * Wrap every facade method except `destroy` so it rejects with `FilterEngineDestroyedError` once
 * the facade is destroyed.
 *
 * @remarks
 * Without this a call after `destroy()` reaches a released Comlink proxy (a generic "Proxy has been
 * released" error) or, worse, a terminated worker that never answers — a promise that hangs
 * forever. The guard answers immediately with the same error class a destroyed core engine throws.
 *
 * @param facade - The fully built facade
 * @param isDestroyed - Reads the facade's destroyed flag at call time
 * @returns A new facade with the guarded methods
 */
function rejectCallsAfterDestroy<T>(facade: FilterEngineAsync<T>, isDestroyed: () => boolean): FilterEngineAsync<T> {
	const guarded: Record<string, unknown> = {};

	for (const [methodName, method] of Object.entries(facade) as [string, (...args: unknown[]) => Promise<unknown>][]) {
		guarded[methodName] = methodName === 'destroy'
			? method
			: async (...args: unknown[]): Promise<unknown> => {
				if (isDestroyed()) {
					throw new FilterEngineDestroyedError(
						'ENGINE_DESTROYED',
						`wrapInWorker: ${methodName}() was called after destroy(). The worker-backed engine has `
						+ `released its worker connection; create a new one instead of reusing this one.`,
					);
				}

				return method(...args);
			};
	}

	return guarded as unknown as FilterEngineAsync<T>;
}
