/**
 * @remarks
 * Pass-3 behavioral coverage for {@link SimilaritySearch} (part 2 — caching, error guards,
 * feature extraction). Split from `SimilaritySearch.test.ts` to stay under the 500-line
 * file-size cap; the construction / configure / findSimilar / findSimilarByFeatureSet suites
 * live in the sibling file. Shared fixtures (`Wine`, `at`, `makeWines`, `makeWired`) are
 * duplicated here so each suite file is self-contained and runnable in isolation.
 *
 * Tested behaviors:
 * - The lazy index is reused at a stable version and rebuilt when the version bumps.
 * - `invalidateCache` forces a rebuild; undefined corpus holes are skipped at build time.
 * - Error guards: no config, config without attributes/signatureFn, accessors not wired,
 *   and the same no-config guard on `findSimilarByFeatureSet`.
 * - Feature extraction via `signatureFn`, array values, object values (JSON), boolean/number
 *   primitives, and null/undefined-path skipping.
 *
 * @packageDocumentation
 */

import { describe, expect, it } from 'vitest';

import { type SimilarityConfig, SimilaritySearch } from './SimilaritySearch.js';

interface Wine {
	readonly id: number;
	readonly region: string;
	readonly tags: readonly string[];
	readonly varietal: string;
}

/** Index a tuple/array and assert the slot is populated — avoids forbidden non-null assertions. */
function at<T>(items: readonly T[], index: number): T {
	const value = items[index];

	if (value === undefined) {
		throw new Error(`test fixture: expected a defined element at index ${index}`);
	}

	return value;
}

/** Two near-identical wines plus a disjoint outlier — see the part-1 suite for rationale. */
function makeWines(): Wine[] {
	return [
		{ id: 1, region: 'napa', tags: ['oak', 'tannic', 'bold', 'cherry'], varietal: 'cabernet' },
		{ id: 2, region: 'napa', tags: ['oak', 'tannic', 'bold', 'cherry'], varietal: 'cabernet' },
		{ id: 3, region: 'mosel', tags: ['crisp', 'sweet', 'floral', 'lime'], varietal: 'riesling' },
	];
}

/** Wire a search over a mutable corpus + version cell (mirrors the part-1 helper). */
function makeWired(config: SimilarityConfig<Wine>): {
	search: SimilaritySearch<Wine>;
	setData: (next: Wine[]) => void;
} {
	let data = makeWines();
	const search = new SimilaritySearch<Wine>({
		config,
		getSourceData: () => data,
		getSourceDataVersion: () => 1,
	});

	return {
		search,
		setData: (next) => {
			data = next;
		},
	};
}

describe('SimilaritySearch caching + invalidation', () => {
	it('reuses the cached index at a stable version', () => {
		let buildCount = 0;
		const data = makeWines();
		const search = new SimilaritySearch<Wine>({
			config: {
				signatureFn: (w) => {
					buildCount += 1;

					return new Set([w.varietal, w.region]);
				},
			},
			getSourceData: () => data,
			getSourceDataVersion: () => 5,
		});

		search.findSimilar(at(data, 0));
		const afterFirst = buildCount;

		search.findSimilar(at(data, 1));
		// No version bump → index not rebuilt → signatureFn not re-invoked for the corpus build.
		// (Each findSimilar still calls signatureFn once for the query item.)
		expect(buildCount).toBe(afterFirst + 1);
	});

	it('rebuilds the index when the version bumps', () => {
		let version = 1;
		let data = makeWines();
		const search = new SimilaritySearch<Wine>({
			config: {
				signatureFn: (w) => new Set([w.varietal, w.region]),
				threshold: 0,
			},
			getSourceData: () => data,
			getSourceDataVersion: () => version,
		});

		search.findSimilar(at(data, 0));

		// Swap to a brand-new dataset and bump the version; the next query must reflect it.
		data = [
			{ id: 10, region: 'burgundy', tags: [], varietal: 'pinot' },
			{ id: 11, region: 'burgundy', tags: [], varietal: 'pinot' },
		];
		version = 2;
		const results = search.findSimilar(at(data, 0));

		expect(results.some((r) => r.item.id === 11)).toBe(true);
	});

	it('skips undefined items while building the per-item signature index', () => {
		// A sparse corpus (hole at index 1) exercises the build-time `item === undefined` skip in
		// _ensureIndexBuilt — index 1 is never inserted into the LSH or given a signature.
		const data: (Wine | undefined)[] = [
			{ id: 1, region: 'napa', tags: ['oak', 'bold'], varietal: 'cabernet' },
			undefined,
			{ id: 3, region: 'napa', tags: ['oak', 'bold'], varietal: 'cabernet' },
		];
		const search = new SimilaritySearch<Wine>({
			config: { attributes: ['region', 'tags', 'varietal'], threshold: 0 },
			getSourceData: () => data as readonly Wine[],
			getSourceDataVersion: () => 1,
		});
		const results = search.findSimilar(at(data as Wine[], 0));

		// Item 3 (identical to the query) surfaces; the undefined hole contributes nothing.
		expect(results.some((r) => r.item.id === 3)).toBe(true);
	});

	it('forces a rebuild via invalidateCache', () => {
		let data = makeWines();
		const search = new SimilaritySearch<Wine>({
			config: { signatureFn: (w) => new Set([w.varietal]), threshold: 0 },
			getSourceData: () => data,
			// Stable version — only invalidateCache should force the rebuild.
			getSourceDataVersion: () => 1,
		});

		search.findSimilar(at(data, 0));

		// Mutate behind the stable version, then force the rebuild.
		data = [
			{ id: 20, region: 'rhone', tags: [], varietal: 'syrah' },
			{ id: 21, region: 'rhone', tags: [], varietal: 'syrah' },
		];
		search.invalidateCache();
		const results = search.findSimilar(at(data, 0));

		expect(results.some((r) => r.item.id === 21)).toBe(true);
	});
});

describe('SimilaritySearch error guards', () => {
	it('throws when no configuration is set', () => {
		const search = new SimilaritySearch<Wine>({
			getSourceData: () => makeWines(),
			getSourceDataVersion: () => 1,
		});

		expect(() => search.findSimilar(at(makeWines(), 0))).toThrow(/no configuration set/);
	});

	it('throws when config provides neither attributes nor signatureFn', () => {
		const search = new SimilaritySearch<Wine>({
			config: { threshold: 0.5 },
			getSourceData: () => makeWines(),
			getSourceDataVersion: () => 1,
		});

		expect(() => search.findSimilar(at(makeWines(), 0))).toThrow(
			/either `attributes` or `signatureFn`/,
		);
	});

	it('throws when the source-data accessors are not wired', () => {
		const search = new SimilaritySearch<Wine>({ attributes: ['varietal']});

		expect(() => search.findSimilar(at(makeWines(), 0))).toThrow(/accessors not wired/);
	});

	it('throws from findSimilarByFeatureSet when no config is set', () => {
		const search = new SimilaritySearch<Wine>({
			getSourceData: () => makeWines(),
			getSourceDataVersion: () => 1,
		});

		expect(() => search.findSimilarByFeatureSet(new Set(['x']))).toThrow(/no configuration set/);
	});
});

describe('SimilaritySearch feature extraction', () => {
	it('uses an explicit signatureFn when provided', () => {
		let wasCalled = false;
		const { search } = makeWired({
			signatureFn: (w) => {
				wasCalled = true;

				return new Set([w.varietal]);
			},
			threshold: 0,
		});

		search.findSimilar(at(makeWines(), 0));
		expect(wasCalled).toBe(true);
	});

	it('extracts array values as one token per element', () => {
		const data: Wine[] = [
			{ id: 1, region: 'r', tags: ['oak', 'bold'], varietal: 'a' },
			{ id: 2, region: 's', tags: ['oak', 'bold'], varietal: 'b' },
		];
		const { search, setData } = makeWired({ attributes: ['tags'], threshold: 0.9 });

		setData(data);
		// Both wines share the full tag array → identical signatures → similarity 1.
		const results = search.findSimilar(at(data, 0));

		expect(results.some((r) => r.item.id === 2 && r.similarity === 1)).toBe(true);
	});

	it('stringifies object-valued attributes via JSON', () => {
		interface Boxed {
			readonly id: number;
			readonly meta: { readonly origin: string };
		}
		const data: Boxed[] = [
			{ id: 1, meta: { origin: 'fr' }},
			{ id: 2, meta: { origin: 'fr' }},
		];
		const search = new SimilaritySearch<Boxed>({
			config: { attributes: ['meta'], threshold: 0.9 },
			getSourceData: () => data,
			getSourceDataVersion: () => 1,
		});
		const results = search.findSimilar(at(data, 0));

		// Identical nested objects collapse to the same JSON token → similarity 1.
		expect(results.some((r) => r.item.id === 2 && r.similarity === 1)).toBe(true);
	});

	it('extracts boolean and number primitives', () => {
		interface Spec {
			readonly id: number;
			readonly organic: boolean;
			readonly vintage: number;
		}
		const data: Spec[] = [
			{ id: 1, organic: true, vintage: 2018 },
			{ id: 2, organic: true, vintage: 2018 },
			{ id: 3, organic: false, vintage: 1990 },
		];
		const search = new SimilaritySearch<Spec>({
			config: { attributes: ['vintage', 'organic'], threshold: 0.9 },
			getSourceData: () => data,
			getSourceDataVersion: () => 1,
		});
		const results = search.findSimilar(at(data, 0));

		expect(results.some((r) => r.item.id === 2 && r.similarity === 1)).toBe(true);
		expect(results.some((r) => r.item.id === 3)).toBe(false);
	});

	it('skips attribute paths that resolve to null or undefined', () => {
		interface Maybe {
			readonly id: number;
			readonly a: string;
			readonly b: string | null;
			readonly c?: string;
		}
		const data: Maybe[] = [
			{ a: 'shared', b: null, id: 1 },
			{ a: 'shared', b: null, id: 2 },
		];
		const search = new SimilaritySearch<Maybe>({
			config: { attributes: ['a', 'b', 'c'], threshold: 0.9 },
			getSourceData: () => data,
			getSourceDataVersion: () => 1,
		});
		const results = search.findSimilar(at(data, 0));

		// Only `a` contributes a feature (b is null, c is undefined) → both items match on it.
		expect(results.some((r) => r.item.id === 2 && r.similarity === 1)).toBe(true);
	});

	it('JSON-stringifies non-primitive array elements', () => {
		// Array elements that are themselves objects exercise stringifyPrimitive's JSON fallback
		// (the non-string / non-number / non-boolean arm). Two items with identical nested-object
		// arrays must collapse to identical feature tokens → similarity 1.
		interface Nested {
			readonly id: number;
			readonly notes: readonly { readonly key: string }[];
		}
		const data: Nested[] = [
			{ id: 1, notes: [{ key: 'a' }, { key: 'b' }]},
			{ id: 2, notes: [{ key: 'a' }, { key: 'b' }]},
		];
		const search = new SimilaritySearch<Nested>({
			config: { attributes: ['notes'], threshold: 0.9 },
			getSourceData: () => data,
			getSourceDataVersion: () => 1,
		});
		const results = search.findSimilar(at(data, 0));

		expect(results.some((r) => r.item.id === 2 && r.similarity === 1)).toBe(true);
	});
});
