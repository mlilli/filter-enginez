/**
 * Books `FilterEngineConfig` — JSON-driven filter definition served by the MSW handler at
 * `GET /api/books/filter-config`.
 *
 * @remarks
 * The "clean license, README-friendly"
 * dataset — used as the canonical example in the engine's public docs because every record is
 * synthetic (OpenLibrary-shaped, but containing no OpenLibrary data), so example code can include
 * it inline with no third-party license to track.
 *
 * Exercises `InSetRule` (genre, language, format), `RangeRule` (page count, publication year),
 * `TextSearchRule` (title + description), `FuzzySearchRule` (authors with typo tolerance),
 * `BooleanRule` (isInPrint, hasAudiobook), `ExistsRule` (averageRating presence), and `RegexRule`
 * (a reader-supplied ISBN-13 pattern — empty by default).
 *
 * **A config is a filter STATE, not just a schema.** `loadConfig` activates every rule it declares,
 * so a config with, e.g., a `has-rating` `ExistsRule` boots already filtered to rated books — a
 * sensible default the consumer can clear. We deliberately do NOT declare a `rating` `RangeRule`
 * here: a range over a nullable field silently excludes nulls even at its full `[0, 5]` extent, and
 * reads as a no-op (no chip) — an invisible, unclearable filter. The rich `/books` route builds that
 * rating slider organically instead, where it's only active once the user narrows it.
 *
 * @packageDocumentation
 */

import { CURRENT_CONFIG_VERSION, type FilterEngineConfig } from '@filter-enginez/core';

import { books } from './data.js';

/**
 * Collect unique genres present in the corpus, sorted for stable UI ordering.
 *
 * @internal
 */
function collectUniqueGenres(): readonly string[] {
	return Array.from(new Set(books.map((b) => b.genre))).sort();
}

/**
 * Collect unique languages present in the corpus.
 *
 * @internal
 */
function collectUniqueLanguages(): readonly string[] {
	return Array.from(new Set(books.map((b) => b.language))).sort();
}

/**
 * The full filter config for the books dataset.
 */
export const booksFilterConfig: FilterEngineConfig = {
	groups: [
		{
			composition: 'and',
			displayName: 'Core filters',
			filterIds: ['genre', 'language', 'format', 'page-count', 'publication-year'],
			id: 'core',
		},
		{
			composition: 'and',
			displayName: 'Availability',
			filterIds: ['in-print', 'has-audiobook', 'has-rating'],
			id: 'availability',
		},
		{
			composition: 'and',
			displayName: 'Search',
			filterIds: ['text-search', 'author-search', 'isbn-format'],
			id: 'search',
		},
	],
	label: 'Books',
	metadata: {
		dataset: 'books',
		description: 'Procedurally-generated synthetic books — OpenLibrary-shaped distribution',
		primaryDimensions: ['genre', 'authors', 'publicationYear', 'pageCount', 'language'],
		uniqueGenres: collectUniqueGenres(),
		uniqueLanguages: collectUniqueLanguages(),
	},
	rules: [
		// ─── Genre / language / format facets ──────────────────────────────
		{
			id: 'genre',
			rule: {
				config: { set: [] satisfies readonly string[] },
				field: 'genre',
				type: 'InSetRule',
			},
		},
		{
			id: 'language',
			rule: {
				config: { set: [] satisfies readonly string[] },
				field: 'language',
				type: 'InSetRule',
			},
		},
		{
			id: 'format',
			rule: {
				config: { set: [] satisfies readonly string[] },
				field: 'format',
				type: 'InSetRule',
			},
		},

		// ─── Numeric ranges ────────────────────────────────────────────────
		{
			id: 'page-count',
			rule: {
				config: { max: 1500, min: 0 },
				field: 'pageCount',
				type: 'RangeRule',
			},
		},
		{
			id: 'publication-year',
			rule: {
				config: { max: 2025, min: 1900 },
				field: 'publicationYear',
				type: 'RangeRule',
			},
		},

		// ─── Booleans ──────────────────────────────────────────────────────
		{
			id: 'in-print',
			rule: {
				config: undefined,
				field: 'isInPrint',
				type: 'BooleanRule',
			},
		},
		{
			id: 'has-audiobook',
			rule: {
				config: undefined,
				field: 'hasAudiobook',
				type: 'BooleanRule',
			},
		},

		// ─── Rating existence (drives the "rated only" toggle) ──
		// `averageRating` is nullable, so requiring its presence is a meaningful filter — unlike
		// `coverImage`, a non-nullable string over which an Exists rule could never exclude anything.
		{
			id: 'has-rating',
			rule: {
				config: undefined,
				field: 'averageRating',
				type: 'ExistsRule',
			},
		},

		// ─── Text + fuzzy search ───────────────────────────────────────────
		{
			id: 'text-search',
			rule: {
				config: { caseSensitive: false, mode: 'substring', query: '' },
				field: 'description',
				type: 'TextSearchRule',
			},
		},
		{
			id: 'author-search',
			rule: {
				// Lower threshold (stricter) for authors since typos in author name are typical
				// — Vandermark vs Vandermere, Cromwell vs Crumwell — but the user usually has
				// the first few letters right.
				config: { query: '', threshold: 0.3 },
				field: 'authors',
				type: 'FuzzySearchRule',
			},
		},

		// ─── ISBN-13 regex search (the "advanced filter" affordance) ──
		// Ships with an EMPTY pattern so it boots as a neutral, no-op filter (an empty regex matches
		// every item) — the reader supplies a pattern like `^97[89]\d{10}$` to actually filter. A
		// non-empty default would silently pre-filter + show an un-clearable chip on load.
		{
			id: 'isbn-format',
			rule: {
				// Serialized (JSON-safe) regex form — `RegexRule.deserialize` reconstructs via
				// `new RegExp(source, flags)`. A raw `{ pattern: /…/ }` (the runtime config shape)
				// does NOT round-trip through a declarative config and fails to load.
				config: { flags: 'u', source: '' },
				field: 'isbn13',
				type: 'RegexRule',
			},
		},
	],
	version: CURRENT_CONFIG_VERSION,
};

export function getBooksFilterConfig(): FilterEngineConfig {
	return booksFilterConfig;
}
