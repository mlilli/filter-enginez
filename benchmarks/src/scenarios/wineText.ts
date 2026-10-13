/**
 * Shared field extractor for the wine-corpus text benchmark scenarios — factored out so the
 * `text-search-query` and `fuzzy-search-query` scenarios resolve the same searchable field the same
 * way (a stable reference, so the engine's inverted index caches one posting set per corpus).
 *
 * @packageDocumentation
 */
import type { Wine } from '@filter-enginez/mock-data/wine';

/** Join a wine's tasting-note descriptors into one searchable string. */
export function tastingNotesText(wine: Wine): string {
	return wine.tastingNotes.join(' ');
}
