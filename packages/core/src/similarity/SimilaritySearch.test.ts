/**
 * @remarks
 * Pass-3 behavioral coverage for {@link SimilaritySearch} (part 1 — construction, configure,
 * findSimilar, findSimilarByFeatureSet) — the orchestrator {@link attachSimilarity} returns, which
 * ties {@link MinHash} + {@link LSH} together. The caching / error-guard /
 * feature-extraction suites live in the sibling `SimilaritySearch.behaviors.test.ts` (split to
 * stay under the 500-line file-size cap).
 *
 * The MinHash/LSH layers are probabilistic, so assertions target deterministic invariants
 * (identity filtering, identical-item similarity of 1, threshold filtering, top-k slicing,
 * descending order) rather than exact float estimates on partial overlaps.
 *
 * Tested behaviors:
 * - Constructor accepts the bare-config form and the options form (each discriminant field).
 * - `getConfig` reflects the active config; `configure` swaps it and invalidates the cache.
 * - `findSimilar` ranks descending, slices to k, defaults k=5, and skips the identity item.
 * - `findSimilar` applies the per-call threshold override and the config threshold default.
 * - `findSimilarByFeatureSet` queries with a hypothetical set and does NOT filter identity.
 *
 * @packageDocumentation
 */

import { describe, expect, it } from 'vitest';

import {
	type SimilarityConfig,
	SimilaritySearch,
	type SimilaritySearchOptions,
} from './SimilaritySearch.js';

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

/**
 * Build a small wine corpus with two near-identical wines (ids 1 and 2 share all tags) and a
 * deliberately disjoint outlier (id 3). Used to assert identity-skipping and ranking.
 */
function makeWines(): Wine[] {
	return [
		{ id: 1, region: 'napa', tags: ['oak', 'tannic', 'bold', 'cherry'], varietal: 'cabernet' },
		{ id: 2, region: 'napa', tags: ['oak', 'tannic', 'bold', 'cherry'], varietal: 'cabernet' },
		{ id: 3, region: 'mosel', tags: ['crisp', 'sweet', 'floral', 'lime'], varietal: 'riesling' },
	];
}

/**
 * Wire a {@link SimilaritySearch} over a mutable corpus + version cell, returning handles the
 * tests use to mutate data and bump the version (simulating `FilterEngine`'s accessors).
 */
function makeWired(config: SimilarityConfig<Wine>): {
	bumpVersion: () => void;
	search: SimilaritySearch<Wine>;
	setData: (next: Wine[]) => void;
} {
	let data = makeWines();
	let version = 1;
	const options: SimilaritySearchOptions<Wine> = {
		config,
		getSourceData: () => data,
		getSourceDataVersion: () => version,
	};
	const search = new SimilaritySearch<Wine>(options);

	return {
		bumpVersion: () => {
			version += 1;
		},
		search,
		setData: (next) => {
			data = next;
		},
	};
}

describe('SimilaritySearch construction', () => {
	it('treats a bare config argument as the config (pass-1 signature)', () => {
		const config: SimilarityConfig<Wine> = { attributes: ['varietal']};
		const search = new SimilaritySearch<Wine>(config);

		expect(search.getConfig()).toBe(config);
	});

	it('treats undefined argument as no config', () => {
		const search = new SimilaritySearch<Wine>();

		expect(search.getConfig()).toBeUndefined();
	});

	it('detects the options form via the config field', () => {
		const config: SimilarityConfig<Wine> = { attributes: ['varietal']};
		const search = new SimilaritySearch<Wine>({ config });

		expect(search.getConfig()).toBe(config);
	});

	it('detects the options form via getSourceData', () => {
		const search = new SimilaritySearch<Wine>({ getSourceData: () => []});

		expect(search.getConfig()).toBeUndefined();
	});

	it('detects the options form via getSourceDataVersion', () => {
		const search = new SimilaritySearch<Wine>({ getSourceDataVersion: () => 0 });

		expect(search.getConfig()).toBeUndefined();
	});
});

describe('SimilaritySearch.configure / getConfig', () => {
	it('returns undefined before any config is set', () => {
		expect(new SimilaritySearch<Wine>().getConfig()).toBeUndefined();
	});

	it('swaps the active config and invalidates the cache', () => {
		const { bumpVersion, search } = makeWired({ attributes: ['varietal']});
		const query = at(makeWines(), 0);

		// Prime the cache with the first config.
		search.findSimilar(query);

		// Reconfigure to a single-attribute signature so wines 1 + 2 are near-identical.
		search.configure({ attributes: ['region'], threshold: 0.4 });
		expect(search.getConfig()).toEqual({ attributes: ['region'], threshold: 0.4 });

		bumpVersion();
		const results = search.findSimilar(query);

		expect(results.length).toBeGreaterThan(0);
	});
});

describe('SimilaritySearch.findSimilar', () => {
	it('returns near-identical items and skips the query item itself', () => {
		const { search, setData } = makeWired({ attributes: ['region', 'tags', 'varietal']});
		const wines = makeWines();
		const query = at(wines, 0);

		setData(wines);
		const results = search.findSimilar(query);

		// Wine 1 (the query) must be excluded; wine 2 (identical attributes) appears at 1.0.
		expect(results.every((r) => r.item.id !== 1)).toBe(true);
		expect(results.some((r) => r.item.id === 2 && r.similarity === 1)).toBe(true);
		// The disjoint outlier (id 3) must not pass the default 0.5 threshold.
		expect(results.some((r) => r.item.id === 3)).toBe(false);
	});

	it('ranks results in descending similarity order', () => {
		const { search } = makeWired({ attributes: ['region', 'tags', 'varietal'], threshold: 0 });
		const query = at(makeWines(), 0);
		const results = search.findSimilar(query);

		for (let i = 1; i < results.length; i++) {
			expect(at(results, i - 1).similarity).toBeGreaterThanOrEqual(at(results, i).similarity);
		}
	});

	it('slices to the requested k', () => {
		const data: Wine[] = [];

		for (let i = 0; i < 10; i++) {
			data.push({ id: i, region: 'napa', tags: ['oak', 'bold'], varietal: 'cabernet' });
		}
		const { search, setData } = makeWired({ attributes: ['region', 'tags', 'varietal']});

		setData(data);
		const results = search.findSimilar(at(data, 0), { k: 3 });

		expect(results.length).toBe(3);
	});

	it('defaults to k=5 when no k is provided', () => {
		const data: Wine[] = [];

		for (let i = 0; i < 12; i++) {
			data.push({ id: i, region: 'napa', tags: ['oak', 'bold'], varietal: 'cabernet' });
		}
		const { search, setData } = makeWired({ attributes: ['region', 'tags', 'varietal']});

		setData(data);
		expect(search.findSimilar(at(data, 0)).length).toBe(5);
	});

	it('honors a per-call threshold override that excludes the outlier', () => {
		const { search } = makeWired({ attributes: ['region', 'tags', 'varietal'], threshold: 0 });
		const query = at(makeWines(), 0);

		// Bumping the override to 0.99 keeps only the identical wine.
		const strict = search.findSimilar(query, { threshold: 0.99 });

		expect(strict.every((r) => r.similarity >= 0.99)).toBe(true);
		expect(strict.some((r) => r.item.id === 2)).toBe(true);
	});

	it('applies the config threshold default when no override is given', () => {
		const { search } = makeWired({ attributes: ['region', 'tags', 'varietal'], threshold: 0.99 });
		const query = at(makeWines(), 0);
		const results = search.findSimilar(query);

		expect(results.every((r) => r.similarity >= 0.99)).toBe(true);
	});

	it('falls back to the 0.5 default threshold when config omits one', () => {
		const { search } = makeWired({ attributes: ['region', 'tags', 'varietal']});
		const query = at(makeWines(), 0);
		const results = search.findSimilar(query);

		expect(results.every((r) => r.similarity >= 0.5)).toBe(true);
	});

	it('returns an empty array when no candidate passes the threshold', () => {
		const { search } = makeWired({ attributes: ['tags'], threshold: 1 });
		// Query a hypothetical wine whose tags exist in no dataset item.
		const ghost: Wine = { id: 99, region: 'y', tags: ['ghost-only-tag'], varietal: 'x' };

		expect(search.findSimilar(ghost)).toEqual([]);
	});

	it('excludes an LSH candidate whose similarity is below the threshold', () => {
		// bandSize 1 (128 single-slot bands) makes any real overlap a near-certain bucket collision,
		// so wine 2 is always a candidate for wine 1 — but they share only ~half their features.
		const data: Wine[] = [
			{ id: 1, region: 'napa', tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], varietal: 'cabernet' },
			{ id: 2, region: 'napa', tags: ['a', 'b', 'c', 'd', 'w', 'x', 'y', 'z'], varietal: 'cabernet' },
		];
		const { search, setData } = makeWired({
			attributes: ['region', 'tags', 'varietal'],
			bandSize: 1,
			threshold: 0,
		});

		setData(data);
		const query = at(data, 0);

		// Threshold 0: wine 2 IS a candidate and surfaces — proving the bucket collision (so the
		// exclusion below is via the threshold arm, not an absence of candidates).
		expect(search.findSimilar(query).some((r) => r.item.id === 2)).toBe(true);

		// Threshold 0.9: wine 2 is still a candidate but its similarity is far below 0.9, so it is
		// rejected by the `sim >= threshold` false arm (results empty; wine 1 is identity-skipped).
		search.configure({ attributes: ['region', 'tags', 'varietal'], bandSize: 1, threshold: 0.9 });
		expect(search.findSimilar(query)).toEqual([]);
	});

	it('skips a candidate index whose data slot became undefined after indexing', () => {
		// Build the index over a full corpus, then poke a hole at index 1 WITHOUT bumping the
		// version. The LSH still holds index 1 as a candidate, but `items[1]` is now undefined —
		// exercising the `candidate === undefined` guard in the candidate loop.
		const data: (Wine | undefined)[] = makeWines();
		const search = new SimilaritySearch<Wine>({
			config: { attributes: ['region', 'tags', 'varietal'], threshold: 0 },
			getSourceData: () => data as readonly Wine[],
			getSourceDataVersion: () => 1,
		});
		const query = at(data as Wine[], 0);

		search.findSimilar(query); // builds the index with all three wines
		data[1] = undefined; // stale corpus behind a fixed version
		const results = search.findSimilar(query);

		// Wine 2 (now undefined) must not surface; the query (wine 1) is still identity-skipped.
		expect(results.some((r) => r.item.id === 2)).toBe(false);
		expect(results.every((r) => r.item.id !== 1)).toBe(true);
	});
});

describe('SimilaritySearch.findSimilarByFeatureSet', () => {
	it('finds items matching a hypothetical feature set', () => {
		const { search } = makeWired({ attributes: ['region', 'tags', 'varietal'], threshold: 0.5 });
		const featureSet = new Set([
			'varietal:cabernet',
			'region:napa',
			'tags:oak',
			'tags:tannic',
			'tags:bold',
			'tags:cherry',
		]);
		const results = search.findSimilarByFeatureSet(featureSet);

		// Both wines 1 and 2 share this exact feature set → both surface (identity not filtered).
		expect(results.some((r) => r.item.id === 1)).toBe(true);
		expect(results.some((r) => r.item.id === 2)).toBe(true);
	});

	it('defaults k to 5 and respects a k override', () => {
		const data: Wine[] = [];

		for (let i = 0; i < 8; i++) {
			data.push({ id: i, region: 'napa', tags: ['oak'], varietal: 'cabernet' });
		}
		const { search, setData } = makeWired({ attributes: ['region', 'tags', 'varietal']});

		setData(data);
		const featureSet = new Set(['varietal:cabernet', 'region:napa', 'tags:oak']);

		expect(search.findSimilarByFeatureSet(featureSet).length).toBe(5);
		expect(search.findSimilarByFeatureSet(featureSet, { k: 2 }).length).toBe(2);
	});

	it('honors a per-call threshold override', () => {
		const { search } = makeWired({ attributes: ['region', 'tags', 'varietal'], threshold: 0 });
		const featureSet = new Set(['varietal:nonsense', 'region:nowhere']);
		const results = search.findSimilarByFeatureSet(featureSet, { threshold: 0.99 });

		expect(results).toEqual([]);
	});

	it('falls back to the config / default threshold', () => {
		const { search } = makeWired({ attributes: ['region', 'tags', 'varietal']});
		const featureSet = new Set([
			'varietal:cabernet',
			'region:napa',
			'tags:oak',
			'tags:tannic',
			'tags:bold',
			'tags:cherry',
		]);
		const results = search.findSimilarByFeatureSet(featureSet);

		expect(results.every((r) => r.similarity >= 0.5)).toBe(true);
	});

	it('excludes a feature-set candidate whose similarity is below the threshold', () => {
		// bandSize 1 guarantees wine 1 is a candidate for a partially-overlapping feature set.
		const data: Wine[] = [
			{ id: 1, region: 'napa', tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], varietal: 'cabernet' },
		];
		const { search, setData } = makeWired({
			attributes: ['region', 'tags', 'varietal'],
			bandSize: 1,
			threshold: 0,
		});

		setData(data);
		const partial = new Set([
			'region:napa',
			'varietal:cabernet',
			'tags:a',
			'tags:b',
			'tags:w',
			'tags:x',
			'tags:y',
			'tags:z',
		]);

		// Threshold 0: wine 1 surfaces — confirming the bucket collision.
		expect(search.findSimilarByFeatureSet(partial).some((r) => r.item.id === 1)).toBe(true);

		// Threshold 0.9: wine 1 is a candidate but below threshold, so the `sim >= threshold`
		// false arm rejects it.
		search.configure({ attributes: ['region', 'tags', 'varietal'], bandSize: 1, threshold: 0.9 });
		expect(search.findSimilarByFeatureSet(partial)).toEqual([]);
	});

	it('skips a candidate index whose data slot became undefined after indexing', () => {
		const data: (Wine | undefined)[] = makeWines();
		const search = new SimilaritySearch<Wine>({
			config: { attributes: ['region', 'tags', 'varietal'], threshold: 0 },
			getSourceData: () => data as readonly Wine[],
			getSourceDataVersion: () => 1,
		});
		const featureSet = new Set([
			'varietal:cabernet',
			'region:napa',
			'tags:oak',
			'tags:tannic',
			'tags:bold',
			'tags:cherry',
		]);

		search.findSimilarByFeatureSet(featureSet); // builds the index
		data[1] = undefined; // poke a hole behind the fixed version
		const results = search.findSimilarByFeatureSet(featureSet);

		// Item 1 (wine id 2, now undefined) must not surface; item 0 (wine id 1) still does.
		expect(results.some((r) => r.item.id === 2)).toBe(false);
		expect(results.some((r) => r.item.id === 1)).toBe(true);
	});
});
