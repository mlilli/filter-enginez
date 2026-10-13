/**
 * `similarity-find` — time a top-k "find similar" lookup via MinHash + LSH over the wine tasting
 * notes. The LSH index is built once (warmed in `setup`); the timed call is the per-query cost:
 * signature → bucket lookup → exact-Jaccard verify → top-k. No acceleration axes apply (the
 * similarity engine has its own index, independent of the bitmap stack), so the matrix is one cell.
 *
 * @packageDocumentation
 */
import type { Wine } from '@filter-enginez/mock-data/wine';

import { createFilterEngine } from '@filter-enginez/core';
import { attachSimilarity } from '@filter-enginez/core/similarity';

import type { CorpusTier } from '../corpus.js';
import type { Scenario, ScenarioCell } from '../scenario.js';

import { consume } from '../sink.js';

/** Top-k neighbors to retrieve per query. */
const TOP_K = 5;

export const similarityFindScenario: Scenario = {
	applicableAxes: [],
	description: 'Find the top-k most similar items via MinHash + LSH over tasting-note signatures.',
	id: 'similarity-find',
	setup(tier: CorpusTier): ScenarioCell {
		const engine = createFilterEngine<Wine>({ sourceData: tier.data });
		// `similarity` left the engine's constructor so that consumers who never search for neighbors
		// stop shipping MinHash + LSH.
		// The benchmark is exactly such a consumer, so it opts in explicitly.
		const similarity = attachSimilarity<Wine>(engine, {
			attributes: ['body', 'color', 'tastingNotes', 'varietal'],
			threshold: 0.3,
		});

		const query = tier.data[0];

		if (query === undefined) {
			throw new Error('@filter-enginez/benchmarks: similarity-find needs a non-empty corpus.');
		}

		// Warm the LSH index (the first findSimilar builds it) so the timed call is query-only.
		similarity.findSimilar(query, { k: TOP_K });

		const run = (): void => {
			consume(similarity.findSimilar(query, { k: TOP_K }).length);
		};

		return {
			run,
			async teardown(): Promise<void> {
				await engine.destroy();
			},
		};
	},
	title: 'Similarity find',
};
