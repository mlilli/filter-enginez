/**
 * Worker-safe wine generator sub-export — `@filter-enginez/mock-data/wine/generator`.
 *
 * @remarks
 * Everything needed to generate the wine tiers and nothing else: no corpus loaders, no MSW, no
 * filter config, no top-level `await`, no `node:` modules. Import it in a browser Web Worker to
 * build the 150k full tier on the client:
 *
 * ```ts
 * import { FULL_WINE_TIER_SIZE, generateWines } from '@filter-enginez/mock-data/wine/generator';
 *
 * const wines = generateWines(FULL_WINE_TIER_SIZE, undefined, 'full');
 * ```
 *
 * The first `DEFAULT_TIER_SIZE` records are the default tier, so a page that already shows the
 * default tier can grow to the full tier without a single record changing. `generateWineRange`
 * builds the same stream in chunks, for progress reporting.
 *
 * @packageDocumentation
 */

export { type DatasetTier } from '../shared.js';
export { DEFAULT_TIER_SIZE, FULL_WINE_TIER_SIZE } from '../tier-sizes.js';
export { generateWineRange, generateWines, WINE_GENERATOR_SEED } from './generate.js';
export {
	type Wine,
	type WineBody,
	type WineColor,
	type WineOrigin,
	type WineSweetness,
} from './types.js';
