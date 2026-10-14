/**
 * Wine dataset sub-export — `@filter-enginez/mock-data/wine`.
 *
 * @packageDocumentation
 */

export {
	type Wine,
	type WineBody,
	type WineColor,
	type WineOrigin,
	type WineSweetness,
} from './types.js';

export { loadFullWines, wineFilterConfig, wines } from './data.js';
export { loadDefaultWines } from './corpusLoaders.js';
export { generateWineRange, generateWines, WINE_GENERATOR_SEED } from './generate.js';
export { buildOriginTree, buildWineFilterConfig, getWineFilterConfig } from './filter-config.js';
// `wineHandlers` is intentionally NOT re-exported from this barrel. Pulling it in here
// drags MSW (which depends on `localStorage` via its cookieStore module) into every
// consumer's import graph — including Web Worker bundles where `localStorage` doesn't
// exist and MSW init throws at module-evaluation time with "Failed to create a CookieStore".
// Consumers wanting handlers reach for the dedicated `@filter-enginez/mock-data/handlers`
// sub-export, which imports from `./wine/handlers.js` directly.
