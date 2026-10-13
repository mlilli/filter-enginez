/**
 * Real-estate MSW handlers — `GET /api/real-estate` and friends.
 *
 * @remarks
 * Thin wrapper around `createDatasetHandlers` from
 * `../handler-factory.ts` — the heavy lifting (CRUD + pagination + full-tier lazy load +
 * slow/fail simulators) is generic; this file just supplies the dataset's identity.
 *
 * **Import-safe by construction** — the same doctrine `./wine/handlers.ts` documents. Every loader
 * below is a DYNAMIC import, so pulling this module (or the `../handlers.js` barrel, which pulls all
 * three datasets) costs nothing until a request actually arrives. That matters because the barrel is
 * what the example apps hand to `setupWorker`, on the main thread, before first render: a static
 * `import { listings } from './data.js'` would materialize the ~10k corpus during MSW setup on every
 * route — including routes that never touch real estate. `./filter-config.js` goes lazy for the same
 * reason: it statically imports `./data.js` to derive its vocabularies, so eager-importing the config
 * would drag the corpus in through the back door and defeat the seam.
 *
 * `createDatasetHandlers` memoizes each loader's promise, so the dynamic import resolves exactly once
 * per dataset per page load.
 *
 * @packageDocumentation
 */

import { createDatasetHandlers, type MswHandlerLike } from '../handler-factory.js';

/**
 * MSW request handlers for the real-estate dataset.
 */
export const realEstateHandlers: readonly MswHandlerLike[] = createDatasetHandlers({
	basePath: '/api/real-estate',
	loadDefaultRecords: async () => (await import('./data.js')).listings,
	loadFilterConfig: async () => (await import('./filter-config.js')).realEstateFilterConfig,
	loadFullRecords: async () => (await import('./data.js')).loadFullListings(),
});
