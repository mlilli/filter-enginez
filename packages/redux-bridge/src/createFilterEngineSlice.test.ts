/**
 * Tests for `createFilterEngineSlice` — the read-only mirror slice factory.
 *
 * @remarks
 * Covers the factory's outputs (`name` / `reducer` / `actions` / `getInitialState` /
 * `_includeResults`), the single `stateUpdated` reducer's shallow-merge semantics, the
 * `includeResults` flag, and multi-engine naming. The reducer is exercised directly
 * (`slice.reducer(state, slice.actions.stateUpdated(...))`) — no store required.
 */

import { describe, expect, it } from 'vitest';

import { createFilterEngineSlice } from './createFilterEngineSlice.js';
import { INITIAL_MIRROR_STATE } from './MirrorState.js';

interface Item {
	readonly id: number;
}

describe('createFilterEngineSlice', () => {
	it('exposes the name / reducer / actions / getInitialState quartet + the _includeResults flag', () => {
		const slice = createFilterEngineSlice<Item>('filters');

		expect(slice.name).toBe('filters');
		expect(typeof slice.reducer).toBe('function');
		expect(typeof slice.actions.stateUpdated).toBe('function');
		expect(typeof slice.getInitialState).toBe('function');
		// Defaults to true.
		expect(slice._includeResults).toBe(true);
	});

	it('seeds from INITIAL_MIRROR_STATE', () => {
		const slice = createFilterEngineSlice<Item>('filters');

		expect(slice.getInitialState()).toEqual(INITIAL_MIRROR_STATE);
	});

	it('honors includeResults: false on the runtime flag', () => {
		const slice = createFilterEngineSlice<Item>('filters', { includeResults: false });

		expect(slice._includeResults).toBe(false);
	});

	it('stateUpdated shallow-merges a partial payload onto prior state', () => {
		const slice = createFilterEngineSlice<Item>('filters');
		const before = slice.getInitialState();
		const after = slice.reducer(
			before,
			slice.actions.stateUpdated({ activeRuleIds: ['price'], resultCount: 42, version: 1 }),
		);

		// Updated fields applied …
		expect(after.resultCount).toBe(42);
		expect(after.activeRuleIds).toEqual(['price']);
		expect(after.version).toBe(1);
		// … untouched fields preserved.
		expect(after.mode).toBe('flat-map');
		expect(after.lastChangeRuleId).toBeNull();
	});

	it('stateUpdated applied twice keeps prior fields the second payload omits', () => {
		const slice = createFilterEngineSlice<Item>('filters');
		const s1 = slice.reducer(slice.getInitialState(), slice.actions.stateUpdated({ resultCount: 10, version: 1 }));
		const s2 = slice.reducer(s1, slice.actions.stateUpdated({ activeRuleIds: ['color'], version: 2 }));

		// resultCount from the first update survives the second (which omitted it).
		expect(s2.resultCount).toBe(10);
		expect(s2.activeRuleIds).toEqual(['color']);
		expect(s2.version).toBe(2);
	});

	it('reducer returns the initial state for an unrelated action', () => {
		const slice = createFilterEngineSlice<Item>('filters');
		const out = slice.reducer(undefined, { payload: 1, type: 'some/other' });

		expect(out).toEqual(INITIAL_MIRROR_STATE);
	});

	it('supports multiple engines via distinct slice names', () => {
		const a = createFilterEngineSlice<Item>('gridFilters');
		const b = createFilterEngineSlice<Item>('facetFilters');

		expect(a.name).toBe('gridFilters');
		expect(b.name).toBe('facetFilters');
		// Each slice's stateUpdated action type is namespaced by its name.
		expect(a.actions.stateUpdated({ version: 1 }).type).toBe('gridFilters/stateUpdated');
		expect(b.actions.stateUpdated({ version: 1 }).type).toBe('facetFilters/stateUpdated');
	});
});
