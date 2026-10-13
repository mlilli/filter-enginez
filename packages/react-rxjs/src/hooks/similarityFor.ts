/**
 * `similarityFor` — one lazily-attached `SimilaritySearch` per engine.
 *
 * @remarks
 * The engine has no `similarity` property: `similarity/` lives behind the
 * `@filter-enginez/core/similarity` subpath so apps that never ask for a neighbor don't pay its
 * 1.65 kB gzipped.
 *
 * **The cost falls on the people who opt in.** Importing this module pulls MinHash and LSH into
 * `react-rxjs`, which is exactly right: a bundle containing `useSimilar` wants a similarity search,
 * and a bundle without it ships neither.
 *
 * ### Why a WeakMap rather than a hook-local `useMemo`
 *
 * The search owns a lazily-built index keyed on `sourceDataVersion`. One instance per ENGINE keeps
 * that index shared across every component calling `useSimilar`; a `useMemo` would give each caller
 * its own, rebuilding the same index once per mounted component. Weak keys mean a discarded engine
 * takes its index with it rather than pinning the corpus alive for the life of the page.
 *
 * @packageDocumentation
 */

import {
	attachSimilarity,
	type SimilarityConfig,
	type SimilaritySearch,
} from '@filter-enginez/core/similarity';

/** Engine core → its similarity search. @internal */
const ATTACHED = new WeakMap<object, SimilaritySearch<unknown>>();

/**
 * The similarity search for an engine, attaching one on first use.
 *
 * @typeParam T - The item type the engine operates over.
 * @param core - The engine core to search over.
 * @param config - Signature configuration, applied only when this call is the one that attaches.
 *   Omit it and `findSimilar` throws until configured.
 * @returns The search bound to `core`.
 */
export function similarityFor<T>(
	core: Parameters<typeof attachSimilarity<T>>[0],
	config?: SimilarityConfig<T>,
): SimilaritySearch<T> {
	const existing = ATTACHED.get(core);

	if (existing !== undefined) {
		return existing as SimilaritySearch<T>;
	}
	const created = attachSimilarity<T>(core, config);

	ATTACHED.set(core, created as SimilaritySearch<unknown>);

	return created;
}
