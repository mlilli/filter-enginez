/**
 * Construction-time option types for `FilterEngine` — split out of `FilterEngine.ts` so the
 * facade class stays within the file-size cap and the option surface has one clear home.
 *
 * @packageDocumentation
 */

import type { FilterEngineConfig } from './config/FilterEngineConfig.js';
import type { DevtoolsConfig } from './devtools/Devtools.js';

/**
 * Construction-time options for `FilterEngine`.
 */
export interface FilterEngineOptions<T> {
	/** Initial source data. Defaults to empty array. */
	readonly sourceData?: readonly T[];
	/** Optional devtools configuration. Pass `{ enabled: false }` to disable entirely. */
	readonly devtools?: DevtoolsConfig;
	/**
	 * Optional initial JSON config. Applied via `loadConfig` after construction. Mutually
	 * compatible with `sourceData` (sourceData lands first, then rules are loaded).
	 */
	readonly config?: FilterEngineConfig;
	/**
	 * Acceleration-stack configuration — a nested object grouping the engine's optimization
	 * toggles. Omit any key to take its default. See {@link AccelerationOptions}.
	 *
	 * @remarks
	 * The worker-offload axis is intentionally NOT here: the engine never spawns workers; worker
	 * offload is engaged from outside via `@filter-enginez/worker-bridge`'s `wrapInWorker`.
	 */
	readonly acceleration?: AccelerationOptions;
}

/**
 * Acceleration-stack toggles (per `docs/architecture.md` §6 + §19.2). Each optimization can be
 * switched independently, which powers both consumer tuning and the benchmark matrix. There is one
 * key per layer that has a toggle; a layer without one is absent from the type.
 */
export interface AccelerationOptions {
	/**
	 * Roaring-Bitmap filter intersection. `'auto'` (default) engages at source data ≥ 500 items;
	 * `'on'` always engages; `'off'` uses the per-item predicate evaluator (no bitmap path).
	 */
	readonly bitmap?: 'auto' | 'off' | 'on';
	/**
	 * Mutual-exclusion graph — the "would adding this filter empty the result set?"
	 * short-circuit. `'lazy'` (default) builds on first query; `'eager'` keeps the graph warm
	 * (precomputed after config-load + re-warmed after each invalidation) so the build cost
	 * lands off the interaction hot path; `'off'` disables the layer entirely.
	 *
	 * @remarks
	 * The exclusion graph is bitmap-derived — with `bitmap: 'off'` no bitmaps are built, so the
	 * graph stays correctly inert regardless of this setting.
	 */
	readonly exclusionGraph?: 'eager' | 'lazy' | 'off';
	/**
	 * LRU memoization of `engine.simulate()` results. `true` (default) caches by
	 * modification + active-rule + version fingerprint; `false` recomputes every call (the
	 * memoization layer's off-switch for the benchmark matrix).
	 */
	readonly simulationCache?: boolean;
	/**
	 * R-tree spatial index for `GeoProximityRule` bitmap builds. `'auto'` (default) uses the
	 * R-tree (bbox prune + exact haversine refinement) for positive-radius geo rules; `'off'`
	 * builds geo bitmaps by the per-item haversine scan. Only affects the bitmap-build path, so
	 * it's inert when `bitmap: 'off'`.
	 */
	readonly spatialIndex?: 'auto' | 'off';
	/**
	 * Inverted text index (word + character-trigram postings) for `TextSearchRule`'s `'allWords'`
	 * mode and `FuzzySearchRule`. `'auto'` (default) engages the index for an applicable text rule
	 * only once the source data is large enough to repay the posting-build cost (a measured floor);
	 * `'on'` forces it regardless of size (for known repeated-query workloads on smaller data);
	 * `'off'` evaluates those rules by the per-item predicate. When engaged it serves `'allWords'`
	 * authoritatively (an exact AND of word postings) and prunes fuzzy candidates via the sound
	 * trigram bound before the exact Fuse confirm. Substring / `'tokenized'` matching is never
	 * index-served (native `String.includes` already outperforms it).
	 */
	readonly textIndex?: 'auto' | 'off' | 'on';
}
