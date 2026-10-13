/**
 * Books dataset types — `Book` and its supporting enums.
 *
 * @remarks
 * The "license-clean, README-friendly" dataset —
 * exercises `InSetRule` (genre, language), `RangeRule` (page count, publication year, rating),
 * `TextSearchRule` (title + description), `FuzzySearchRule` (author with typo tolerance),
 * `BooleanRule` (in-print, has-audiobook), `ExistsRule` (cover image present), `RegexRule`
 * (ISBN format validation in the "advanced filter" affordance).
 *
 * Provenance: every book is synthetic, produced by the seeded generator in `./generate.ts` —
 * there is no real-data path. Titles, authors, publishers, and subjects are drawn from curated
 * word lists; ISBN-13s carry valid check digits; `openLibraryId` is a random number in
 * OpenLibrary's edition-ID format, so any match with a real record is coincidental. With no
 * third-party data inside, it is safe to ship in any open-source context, which is why the engine
 * README + docs use it as the canonical example.
 *
 * @packageDocumentation
 */

import type { BaseRecord } from '../shared.js';

/**
 * Top-level genre classification — surfaced as a primary `InSetRule` facet.
 *
 * @remarks
 * Modeled on OpenLibrary, whose subject taxonomy is huge (thousands of subjects per book) — the
 * generator uses this controlled vocabulary instead, for the example filter UI. Books carry a `subjects: string[]`
 * alongside `genre` for the long-tail subject search.
 */
export type BookGenre =
	| 'biography'
	| 'business'
	| 'children'
	| 'cookbook'
	| 'fantasy'
	| 'fiction'
	| 'history'
	| 'mystery'
	| 'philosophy'
	| 'poetry'
	| 'reference'
	| 'romance'
	| 'science-fiction'
	| 'science'
	| 'thriller'
	| 'travel'
	| 'young-adult';

/** Book format — drives the "physical / ebook / audiobook" facet. */
export type BookFormat = 'audiobook' | 'ebook' | 'hardcover' | 'magazine' | 'paperback';

/**
 * A single book record.
 */
export interface Book extends BaseRecord {
	// ─── Identity ──────────────────────────────────────────────────────────
	readonly authors: readonly string[];
	readonly isbn13: string;
	readonly openLibraryId: string;
	readonly subtitle: string;
	readonly title: string;

	// ─── Classifications ───────────────────────────────────────────────────
	readonly format: BookFormat;
	readonly genre: BookGenre;
	readonly language: string;
	readonly subjects: readonly string[];

	// ─── Numerics ──────────────────────────────────────────────────────────
	readonly pageCount: number;
	readonly publicationYear: number;
	/** Synthetic popularity proxy, modeled on OpenLibrary's "want to read" count. */
	readonly popularityScore: number;
	/** Average user rating, 0-5. May be `null` if no ratings exist. */
	readonly averageRating: number | null;

	// ─── Booleans ──────────────────────────────────────────────────────────
	readonly hasAudiobook: boolean;
	readonly isInPrint: boolean;

	// ─── Marketing ─────────────────────────────────────────────────────────
	readonly coverImage: string;
	readonly description: string;
	readonly publisher: string;
}
