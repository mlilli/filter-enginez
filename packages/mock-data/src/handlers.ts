/**
 * Combined MSW handlers — exposed at `@filter-enginez/mock-data/handlers` per the package's
 * exports map.
 *
 * @remarks
 * Consumers wiring all three datasets at once
 * (typical for the example apps) import from here; consumers wanting only one dataset import
 * from `/real-estate`, `/wine`, or `/books`.
 *
 * **Same handlers, two environments, zero dev-vs-test drift.** Apps wire these via
 * `setupWorker(...allHandlers).start()`; tests wire them via `setupServer(...allHandlers)`.
 *
 * @packageDocumentation
 */

import type { MswHandlerLike } from './handler-factory.js';

import { booksHandlers } from './books/handlers.js';
import { realEstateHandlers } from './real-estate/handlers.js';
import { wineHandlers } from './wine/handlers.js';

/**
 * All MSW handlers across all three datasets, in a single flat array.
 */
export const allHandlers: readonly MswHandlerLike[] = [
	...realEstateHandlers,
	...wineHandlers,
	...booksHandlers,
];

// Re-export the per-dataset arrays for consumers who want to wire selectively.
export { realEstateHandlers } from './real-estate/handlers.js';
export { wineHandlers } from './wine/handlers.js';
export { booksHandlers } from './books/handlers.js';
