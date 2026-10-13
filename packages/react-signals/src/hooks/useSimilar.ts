/**
 * `useSimilar` — hook surface over the engine's MinHash + LSH similarity search. Finds the
 * top-k items most similar to a given anchor item.
 *
 * @remarks
 * Per `docs/architecture.md` §12.1 + §7.3. The "more like this" affordance — typical use
 * is a "similar wines" panel on a wine detail page, or "related listings" on a real-estate
 * detail page. Pre-computed signatures + LSH bucketing keep query cost sub-linear in
 * dataset size.
 *
 * **Re-evaluation triggers.** Subscribes to `sourceData` because adding/removing items can
 * change which neighbors land in the top-k. Does NOT subscribe to `activeRules` because
 * similarity is independent of which filters are currently selected — similarity operates
 * over the full source data, not the filtered subset.
 *
 * **Similarity configuration is passed to this hook**, not to the engine. `similarity/` stays out of
 * the engine's import graph so that apps which never search for neighbors don't pay for MinHash +
 * LSH; the search is attached lazily, once per engine, by the first `useSimilar` call
 * after construction. Without it, this hook throws a clear error pointing back to the
 * configuration call.
 *
 * @packageDocumentation
 */

import type { SimilarityConfig, SimilarityQuery, SimilarityResult } from '@filter-enginez/core/similarity';

import { useMemo } from 'react';

import { similarityFor } from './similarityFor.js';
import { useFilterEngine } from './useFilterEngine.js';
import { useSignal } from './useSignal.js';

/**
 * Get the top-k items most similar to `anchor` in the engine's current source data.
 *
 * @typeParam T - The item type the engine operates over
 * @param anchor - The query item — typically the item the user is currently viewing
 * @param options - Optional per-call query options (k, threshold override)
 * @returns Array of `{ item, similarity }` sorted by similarity descending, length ≤ k
 *
 * @example
 *   function SimilarWinesPanel({ wine }: { wine: Wine }) {
 *     const similar = useSimilar(wine, { k: 5 });
 *     return (
 *       <aside>
 *         <h4>You might also like…</h4>
 *         {similar.map(({ item, similarity }) => (
 *           <WineCard key={item.id} wine={item} similarity={similarity} />
 *         ))}
 *       </aside>
 *     );
 *   }
 */
export function useSimilar<T = unknown>(
	anchor: T,
	options?: SimilarityQuery,
	config?: SimilarityConfig<T>,
): readonly SimilarityResult<T>[] {
	const engine = useFilterEngine<T>();

	useSignal(engine.sourceData);

	// Memoize by (anchor identity, k, threshold). The underlying SimilaritySearch caches
	// per-item signatures by sourceDataVersion, so repeat calls within a single sourceData
	// state are cheap (anchor signature compute + LSH bucket lookup + Jaccard verification).
	return useMemo(
		() => similarityFor<T>(engine.core, config).findSimilar(anchor, options) as readonly SimilarityResult<T>[],
		[engine, anchor, options?.k, options?.threshold],
	);
}
