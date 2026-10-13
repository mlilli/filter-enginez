/**
 * `createFilterEngineSlice` — the slice factory producing the read-only Redux mirror of a
 * `FilterEngine`.
 *
 * @remarks
 * Per `docs/architecture.md` §13.1. The slice has exactly ONE mutating action:
 * `stateUpdated`, which is called only by the bridge's `attachEngineToStore` in response
 * to engine events. Consumers reading from the slice do so via standard Redux selectors;
 * consumers writing to the engine do so via the engine reference directly (or via the
 * forwarding middleware — see `createFilterEngineMiddleware`).
 *
 * **Multi-engine support.** Apps can run multiple engines simultaneously (e.g., one filter
 * engine for a results grid, one for a sidebar facet panel) — call `createFilterEngineSlice`
 * once per engine, each with a distinct `name`. Selectors disambiguate via `state[sliceName]`.
 *
 * **The `includeResults` option.** When `false`, `stateUpdated` payloads omit the `results`
 * array — the mirror carries only metadata (count, ids, mode). Useful for very large result
 * sets where mirroring the full items would double-memory the working set. The slice's
 * reducer respects the omission by leaving the prior `results` value untouched if the
 * payload doesn't include it; consumer selectors that read `state.filters.results` get a
 * stale-but-stable value (typically the initial empty array). Pair with `attachEngineToStore`
 * which also honors `includeResults` when building its dispatch payloads.
 *
 * @packageDocumentation
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import {
	type FilterEngineMirrorState,
	type FilterEngineMirrorStateUpdate,
	INITIAL_MIRROR_STATE,
} from './MirrorState.js';

/**
 * Options for `createFilterEngineSlice`.
 */
export interface CreateFilterEngineSliceOptions {
	/**
	 * If `false`, the mirror's `results` field is omitted from `stateUpdated` payloads — the
	 * slice carries only metadata (count, ids, mode). Useful for very large result sets where
	 * mirroring the full items would double-memory the working set. Default `true`.
	 */
	readonly includeResults?: boolean;
}

/**
 * The action-creator surface produced by `createFilterEngineSlice`. The bridge dispatches
 * `stateUpdated` directly; consumer code typically uses the selectors / hooks built atop
 * the slice rather than these action creators.
 */
export interface FilterEngineSliceActions<T> {
	readonly stateUpdated: (payload: FilterEngineMirrorStateUpdate<T>) => {
		readonly payload: FilterEngineMirrorStateUpdate<T>;
		readonly type: string;
	};
}

/**
 * The full slice + its action creators, as produced by `createFilterEngineSlice`.
 *
 * @remarks
 * Structurally typed to keep the public surface stable across RTK minor versions. The
 * `name` / `reducer` / `actions` / `getInitialState` quartet matches RTK's `Slice` shape;
 * downstream code wiring this into `configureStore({ reducer: { [slice.name]: slice.reducer } })`
 * works against the structural type with no RTK-version coupling.
 *
 * Also carries a `_includeResults` runtime flag the orchestrator (`attachEngineToStore`)
 * reads to decide whether its dispatch payload should include the `results` array. The
 * leading underscore signals "implementation detail, don't depend on it directly."
 */
export interface FilterEngineSlice<T> {
	readonly actions: FilterEngineSliceActions<T>;
	readonly getInitialState: () => FilterEngineMirrorState<T>;
	readonly name: string;
	readonly reducer: (
		state: FilterEngineMirrorState<T> | undefined,
		action: { payload?: unknown; type: string; },
	) => FilterEngineMirrorState<T>;
	/** @internal — orchestrator-only flag, not part of the consumer-facing contract. */
	readonly _includeResults: boolean;
}

// #region docs:create-filter-engine-slice
/**
 * Create a Redux slice that mirrors a `FilterEngine`'s public state.
 *
 * @typeParam T - The item type the underlying engine operates over
 * @param name - The slice name (becomes the action type prefix and the slice key in the
 *   combined reducer)
 * @param options - Optional configuration
 * @returns A slice with `name`, `reducer`, `actions`, `getInitialState`
 *
 * @example
 *   import { configureStore } from '@reduxjs/toolkit';
 *   import { createFilterEngineSlice } from '@filter-enginez/redux-bridge';
 *
 *   const filterSlice = createFilterEngineSlice<Wine>('filters');
 *   const store = configureStore({ reducer: { [filterSlice.name]: filterSlice.reducer } });
 *
 *   attachEngineToStore(store, engine, { slice: filterSlice });
 */
export function createFilterEngineSlice<T = unknown>(
	name: string,
	options: CreateFilterEngineSliceOptions = {},
): FilterEngineSlice<T> {
	const shouldIncludeResults = options.includeResults ?? true;
	// RTK infers the state type from `initialState`; we tell it the type via the explicit
	// generic on `createSlice<...>` rather than typing the inline reducer params (which
	// produces a `WritableDraft<T>` vs `readonly T[]` mismatch with our generic `T`).
	const rtkSlice = createSlice({
		initialState: INITIAL_MIRROR_STATE as FilterEngineMirrorState<T>,
		name,
		reducers: {
			// Object.assign onto an Immer draft is the canonical "shallow-merge into state"
			// pattern. Cast through `unknown` to bridge Immer's Draft<T> back to T for the
			// Object.assign call; the runtime behavior is identical regardless.
			stateUpdated(state, action: PayloadAction<FilterEngineMirrorStateUpdate<T>>): void {
				Object.assign(state as unknown as FilterEngineMirrorState<T>, action.payload);
			},
		},
	});

	return {
		_includeResults: shouldIncludeResults,
		actions: {
			stateUpdated: rtkSlice.actions.stateUpdated,
		},
		getInitialState: rtkSlice.getInitialState,
		name: rtkSlice.name,
		reducer: rtkSlice.reducer,
	};
}
// #endregion docs:create-filter-engine-slice
