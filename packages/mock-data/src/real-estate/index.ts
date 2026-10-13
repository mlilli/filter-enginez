/**
 * Real-estate dataset sub-export — `@filter-enginez/mock-data/real-estate`.
 *
 * @packageDocumentation
 */

export {
	type Listing,
	type ListingCoordinates,
	type ListingFeature,
	type ListingStatus,
	type PropertyType,
} from './types.js';

export { listings, loadFullListings } from './data.js';
export { getRealEstateFilterConfig, realEstateFilterConfig } from './filter-config.js';
// `realEstateHandlers` is intentionally NOT re-exported here — see wine/index.ts for the
// MSW-in-workers explanation. Use `@filter-enginez/mock-data/handlers` if you want the
// handler set; it imports from `./real-estate/handlers.js` directly.
