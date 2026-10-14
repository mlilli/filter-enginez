/**
 * Wine MSW handlers — `GET /api/wine` and friends.
 *
 * @remarks
 * Thin wrapper around `createDatasetHandlers`.
 *
 * **Import-safe by construction.** This module imports ONLY the lazy `./corpusLoaders.js` + the pure
 * `./filter-config.js` — never `./data.js`. That is deliberate: `data.ts` does a module-load `await`
 * that materializes the ~9 MB default corpus, and pulling it into the MSW-setup graph (which runs on
 * the main thread) OOM'd the Vite dev server. Here the default corpus + its filter config are both
 * behind lazy loaders, so setting up these handlers costs nothing until the first request.
 *
 * @packageDocumentation
 */

import { createDatasetHandlers, type MswHandlerLike } from '../handler-factory.js';
import { loadDefaultWines } from './corpusLoaders.js';
import { buildWineFilterConfig } from './filter-config.js';

/**
 * MSW request handlers for the wine dataset.
 *
 * @remarks
 * **`loadFullRecords` returns `null` on purpose — the full tier is NOT servable via MSW.** These
 * handlers run in the browser (MSW's resolver executes on the main thread). With the local real
 * corpus present, `loadFullWines`'s `import('./data-real-full.json')` makes Vite's dev server
 * transform the ~116 MB JSON on the fly, which runs it out of memory; without it, generating 150k
 * records in a main-thread resolver would freeze the page. Either way it would invert the very
 * worker offload the full tier exists for. So MSW serves only the default (~10k) tier; the full tier
 * is generated inside the worker (`@filter-enginez/mock-data/wine/generator`), and a `?tier=full`
 * request here 404s cleanly (`DATASET_NOT_GENERATED`).
 */
export const wineHandlers: readonly MswHandlerLike[] = createDatasetHandlers({
	basePath: '/api/wine',
	loadDefaultRecords: loadDefaultWines,
	loadFilterConfig: async () => buildWineFilterConfig(await loadDefaultWines()),
	loadFullRecords: () => null,
});
