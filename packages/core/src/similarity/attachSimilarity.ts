/**
 * `attachSimilarity` — build a {@link SimilaritySearch} bound to an engine's source data.
 *
 * @remarks
 * This function exists so that `similarity/` stays out of the engine's static import graph.
 *
 * ## Why the engine does not own a `similarity` property
 *
 * If `FilterEngine` constructed a `SimilaritySearch` in its constructor, every consumer of
 * `createFilterEngine` — including one that never intends to ask "what is similar to this?" — would
 * ship MinHash, LSH and the orchestrator. Measured with `size-limit`, that is **1.65 kB gzipped**,
 * roughly a tenth of the whole package.
 *
 * A static `import` cannot be tree-shaken away when the imported value is constructed
 * unconditionally, so no bundler can drop it. The only ESM-honest options are a dynamic `import()`
 * — which would make `findSimilar` async and complicate the API for a byte count — or moving the
 * construction to the caller. This is the second.
 *
 * ## The shape of the trade
 *
 * ```ts
 * // the import is the opt-in, and it is the ONLY way to pay
 * import { attachSimilarity } from '@filter-enginez/core/similarity';
 * const similarity = attachSimilarity(engine, { attributes: ['color'] });
 * similarity.findSimilar(item);
 * ```
 *
 * The returned `SimilaritySearch` is wired to the engine's source-data and version accessors, so it
 * builds its index lazily on first query and invalidates in O(1) on a `sourceDataVersion` change.
 * The caller, not the engine, holds the reference.
 *
 * @packageDocumentation
 */

import type { InternalStore } from '../store/InternalStore.js';

import { type SimilarityConfig, SimilaritySearch } from './SimilaritySearch.js';

/**
 * The slice of an engine this needs.
 *
 * @remarks
 * Structural rather than `FilterEngine<T>`, and that is the point: importing the engine's type here
 * would put this module back in its import graph in the type layer, and — more practically — it
 * makes this attachable to the worker-side engine and to a test double without either pretending to
 * be a whole `FilterEngine`.
 */
export interface SimilarityAttachTarget<T> {
	/** The engine's internal store, which owns the source data and its version counter. */
	readonly store: Pick<InternalStore<T>, 'sourceData' | 'sourceDataVersion'>;
}

/**
 * Attach a similarity search to an engine.
 *
 * @remarks
 * Call this once and keep the result; calling it twice builds two independent indexes over the same
 * data, which is wasteful rather than wrong.
 *
 * @typeParam T - The item type the engine operates over.
 * @param engine - The engine whose source data to search. Only its `store` is read.
 * @param config - Signature configuration. Omit it and `findSimilar` throws until
 *   {@link SimilaritySearch.configure} supplies one — the same contract the engine's old
 *   `configureSimilarity` had, minus the delegation hop.
 * @returns The similarity search, bound to this engine's data.
 */
export function attachSimilarity<T>(
	engine: SimilarityAttachTarget<T>,
	config?: SimilarityConfig<T>,
): SimilaritySearch<T> {
	return new SimilaritySearch<T>({
		...(config === undefined ? {} : { config }),
		getSourceData: () => engine.store.sourceData.value,
		getSourceDataVersion: () => engine.store.sourceDataVersion.value,
	});
}
