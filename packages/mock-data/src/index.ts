/**
 * @filter-enginez/mock-data
 *
 * Three mock datasets at ~10,000 records each (with opt-in full tier). Every record this package
 * ships is **synthetic**, produced by seeded procedural generators shaped by public reference
 * distributions — no third-party data is included:
 *
 *   - **Real estate** — synthetic addresses + coordinates inside curated metro bounding boxes,
 *     hand-picked neighborhoods + school districts, and prices centered on approximate 2024
 *     Zillow Home Value Index metro medians
 *   - **Wine** — varietals weighted roughly like the Kaggle Wine Reviews dataset, a hand-curated
 *     origin hierarchy, and tasting notes from a curated descriptor library weighted by
 *     varietal-typicality
 *   - **Books** — OpenLibrary-shaped records (subject tags, edition-ID format) with valid ISBN-13
 *     check digits, built from curated word lists
 *
 * ⚠ Wine alone has an optional real-data path, local to a development checkout: the Kaggle "Wine
 * Reviews" dataset (CC BY-NC-SA 4.0) can be downloaded with `pnpm regen:wine:real
 * --accept-data-license`. It is gitignored, never packaged, and stripped from example-app
 * production builds.
 *
 * Plus MSW handlers serving both the example apps and the test suite — same handlers, two
 * environments, zero test-vs-dev drift. Isomorphic.
 *
 * @remarks
 * Type schemas, filter configs, MSW handler factories, and the per-dataset sub-export structure
 * all land here. No data files ship: the default tier is generated at module load from fixed
 * seeds, and `pnpm regen:mock-data --full` writes the gitignored full tier from the same
 * generators.
 *
 * @packageDocumentation
 */

// Shared types
export {
	type BaseRecord,
	type DatasetMissingError,
	type DatasetTier,
	type PagedResponse,
} from './shared.js';

// Tier-size constants — single source of truth for "how many records per tier per dataset"
export {
	type DatasetName,
	DEFAULT_TIER_SIZE,
	FULL_TIER_SIZES,
} from './tier-sizes.js';

// Per-dataset re-exports
export * from './real-estate/index.js';
export * from './wine/index.js';
export * from './books/index.js';

// Combined handlers
export { allHandlers } from './handlers.js';

// Handler factory (exposed for consumers building their own custom datasets atop the same
// MSW handler pattern — typical for downstream apps adding a fourth dataset specific to
// their product, e.g., the wine app's `WineFellaz` profile dataset).
export {
	createDatasetHandlers,
	type DatasetHandlerOptions,
	type MswHandlerLike,
} from './handler-factory.js';
