/**
 * Shared types used across all three mock datasets.
 *
 * @remarks
 * Every dataset record gets a `string` id, a `DatasetTier`
 * marker (so consumers / handlers can branch on "is this from the stratified 10k or the full
 * corpus?"), and a `lastUpdated` ISO timestamp (some example affordances sort by recency).
 *
 * @packageDocumentation
 */

/**
 * Which tier a record belongs to.
 *
 * - `'default'` — part of the stratified ~10k default sample (committed to git)
 * - `'full'` — part of the full corpus tier (gitignored, generated on demand by
 *   `pnpm regen:mock-data --full`)
 */
export type DatasetTier = 'default' | 'full';

/**
 * Common fields every dataset record carries.
 *
 * @remarks
 * Datasets compose this via intersection (`type Wine = BaseRecord & { ... wine fields }`)
 * so all three datasets share the same identifier + recency vocabulary without inheriting
 * each other's domain fields.
 */
export interface BaseRecord {
	/** Stable per-record identifier — slug-style for human-readable URLs. */
	readonly id: string;

	/** ISO-8601 timestamp of last update — used by recency-sorted example affordances. */
	readonly lastUpdated: string;

	/** Which tier the record was sampled into. */
	readonly tier: DatasetTier;
}

/**
 * Pagination envelope returned by the MSW `?limit=&offset=` handler form. Example pages that
 * lazy-load (the wine app's infinite-scroll variant, the real-estate "load more results"
 * pattern) consume this shape.
 */
export interface PagedResponse<T> {
	readonly items: readonly T[];
	readonly limit: number;
	readonly offset: number;
	readonly total: number;
}

/**
 * Standard error shape returned by MSW handlers when a full-tier dataset isn't generated
 * locally (consumers run `pnpm regen:mock-data --full` to populate). Matches the JSON:API
 * error-object shape so apps can reuse a generic error toast.
 */
export interface DatasetMissingError {
	readonly code: 'DATASET_NOT_GENERATED';
	readonly hint: string;
	readonly message: string;
}
