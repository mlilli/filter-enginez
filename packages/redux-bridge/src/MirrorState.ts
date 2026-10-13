/**
 * `FilterEngineMirrorState` — the read-only shape mirrored from a `FilterEngine` into a Redux
 * slice. Mutated only by the bridge in response to `engine.subscribe` events.
 *
 * @remarks
 * Per `docs/architecture.md` §13.1. The mirror exists for
 * one reason: integration. Redux-DevTools-driven debugging workflows, RTK Query selectors,
 * Reselect memoization, server-side render hydration — all expect a Redux slice they can read
 * from. The bridge provides exactly that, but with a strict contract: consumers MUST NOT
 * dispatch `stateUpdated` directly, MUST NOT mutate the slice from anywhere except the bridge.
 * Enforced by `@filter-enginez/eslint-plugin/no-direct-mirror-mutation`.
 *
 * **Why these specific fields.** The mirror carries the read-side projection: what consumers
 * select from. Source data + working set are NOT mirrored (typically large; consumer can read
 * via the engine reference if needed). Rules are mirrored as IDs only (the full `FilterRule`
 * instances are non-serializable in general — `PredicateRule` holds function pointers — and
 * Redux DevTools time-travel needs serializable state).
 *
 * **Mirror update payload.** Each `stateUpdated` action carries a partial update (only the
 * fields that changed). The reducer does `Object.assign(state, payload)` — partial updates
 * keep the action log readable in Redux DevTools (you see "rule-added: { activeRuleIds }"
 * rather than a full state dump every time).
 *
 * @packageDocumentation
 */

import type { RuleId } from '@filter-enginez/core';

/**
 * The Redux mirror's read-only state shape.
 *
 * @typeParam T - The item type the underlying engine operates over
 *
 * @remarks
 * Marked `readonly` throughout — TypeScript-enforces no-direct-mutation at compile time for
 * consumers reaching for `state.filters.activeRuleIds.push(...)`. The bridge's internal
 * `stateUpdated` reducer freely mutates via Immer (RTK's underlying mechanism).
 */
export interface FilterEngineMirrorState<T = unknown> {
	/** Current registered rule IDs. */
	readonly activeRuleIds: readonly RuleId[];

	/** Number of items in the engine's current result set. */
	readonly resultCount: number;

	/**
	 * The current filtered results. Copied by value into the slice on every change.
	 *
	 * **Memory consideration.** For large result sets (10k+ items), mirroring the full array
	 * into Redux multiplies memory cost — consider `includeResults: false` in
	 * `createFilterEngineSlice` to omit this field entirely (engine remains the source for
	 * components that need the items themselves; the mirror carries just the metadata).
	 */
	readonly results: readonly T[];

	/** Current engine evaluation mode. */
	readonly mode: 'expression' | 'flat-map';

	/** The id of the last rule mutated (for the "highlight recently-changed filter" UX). */
	readonly lastChangeRuleId: RuleId | null;

	/** Timestamp of the last rule mutation. */
	readonly lastChangeTimestamp: number | null;

	/** Monotonically increasing — useful as a dependency key for selectors and effects. */
	readonly version: number;
}

/**
 * Partial mirror-state update — the payload of the `stateUpdated` action.
 *
 * @remarks
 * Every field is optional; the reducer applies `Object.assign(state, payload)`. The bridge
 * builds these partials per `ChangeEvent`, emitting only the fields that actually changed
 * (e.g., a `'results'` event emits `{ results, resultCount, version }` but not
 * `activeRuleIds`).
 */
export type FilterEngineMirrorStateUpdate<T = unknown> = Partial<FilterEngineMirrorState<T>>;

/**
 * Initial state used when the slice is created. The engine's `attachEngineToStore` call
 * populates this with a real snapshot immediately after attach.
 */
export const INITIAL_MIRROR_STATE: FilterEngineMirrorState = {
	activeRuleIds: [],
	lastChangeRuleId: null,
	lastChangeTimestamp: null,
	mode: 'flat-map',
	resultCount: 0,
	results: [],
	version: 0,
};
