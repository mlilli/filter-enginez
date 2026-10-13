/**
 * @remarks
 * `queryBundle.ts` is a type-only module — interfaces + a discriminated union (`inSet` /
 * `inSetOfSets`) describing the single-round-trip `applyFiltersAndQuery` request/response
 * shapes, with NO runtime values (0/0 coverage). These tests are thin compile-time shape
 * assertions over each exported type; the algorithmic behavior that produces / consumes these
 * shapes is exercised exhaustively in `applyFiltersAndQuery.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import type {
	FilterBundle,
	FilterBundleChipCandidateMeta,
	FilterBundleChipGroupMeta,
	FilterBundleChipGroupQuery,
	FilterBundleFieldMeta,
	FilterBundleFieldQuery,
	FilterBundleQuery,
} from './queryBundle.js';

describe('queryBundle types', () => {
	it('FilterBundleFieldQuery carries ruleId + fieldKey + optional baseline/bucketCount', () => {
		const query: FilterBundleFieldQuery = {
			baselineMax: 100,
			baselineMin: 0,
			bucketCount: 12,
			fieldKey: 'price',
			ruleId: 'price-range',
		};

		expect(query.fieldKey).toBe('price');
		expect(query.bucketCount).toBe(12);
	});

	it('FilterBundleChipGroupQuery narrows on the inSet kind', () => {
		const inSetQuery: FilterBundleChipGroupQuery = {
			candidates: ['red', 'blue'],
			field: 'color',
			kind: 'inSet',
			ruleId: 'color',
		};

		expect(inSetQuery.kind).toBe('inSet');
		expect(inSetQuery.candidates).toHaveLength(2);
	});

	it('FilterBundleChipGroupQuery narrows on the inSetOfSets kind', () => {
		const hierarchicalQuery: FilterBundleChipGroupQuery = {
			candidates: [{ leafIds: ['IT-PIE', 'IT-VEN'], value: 'IT' }],
			field: 'region',
			kind: 'inSetOfSets',
			ruleId: 'origin',
		};

		expect(hierarchicalQuery.kind).toBe('inSetOfSets');
		expect(hierarchicalQuery.candidates[0]?.leafIds).toHaveLength(2);
	});

	it('FilterBundleChipCandidateMeta + FilterBundleChipGroupMeta describe per-candidate output', () => {
		const candidate: FilterBundleChipCandidateMeta = {
			projectedCount: 5,
			value: 'red',
			wouldBeEmpty: false,
		};
		const group: FilterBundleChipGroupMeta = { candidates: [candidate], ruleId: 'color' };

		expect(group.candidates[0]?.projectedCount).toBe(5);
	});

	it('FilterBundleFieldMeta carries bounds + transferable histogram arrays', () => {
		const meta: FilterBundleFieldMeta = {
			bounds: { max: 100, min: 0 },
			fieldKey: 'price',
			histogram: { bucketEdges: new Float64Array(2), counts: new Uint32Array(1) },
			ruleId: 'price-range',
		};

		expect(meta.bounds.min).toBe(0);
		expect(meta.histogram.counts).toBeInstanceOf(Uint32Array);
	});

	it('FilterBundleQuery + FilterBundle compose field + chip metadata', () => {
		const query: FilterBundleQuery = { chipGroups: [], fields: []};
		const bundle: FilterBundle = {
			chipGroups: [],
			fields: [],
			resultCount: 0,
			resultIndices: new Uint32Array(0),
		};

		expect(query.fields).toEqual([]);
		expect(bundle.resultCount).toBe(0);
	});
});
