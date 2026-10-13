/**
 * Tests for the `FilterGroup` type surface — `FilterGroupCompositionMode` + the `FilterGroup`
 * interface.
 *
 * @remarks
 * `FilterGroup.ts` is a pure type module (no runtime exports), so these tests are
 * compile-time-asserting: they construct values that conform to the declared shapes and read
 * each field back. A type module shows 0/0 in coverage, which is substantively 100% — the
 * value here is locking the public shape (required vs optional fields, the two composition
 * modes, the `readonly` `filterIds` array) so a future widening of the contract is a
 * deliberate, test-visible change.
 */

import { describe, expect, it } from 'vitest';

import type { FilterGroup, FilterGroupCompositionMode } from './FilterGroup.js';

describe('FilterGroupCompositionMode', () => {
	it('admits the two documented operators', () => {
		const or: FilterGroupCompositionMode = 'or';
		const and: FilterGroupCompositionMode = 'and';

		expect([or, and]).toEqual(['or', 'and']);
	});
});

describe('FilterGroup', () => {
	it('conforms with only the required fields populated', () => {
		const group: FilterGroup = {
			composition: 'or',
			filterIds: ['color-red', 'color-blue'],
			id: 'color',
		};

		expect(group.id).toBe('color');
		expect(group.filterIds).toEqual(['color-red', 'color-blue']);
		expect(group.composition).toBe('or');
		expect(group.displayName).toBeUndefined();
	});

	it('carries an optional display name when provided', () => {
		const group: FilterGroup = {
			composition: 'and',
			displayName: 'Price Range',
			filterIds: ['price-range'],
			id: 'price',
		};

		expect(group.displayName).toBe('Price Range');
	});

	it('supports an empty filter-id collection', () => {
		const group: FilterGroup = {
			composition: 'or',
			filterIds: [],
			id: 'empty',
		};

		expect(group.filterIds).toEqual([]);
	});
});
