/**
 * Wine dataset — the **eager** default-tier corpus + its derived filter config.
 *
 * @remarks
 * What ships is **synthetic**: the seeded procedural generator in `./generate.ts`. The one exception
 * is local to a development checkout — after `pnpm regen:wine:real --accept-data-license` downloads
 * the Kaggle "Wine Reviews" dataset (scraped from WineEnthusiast in 2017, ~130k rows), the loader
 * prefers that corpus when it runs under Vite's module runner (vitest). 🔴 That dataset is licensed
 * **CC BY-NC-SA 4.0**, so its JSON is gitignored, never packaged, and stripped from example-app
 * production builds; every other consumer gets the synthetic generator. The loader logic lives in
 * {@link module:wine/corpusLoaders} so it can be imported lazily (by the MSW handlers) without
 * triggering the module-load `await` below.
 *
 * This module `await`s the default tier at its top so it can offer the ergonomic **synchronous**
 * `wines` array (and the derived `wineFilterConfig`) that the engine/worker boot paths import
 * directly. That eager cost — generating 10k records, or parsing the ~9 MB real-data JSON when it is
 * present locally — is intentionally isolated HERE: modules that only need a lazy corpus (the
 * streaming handlers) import {@link module:wine/corpusLoaders} + the pure
 * {@link module:wine/filter-config} instead, and never pay it. That isolation is what keeps the MSW
 * streaming path from running out of memory.
 *
 * @packageDocumentation
 */

import type { Wine } from './types.js';

import { loadDefaultWines } from './corpusLoaders.js';
import { buildWineFilterConfig } from './filter-config.js';

/**
 * The default-tier wine dataset. Synthetic procedural generator output (10k), except in a local
 * checkout where the real-data import script has been run and the module runs under Vite's module
 * runner (vitest) — there it is a 10k stratified sample of the locally downloaded Kaggle corpus.
 * Either way the type is identical and consumer code doesn't branch. Resolved via a module-load
 * `await` (Vite + Node 22 both support it; the wine engine's consumers already `await` acceleration
 * init at their own module tops).
 */
export const wines: readonly Wine[] = await loadDefaultWines();

/**
 * The wine `FilterEngineConfig`, derived from the eager bootstrap corpus — the origin tree +
 * varietal set reflect the actual `wines` above. Streaming consumers that want a config for a
 * different tier call `buildWineFilterConfig(corpus)` from `./filter-config.js` directly.
 */
export const wineFilterConfig = buildWineFilterConfig(wines);

// Re-export the lazy full-tier loader so consumers importing it from `./data.js`
// (and the `@filter-enginez/mock-data/wine` barrel) resolve it here.
export { loadFullWines } from './corpusLoaders.js';
