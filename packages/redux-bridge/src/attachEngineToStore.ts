/**
 * `attachEngineToStore` — the orchestrator that wires a `FilterEngine` to a Redux store via
 * the mirror slice + (optional) forwarding middleware.
 *
 * @remarks
 * Per `docs/architecture.md` §13.3. Subscribes `engine.subscribe(...)` and dispatches the
 * slice's `stateUpdated` action on every change event, with a partial-update payload computed
 * from the event type. Returns an unsubscribe function — call it when the engine leaves scope
 * (typically alongside `engine.destroy()` in app teardown).
 *
 * **One-way sync, enforced.** This is the ONLY code path that dispatches `stateUpdated`.
 * Consumers reaching into the store and dispatching `slice.actions.stateUpdated(...)`
 * themselves violate the read-only-mirror contract; the
 * `@filter-enginez/eslint-plugin/no-direct-mirror-mutation` rule catches that statically.
 *
 * **Partial updates per event type.** A `'rule:added'` event emits a `stateUpdated` with just
 * `{ activeRuleIds, lastChangeRuleId, lastChangeTimestamp, version }` — not the full state.
 * Keeps the Redux DevTools action log readable (you can see which rule changed without
 * hunting through a full-state diff).
 *
 * **Initial sync.** On attach, `attachEngineToStore` immediately dispatches a `stateUpdated`
 * with the engine's current full state so the mirror is consistent before any subsequent
 * event lands.
 *
 * @packageDocumentation
 */

import type { ChangeEvent, FilterEngine, RuleId } from '@filter-enginez/core';

import type { FilterEngineSlice } from './createFilterEngineSlice.js';
import type { FilterEngineMirrorState, FilterEngineMirrorStateUpdate } from './MirrorState.js';

/**
 * Options for `attachEngineToStore`.
 */
export interface AttachEngineToStoreOptions<T> {
	/** The slice (from `createFilterEngineSlice`) the engine should mirror into. */
	readonly slice: FilterEngineSlice<T>;
	/**
	 * If `false`, the initial-sync dispatch is skipped. Useful when the store is already
	 * hydrated from server-rendered state and you don't want to overwrite it on attach.
	 * Default `true`.
	 */
	readonly syncOnAttach?: boolean;
}

/**
 * Minimal Redux store shape — `dispatch` is the only method this module needs. Defined
 * structurally to avoid a direct dependency on `redux` (RTK / Redux are peer deps).
 */
export interface ReduxStoreShape {
	dispatch(action: unknown): void;
}

/**
 * Wire a `FilterEngine` to a Redux store so the slice mirrors engine state.
 *
 * @typeParam T - The item type the engine operates over
 * @param _store - The Redux store containing the mirror slice
 * @param _engine - The engine to mirror
 * @param _options - Slice reference + sync-on-attach toggle
 * @returns An unsubscribe function — call to detach the bridge
 *
 * @example
 *   const filterSlice = createFilterEngineSlice<Wine>('filters');
 *   const store = configureStore({ reducer: { [filterSlice.name]: filterSlice.reducer } });
 *   const engine = createFilterEngine<Wine>({ sourceData: wines });
 *
 *   const detach = attachEngineToStore(store, engine, { slice: filterSlice });
 *
 *   // ... app runs, store stays in sync ...
 *
 *   detach();
 *   await engine.destroy();
 */
export function attachEngineToStore<T>(
	store: ReduxStoreShape,
	engine: FilterEngine<T>,
	options: AttachEngineToStoreOptions<T>,
): () => void {
	const { slice, syncOnAttach: shouldSyncOnAttach = true } = options;
	const shouldIncludeResults = slice._includeResults;
	let version = 0;

	// **Last-change tracked from the event stream — NOT read from `engine.store`.**
	// Reading `engine.store.lastChangeRuleId.value` / `engine.store.lastChangeTimestamp.value`
	// would be the wrong coupling for two reasons: (1) it reaches into the engine's INTERNAL
	// store for data the public `ChangeEvent` stream already carries (`event.ruleId` on rule
	// mutations), and (2) it fails against worker-backed engines whose `.core` is an async shim —
	// the RxJS shim's `store` throws `MODE_WORKER_UNSUPPORTED` (no postMessage-safe surface), so
	// `attachEngineToStore` would throw on attach and on every rule event. We instead derive last-change locally: rule mutations set it from the event,
	// `reset` clears it, and `fullSnapshot` reads the tracked pair. Result: the bridge is portable
	// across sync AND worker cores, with identical mirror semantics.
	let lastChangeRuleId: RuleId | null = null;
	let lastChangeTimestamp: number | null = null;

	/**
	 * Build a full-state snapshot of the engine's mirrorable fields, bumping `version` so
	 * downstream selectors keyed on `state.filters.version` see a fresh value even when other
	 * fields' identities happen to match (e.g., re-dispatching after a no-op).
	 */
	const fullSnapshot = (): FilterEngineMirrorState<T> => {
		version++;

		return {
			activeRuleIds: [...engine.getActiveRuleIds()],
			lastChangeRuleId,
			lastChangeTimestamp,
			mode: engine.getExpression() !== null ? 'expression' : 'flat-map',
			resultCount: engine.getResultCount(),
			results: shouldIncludeResults ? [...engine.getResults()] : [],
			version,
		};
	};

	// #region docs:per-event-mirror-dispatch
	/**
	 * Build the partial update payload for a given change event. Per-event narrowing keeps
	 * the Redux DevTools action log readable (you can see which rule changed without hunting
	 * through a full-state diff).
	 */
	const partialFor = (event: ChangeEvent): FilterEngineMirrorStateUpdate<T> => {
		version++;
		const base = { version };

		switch (event.type) {
			case 'expression':
				return {
					...base,
					mode: engine.getExpression() !== null ? 'expression' : 'flat-map',
					resultCount: engine.getResultCount(),
					...(shouldIncludeResults ? { results: [...engine.getResults()]} : {}),
				};
			case 'reset':
				// Wholesale event — full snapshot is the safest payload. Clear the tracked
				// last-change first so the snapshot reflects the post-reset "nothing changed yet"
				// state rather than carrying a stale rule id forward.
				lastChangeRuleId = null;
				lastChangeTimestamp = null;

				return fullSnapshot();
			case 'results':
			case 'sourceData':
			case 'workingSet':
				return {
					...base,
					resultCount: engine.getResultCount(),
					...(shouldIncludeResults ? { results: [...engine.getResults()]} : {}),
				};
			case 'rule:added':
			case 'rule:changed':
			case 'rule:removed':
				// Derive last-change from the event itself rather than the engine's internal store.
				lastChangeRuleId = event.ruleId;
				lastChangeTimestamp = Date.now();

				return {
					...base,
					activeRuleIds: [...engine.getActiveRuleIds()],
					resultCount: engine.getResultCount(),
					...(shouldIncludeResults ? { results: [...engine.getResults()]} : {}),
					lastChangeRuleId,
					lastChangeTimestamp,
				};
		}
	};

	// Initial sync — populate the mirror with the engine's current state.
	if (shouldSyncOnAttach) {
		store.dispatch(slice.actions.stateUpdated(fullSnapshot()));
	}

	// Subscribe to engine events and dispatch a per-event partial update.
	const unsubscribe = engine.subscribe((event) => {
		store.dispatch(slice.actions.stateUpdated(partialFor(event)));
	});

	return unsubscribe;
	// #endregion docs:per-event-mirror-dispatch
}
