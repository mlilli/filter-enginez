/**
 * `useSimilar` — hook surface over the engine's MinHash + LSH similarity search. Mirror of
 * `react-signals/useSimilar` over the RxJS adapter.
 *
 * @remarks
 * Per `docs/architecture.md` §12.2 + §7.3. Subscribes to `sourceData$` (changes which
 * neighbors land in top-k); does NOT subscribe to `activeRules$` (similarity operates over
 * full corpus, not filtered subset).
 *
 * @packageDocumentation
 */

import type { SimilarityConfig, SimilarityQuery, SimilarityResult } from '@filter-enginez/core/similarity';

import { useMemo } from 'react';

import { similarityFor } from './similarityFor.js';
import { useFilterEngine } from './useFilterEngine.js';
import { useObservable } from './useObservable.js';

/**
 * Get the top-k items most similar to `anchor` in the engine's current source data.
 *
 * @typeParam T - The item type the engine operates over
 * @param anchor - The query item
 * @param options - Optional per-call query options (k, threshold override)
 * @returns Array of `{ item, similarity }` sorted by similarity descending, length ≤ k
 */
export function useSimilar<T = unknown>(
	anchor: T,
	options?: SimilarityQuery,
	config?: SimilarityConfig<T>,
): readonly SimilarityResult<T>[] {
	const engine = useFilterEngine<T>();

	useObservable(engine.sourceData$, engine.core.getSourceData());

	return useMemo(
		() => similarityFor<T>(engine.core, config).findSimilar(anchor, options) as readonly SimilarityResult<T>[],
		[engine, anchor, options?.k, options?.threshold],
	);
}
