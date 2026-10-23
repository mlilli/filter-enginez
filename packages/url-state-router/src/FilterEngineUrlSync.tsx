/**
 * `FilterEngineUrlSync` — the React component that two-way-binds a `FilterEngine`'s state to
 * the URL query string via `react-router`'s `useLocation` + `useNavigate`.
 *
 * @remarks
 * Per `docs/architecture.md` §14. Bidirectional sync with origin-tracking to prevent the
 * obvious engine → URL → engine → URL infinite loop:
 *
 *   - **Engine → URL**: subscribe to `engine.subscribe`, debounce writes (default 150ms),
 *     `navigate({ replace: true })` so filter-state changes don't bloat the back stack.
 *   - **URL → Engine**: subscribe to `location.search`, decode the param, `engine.loadConfig
 *     (...)`. Skipped when the location is one of this component's own writes arriving, or when
 *     the parameter is the state the engine already holds (see "Own writes" below).
 *   - **Across routes (opt-in)**: with `routeChangeMode` set, when the app navigates to another
 *     pathname with a URL that lacks the parameter, the component re-attaches the current one, so
 *     the filter state is retained across routes served by the same engine.
 *
 * **History modes.** Filter state changes use `replace` by default (`historyMode`) — every
 * checkbox tick shouldn't pollute browser history. Route navigations are the app's own; the
 * optional re-attach after one uses `routeChangeMode`.
 *
 * **Own writes.** The component remembers each parameter value it navigated to until that
 * location renders, a bounded list of {@link PENDING_WRITES_REMEMBERED}. An app that navigates
 * inside a React transition can render an older write's location AFTER a newer one, so "the last
 * value written" is not enough to recognize an own write: the older value would look external, be
 * loaded, and drop the newer change. A pending value arriving through `PUSH` or `REPLACE` is that
 * late commit and is never loaded. A `POP` (Back, Forward, a reload) is always the user's, even to
 * a value this component wrote, so it loads unless the engine already holds that state.
 *
 * **Why a component, not a hook.** The implementation owns timer cleanup, subscription
 * cleanup, and a ref-based origin sentinel — all of which want a stable mount lifecycle a
 * component naturally provides. A hook would force consumers to remember to wire it inside
 * the right component lifecycle slot; the component is harder to misuse.
 *
 * @packageDocumentation
 */

import type { FilterEngine, FilterEngineConfig } from '@filter-enginez/core';

import { useEffect, useRef } from 'react';
import { NavigationType, useLocation, useNavigate, useNavigationType } from 'react-router';

import { type BuiltInSerializerName, type EngineStateSerializer, resolveSerializer } from './serializers.js';

/**
 * How many of its own parameter values the component keeps while their locations are waiting to
 * render.
 *
 * @remarks
 * A value leaves the list when its location renders, so the list holds only writes React has not
 * shown yet: with the 150 ms default debounce, two or three at most. The bound matters only when a
 * write's location never renders at all (a transition React abandoned for a newer one); sixteen
 * leaves a wide margin and keeps a long session's list small.
 */
export const PENDING_WRITES_REMEMBERED = 16;

/**
 * Remember a parameter value the component is about to navigate to, forgetting the oldest past
 * {@link PENDING_WRITES_REMEMBERED}.
 *
 * @param pending - The component's pending writes, oldest first; updated in place.
 * @param serialized - The value.
 */
function rememberWrite(pending: string[], serialized: string): void {
	pending.push(serialized);
	if (pending.length > PENDING_WRITES_REMEMBERED) {
		pending.shift();
	}
}

/**
 * Props for `FilterEngineUrlSync`.
 *
 * @typeParam T - The item type the engine operates over
 */
export interface FilterEngineUrlSyncProps<T> {
	/** The engine to two-way-bind to the URL. */
	readonly engine: FilterEngine<T>;

	/**
	 * Async config source for worker-backed engines. When provided, the engine→URL export goes
	 * through this (awaited across the worker round-trip) instead of the synchronous
	 * `engine.exportConfig()` — which throws on the worker shim. Pass a worker engine's
	 * `asyncEngine` (`undefined` for main-thread engines, in which case the synchronous path is
	 * used). `subscribe` + `loadConfig` stay on `engine`: the shim mirrors events locally and fires
	 * `loadConfig` to the worker, so only export needs the async path.
	 */
	readonly asyncConfig?: {
		exportConfig(): Promise<FilterEngineConfig>;
	};

	/** URL query-string parameter key. Defaults to `'f'` (short for "filters"). */
	readonly paramKey?: string;

	/**
	 * Serializer to use. Defaults to `'human-readable'` because shareable URLs are the most
	 * common motivation for URL state in the first place.
	 */
	readonly serializer?: BuiltInSerializerName | EngineStateSerializer;

	/**
	 * Debounce window (ms) for engine → URL writes. Defaults to 150ms — short enough to feel
	 * snappy, long enough to coalesce rapid checkbox-flicking into one history-state write.
	 * Setting to `0` writes synchronously (useful in tests).
	 */
	readonly debounceMs?: number;

	/**
	 * History mode for engine-driven URL changes. Defaults to `'replace'` so filter state
	 * doesn't accumulate browser history entries.
	 */
	readonly historyMode?: 'push' | 'replace';

	/**
	 * Retain filter state across route changes, and choose the history mode for doing it. When
	 * set, and the app navigates to a different pathname with a URL that lacks the parameter, the
	 * component adds the current one back: `'replace'` folds it into the entry the app's
	 * navigation created, so Back returns to the previous route in one step; `'push'` keeps that
	 * entry and adds a second one carrying the parameter. Unset (the default), a route change
	 * leaves the URL as the app wrote it — the right choice when different routes host different
	 * engines, since one engine's filter state means nothing to another.
	 */
	readonly routeChangeMode?: 'push' | 'replace';

	/**
	 * If `true`, errors during deserialization (malformed URL, unknown rule type, version
	 * mismatch) are reported to `onError` and the engine state is left unchanged. If `false`,
	 * errors throw — surfaces config-shape regressions in dev. Default `true`.
	 */
	readonly tolerateMalformedUrls?: boolean;

	/**
	 * Optional error callback — fires when `tolerateMalformedUrls` is `true` and a decode
	 * error happens. Useful for logging to your observability stack.
	 */
	readonly onError?: (error: Error) => void;
}

/**
 * Two-way-bind a `FilterEngine`'s state to the URL query string. Render this once anywhere
 * inside a `react-router` `<RouterProvider>` / `<BrowserRouter>`; it has no visual
 * output (returns `null`).
 *
 * @typeParam T - The item type the engine operates over
 *
 * @example
 *   function App() {
 *     return (
 *       <BrowserRouter>
 *         <FilterEngineProvider engine={signalsEngine}>
 *           <FilterEngineUrlSync
 *             engine={signalsEngine.core}
 *             paramKey="f"
 *             serializer="human-readable"
 *             debounceMs={150}
 *           />
 *           <Routes>...</Routes>
 *         </FilterEngineProvider>
 *       </BrowserRouter>
 *     );
 *   }
 */
export const FilterEngineUrlSync = <T = unknown>(props: FilterEngineUrlSyncProps<T>): null => {
	const {
		asyncConfig,
		debounceMs = 150,
		engine,
		historyMode = 'replace',
		onError,
		paramKey = 'f',
		routeChangeMode,
		serializer: serializerProp = 'human-readable',
		tolerateMalformedUrls: shouldTolerateMalformedUrls = true,
	} = props;

	const location = useLocation();
	const navigationType = useNavigationType();
	const navigate = useNavigate();

	/**
	 * Origin tracking — the parameter values this component navigated to whose locations have not
	 * rendered yet, oldest first, at most {@link PENDING_WRITES_REMEMBERED}. The `location.search`
	 * effect removes a value when it arrives and skips the load when it arrived through `PUSH` or
	 * `REPLACE`: that is our own write committing, in order or late, never an external navigation.
	 *
	 * Refs rather than state, here and below: this is cross-effect bookkeeping that drives no render.
	 */
	const pendingWritesRef = useRef<string[]>([]);

	/**
	 * The parameter value the engine is known to hold — set when this component writes or loads a
	 * value, and cleared by every engine change until the next write, so it never vouches for a
	 * state the engine has moved on from. A navigation to this value has nothing to load.
	 */
	const engineStateRef = useRef<string | null>(null);

	/**
	 * The parameter value describing the engine's current state — the last one written or
	 * loaded. Re-attached to the URL after a route change that drops it.
	 */
	const currentParamRef = useRef<string | null>(null);

	/** The pathname the route-change effect last saw, so it acts only on a pathname change. */
	const lastPathnameRef = useRef(location.pathname);

	/**
	 * Timer handle for the debounced engine→URL writes. Cleared on unsubscribe + on every
	 * new engine event that supersedes a pending write.
	 */
	const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	/**
	 * Monotonic token for engine→URL writes, bumped by every engine change. When `asyncConfig` is in
	 * play, `exportConfig` awaits a worker round-trip; a change landing meanwhile bumps this, so the
	 * now-stale export is discarded rather than clobbering the URL with an out-of-date state (the
	 * change schedules its own write).
	 */
	const writeTokenRef = useRef(0);

	/**
	 * The rendered location and the router's `navigate`, as of the latest render. A write reads them
	 * when it runs rather than closing over them, so the engine subscription and its pending
	 * debounced write survive a location change — including the one a previous write causes.
	 */
	const locationRef = useRef(location);
	const navigateRef = useRef(navigate);

	/**
	 * Resolved serializer instance. Re-resolved if the prop changes (the resolver is
	 * cheap; no need for useMemo).
	 */
	const serializer = resolveSerializer(serializerProp);

	useEffect((): void => {
		locationRef.current = location;
		navigateRef.current = navigate;
	}, [location, navigate]);

	// #region docs:url-sync-effects
	// ─── Engine → URL ──────────────────────────────────────────────────────
	useEffect((): (() => void) => {
		const writeUrl = async (): Promise<void> => {
			// Worker-backed engines export across a postMessage round-trip; an engine change landing
			// mid-export bumps the token and discards this now-stale write. The sync path (no
			// `asyncConfig`) hits no `await`, so it still runs through to `navigate` synchronously.
			const token = writeTokenRef.current;
			const config = asyncConfig ? await asyncConfig.exportConfig() : engine.exportConfig();

			if (token !== writeTokenRef.current) {
				return;
			}
			const serialized = serializer.encode(config);

			rememberWrite(pendingWritesRef.current, serialized);
			engineStateRef.current = serialized;
			currentParamRef.current = serialized;
			const { pathname, search: currentSearch } = locationRef.current;
			const search = new URLSearchParams(currentSearch);

			search.set(paramKey, serialized);
			void navigateRef.current({ pathname, search: search.toString() }, { replace: historyMode === 'replace' });
		};

		const off = engine.subscribe(() => {
			writeTokenRef.current += 1;
			engineStateRef.current = null;
			if (writeTimerRef.current !== null) {
				clearTimeout(writeTimerRef.current);
			}
			if (debounceMs <= 0) {
				void writeUrl();

				return;
			}
			writeTimerRef.current = setTimeout(() => {
				writeTimerRef.current = null;
				void writeUrl();
			}, debounceMs);
		});

		return (): void => {
			if (writeTimerRef.current !== null) {
				clearTimeout(writeTimerRef.current);
			}
			off();
		};
	}, [asyncConfig, engine, serializer, paramKey, debounceMs, historyMode]);

	// ─── URL → Engine ──────────────────────────────────────────────────────
	useEffect((): void => {
		const params = new URLSearchParams(location.search);
		const serialized = params.get(paramKey);

		if (!serialized) {
			return;
		}
		// One of our own writes arriving — in order, or late, after a newer one (see "Own writes").
		// A POP is the user's history navigation, even to a value we wrote, so it is never skipped here.
		const pending = pendingWritesRef.current;
		const pendingIndex = pending.indexOf(serialized);

		if (pendingIndex !== -1) {
			pending.splice(pendingIndex, 1);
			if (navigationType !== NavigationType.Pop) {
				return;
			}
		}
		// The engine already holds this state; loading it again would change nothing.
		if (serialized === engineStateRef.current) {
			return;
		}

		try {
			const config = serializer.decode(serialized);

			engine.loadConfig(config);
			engineStateRef.current = serialized;
			currentParamRef.current = serialized;
		} catch (err) {
			/* v8 ignore next -- defensive: the built-in serializers always throw Error; the non-Error branch is only reachable via a custom serializer that throws a non-Error */
			const error = err instanceof Error ? err : new Error(String(err));

			onError?.(error);
			if (!shouldTolerateMalformedUrls) {
				throw error;
			}
		}
	}, [location.search, navigationType, engine, serializer, paramKey, shouldTolerateMalformedUrls, onError]);
	// #endregion docs:url-sync-effects

	// ─── Across routes ─────────────────────────────────────────────────────
	useEffect((): void => {
		if (location.pathname === lastPathnameRef.current) {
			return;
		}
		lastPathnameRef.current = location.pathname;
		const carried = currentParamRef.current;
		const search = new URLSearchParams(location.search);

		if (routeChangeMode === undefined || carried === null || search.has(paramKey)) {
			return;
		}
		search.set(paramKey, carried);
		rememberWrite(pendingWritesRef.current, carried);
		void navigate(
			{ pathname: location.pathname, search: search.toString() },
			{ replace: routeChangeMode === 'replace' },
		);
	}, [location.pathname, location.search, navigate, paramKey, routeChangeMode]);

	return null;
};
