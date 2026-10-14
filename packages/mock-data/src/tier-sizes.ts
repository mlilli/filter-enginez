/**
 * Canonical tier-size constants for the three datasets.
 *
 * @remarks
 * Single source of truth for "how many records per tier per dataset" — keeps the README
 * claims ("10k default, 150k wine full tier"), the bootstrap `data.ts` generators, the wine
 * generator's full-tier allocation, the `regen.mjs` CLI script, the worker-bridge
 * auto-engagement threshold tuning, and the benchmark suite all in agreement. Bumping these
 * numbers in one place rolls through every consumer.
 *
 * **Why the uniform 10k default but varied full tiers.** The default tier is generated at load
 * time by the seeded generators (no data files ship), and a uniform 10k keeps load cost and
 * facet variety predictable across datasets. The full tier is the same synthetic generators run at
 * larger counts, so each dataset's full size can be chosen to echo a real-world corpus scale: wine's
 * full tier is a little larger than the Kaggle Wine Reviews dataset its statistics are measured
 * from, books is sized like a sampled OpenLibrary slice, and real-estate like a
 * metropolitan-statistical-area slice of listings. No records from those sources are included.
 *
 * **Wine's full tier is generated, not stored.** `generateWines(FULL_WINE_TIER_SIZE)` produces it
 * in about a second, in Node or a browser Web Worker, so no wine data file exists to download.
 * Books and real estate write theirs to gitignored JSON with `pnpm regen:mock-data --full`.
 *
 * **Worker-bridge interaction.** The `worker-bridge` auto-engagement threshold defaults to
 * 50,000 items (see `@filter-enginez/worker-bridge` `DEFAULT_AUTO_THRESHOLD`). The default
 * tier (10k) sits comfortably below — engine runs on the main thread. The full tier crosses
 * the threshold for every dataset, which is intentional: the full tier IS the worker-
 * engagement demo. Consumers loading the wine full tier (150k) trigger the worker path
 * automatically; consumers loading the default tier never do.
 *
 * @packageDocumentation
 */

/**
 * Records per dataset in the default tier, generated at module load by the procedural
 * generators (byte-identical across runs via a seeded RNG).
 *
 * Sized so:
 *   - Every facet in the filter UI has plausible variety (multiple varietals, multiple
 *     metros, multiple genres represented)
 *   - Generation stays fast enough to run at module load in a browser
 *   - Below the 50k worker-bridge auto-engagement threshold — the examples demonstrate the main-
 *     thread engine path by default
 */
export const DEFAULT_TIER_SIZE = 10_000;

/**
 * Records in the wine full tier: `generateWines(FULL_WINE_TIER_SIZE)` from
 * `@filter-enginez/mock-data/wine/generator`.
 *
 * @remarks
 * The wine generator apportions exactly this many records across every measured (origin,
 * varietal) pair, so at this size every origin leaf and every varietal appears at its measured
 * share. It is above the 129,907 reviews those shares come from, which is what guarantees that
 * even a pairing seen once gets a record. The default tier is the first {@link DEFAULT_TIER_SIZE}
 * records of the same stream.
 */
export const FULL_WINE_TIER_SIZE = 150_000;

/**
 * Per-dataset full-tier sizes. Each one crosses the worker-bridge auto-engagement
 * threshold (50k), so loading any dataset's full tier triggers the worker path
 * automatically — the full tier IS the worker-engagement demo.
 *
 * Sized to echo the scale of the public datasets the generators are shaped after (every full tier
 * is entirely synthetic):
 *   - **Wine: 150k** — {@link FULL_WINE_TIER_SIZE}, a little above the 130k-row Kaggle Wine Reviews
 *     dataset its statistics come from (the optional, local-only real corpus is that dataset —
 *     see `wine/corpusLoaders.ts`)
 *   - **Real-estate: 50k** — metropolitan-statistical-area scale, the worker auto-engage
 *     floor exactly so the demo just barely trips the threshold
 *   - **Books: 100k** — the scale of a sampled slice of OpenLibrary's 25M-record corpus, large
 *     enough to exercise the MinHash similarity index at meaningful scale
 */
export const FULL_TIER_SIZES = {
	books: 100_000,
	'real-estate': 50_000,
	wine: FULL_WINE_TIER_SIZE,
} as const;

/**
 * Convenience union type — names match the `FULL_TIER_SIZES` keys.
 */
export type DatasetName = keyof typeof FULL_TIER_SIZES;
