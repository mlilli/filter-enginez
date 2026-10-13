/**
 * Canonical tier-size constants for the three datasets.
 *
 * @remarks
 * Single source of truth for "how many records per tier per dataset" — keeps the README
 * claims ("10k+ default, 130k+ full"), the bootstrap `data.ts` generators, the `regen.mjs`
 * CLI script, the worker-bridge auto-engagement threshold tuning, and the benchmark suite
 * all in agreement. Bumping these numbers in one place rolls through every consumer.
 *
 * **Why the uniform 10k default but varied full tiers.** The default tier is generated at load
 * time by the seeded generators (no data files ship), and a uniform 10k keeps load cost and
 * facet variety predictable across datasets. The full tier is the same synthetic generators run at larger
 * counts, gitignored and generated on demand, so each dataset's full size can be chosen to echo
 * a real-world corpus scale: wine's full tier matches the Kaggle Wine Reviews dataset's row
 * count, books is sized like a sampled OpenLibrary slice, and real-estate like a
 * metropolitan-statistical-area slice of listings. No records from those sources are included.
 *
 * **Worker-bridge interaction.** The `worker-bridge` auto-engagement threshold defaults to
 * 50,000 items (see `@filter-enginez/worker-bridge` `DEFAULT_AUTO_THRESHOLD`). The default
 * tier (10k) sits comfortably below — engine runs on the main thread. The full tier crosses
 * the threshold for every dataset, which is intentional: the full tier IS the worker-
 * engagement demo. Consumers loading the wine full tier (130k) trigger the worker path
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
 * Per-dataset full-tier sizes. Each one crosses the worker-bridge auto-engagement
 * threshold (50k), so loading any dataset's full tier triggers the worker path
 * automatically — the full tier IS the worker-engagement demo.
 *
 * Sized to echo the scale of the public datasets the generators are shaped after (the full tier
 * `pnpm regen:mock-data --full` writes is still entirely synthetic):
 *   - **Wine: 130k** — the approximate Kaggle Wine Reviews dataset size (also the size of the
 *     optional, local-only real corpus — see `wine/corpusLoaders.ts`)
 *   - **Real-estate: 50k** — metropolitan-statistical-area scale, the worker auto-engage
 *     floor exactly so the demo just barely trips the threshold
 *   - **Books: 100k** — the scale of a sampled slice of OpenLibrary's 25M-record corpus, large
 *     enough to exercise the MinHash similarity index at meaningful scale
 */
export const FULL_TIER_SIZES = {
	books: 100_000,
	'real-estate': 50_000,
	wine: 130_000,
} as const;

/**
 * Convenience union type — names match the `FULL_TIER_SIZES` keys.
 */
export type DatasetName = keyof typeof FULL_TIER_SIZES;
