/**
 * Books MSW handlers — `GET /api/books` and friends.
 *
 * @remarks
 * Thin wrapper around `createDatasetHandlers`.
 *
 * **Import-safe by construction** — the same doctrine `./wine/handlers.ts` documents. Every loader
 * below is a DYNAMIC import, so pulling this module (or the `../handlers.js` barrel, which pulls all
 * three datasets) costs nothing until a request actually arrives. That matters because the barrel is
 * what the example apps hand to `setupWorker`, on the main thread, before first render: a static
 * `import { books } from './data.js'` would materialize the ~10k corpus during MSW setup on every
 * route — including routes that never touch books. `./filter-config.js` goes lazy for the same
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
 * MSW request handlers for the books dataset.
 */
export const booksHandlers: readonly MswHandlerLike[] = createDatasetHandlers({
	basePath: '/api/books',
	loadDefaultRecords: async () => (await import('./data.js')).books,
	loadFilterConfig: async () => (await import('./filter-config.js')).booksFilterConfig,
	loadFullRecords: async () => (await import('./data.js')).loadFullBooks(),
});
