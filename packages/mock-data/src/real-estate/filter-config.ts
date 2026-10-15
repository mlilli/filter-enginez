/**
 * Real-estate `FilterEngineConfig` — the JSON-driven filter definition served by the MSW
 * handler at `GET /api/real-estate/filter-config`.
 *
 * @remarks
 * The example app fetches this config on boot,
 * passes it to `engine.loadConfig(...)`, and the entire filter UI renders from it — zero
 * hardcoded filter knowledge in the React code. The "kitchen-sink" dataset, exercising
 * every rule type in the catalog: `RangeRule`, `BooleanRule`, `InSetRule`, `GeoProximityRule`,
 * `HierarchicalRule`, `DateRangeRule`, `TextSearchRule`, `ExistsRule`.
 *
 * @packageDocumentation
 */

import { CURRENT_CONFIG_VERSION, type FilterEngineConfig } from '@filter-enginez/core';

import { listings } from './data.js';

/**
 * Build the state → metro → neighborhood hierarchy from the loaded listings. Same shape as
 * the wine origin tree — drives the cascading filter UX. Stable node ids keep selection
 * persistence across URL state + devtools snapshots.
 *
 * @internal
 */
function buildLocationTree(): { readonly id: string; readonly children: readonly { readonly id: string; readonly children: readonly { readonly id: string; readonly children: readonly { readonly id: string }[] }[] }[] } {
	const stateMap = new Map<string, Map<string, Set<string>>>();

	for (const listing of listings) {
		let metroMap = stateMap.get(listing.state);

		if (metroMap === undefined) {
			metroMap = new Map();
			stateMap.set(listing.state, metroMap);
		}
		let neighSet = metroMap.get(listing.metroArea);

		if (neighSet === undefined) {
			neighSet = new Set();
			metroMap.set(listing.metroArea, neighSet);
		}
		neighSet.add(listing.neighborhood);
	}

	return {
		children: Array.from(stateMap.entries()).map(([state, metroMap]) => ({
			children: Array.from(metroMap.entries()).map(([metro, neighSet]) => ({
				children: Array.from(neighSet).map((neighborhood) => ({
					id: `neighborhood:${state}/${metro}/${neighborhood}`,
				})),
				id: `metro:${state}/${metro}`,
			})),
			id: `state:${state}`,
		})),
		id: 'location',
	};
}

/**
 * The full real-estate filter config. Built dynamically from the loaded `listings` corpus so
 * the location tree, school-district set, and price ranges always reflect actual data.
 */
export const realEstateFilterConfig: FilterEngineConfig = {
	groups: [
		{
			composition: 'and',
			displayName: 'Location',
			filterIds: ['location', 'geo-proximity', 'school-district'],
			id: 'location-group',
		},
		{
			composition: 'and',
			displayName: 'Property details',
			filterIds: ['property-type', 'status', 'price', 'square-feet', 'bedrooms', 'bathrooms', 'year-built', 'lot-size'],
			id: 'property-group',
		},
		{
			composition: 'and',
			displayName: 'Features',
			filterIds: ['feature-pool', 'feature-garage', 'feature-waterfront', 'feature-fireplace', 'feature-central-ac', 'feature-solar'],
			id: 'features-group',
		},
		{
			composition: 'and',
			displayName: 'Listing timing',
			filterIds: ['listed-date', 'has-open-house'],
			id: 'timing-group',
		},
	],
	label: 'Real estate listings',
	metadata: {
		dataset: 'real-estate',
		description: 'Procedurally-generated 1k listing bootstrap across 8 US metros',
		metros: Array.from(new Set(listings.map((l) => l.metroArea))),
		primaryDimensions: ['location', 'priceUsd', 'bedrooms', 'squareFeet', 'propertyType'],
	},
	rules: [
		// ─── Geography (hierarchical + geo-proximity) ──────────────────────
		{
			id: 'location',
			rule: {
				config: {
					selected: [],
					tree: buildLocationTree(),
				},
				field: 'state',
				type: 'HierarchicalRule',
			},
		},
		{
			id: 'geo-proximity',
			rule: {
				// Default center is San Francisco; consumers update via UI (map click, address
				// geocode, "near me" geolocation). Radius default 25km — typical commute radius.
				// `coords` is the listing's `{ lat, lng }` point, the shape the rule reads; naming it by
				// string is what lets this rule survive `exportConfig` → JSON → `loadConfig`.
				config: {
					center: { lat: 37.7749, lng: -122.4194 },
					radiusKm: 25,
				},
				field: 'coords',
				type: 'GeoProximityRule',
			},
		},

		// ─── Property classification facets ────────────────────────────────
		{
			id: 'property-type',
			rule: {
				config: { set: [] satisfies readonly string[] },
				field: 'propertyType',
				type: 'InSetRule',
			},
		},
		{
			id: 'status',
			rule: {
				config: { set: [] satisfies readonly string[] },
				field: 'status',
				type: 'InSetRule',
			},
		},
		{
			id: 'school-district',
			rule: {
				config: { set: [] satisfies readonly string[] },
				field: 'schoolDistrict',
				type: 'InSetRule',
			},
		},

		// ─── Numeric ranges ────────────────────────────────────────────────
		{
			id: 'price',
			rule: {
				config: { max: Number.POSITIVE_INFINITY, min: 0 },
				field: 'priceUsd',
				type: 'RangeRule',
			},
		},
		{
			id: 'square-feet',
			rule: {
				config: { max: 10_000, min: 0 },
				field: 'squareFeet',
				type: 'RangeRule',
			},
		},
		{
			id: 'bedrooms',
			rule: {
				config: { max: 10, min: 0 },
				field: 'bedrooms',
				type: 'RangeRule',
			},
		},
		{
			id: 'bathrooms',
			rule: {
				config: { max: 10, min: 0 },
				field: 'bathrooms',
				type: 'RangeRule',
			},
		},
		{
			id: 'year-built',
			rule: {
				config: { max: 2025, min: 1900 },
				field: 'yearBuilt',
				type: 'RangeRule',
			},
		},
		{
			id: 'lot-size',
			rule: {
				config: { max: 5, min: 0 },
				field: 'lotSizeAcres',
				type: 'RangeRule',
			},
		},

		// ─── Date + existence ──────────────────────────────────────────────
		{
			id: 'listed-date',
			rule: {
				config: { preset: 'last-90-days' },
				field: 'listedDate',
				type: 'DateRangeRule',
			},
		},
		{
			id: 'has-open-house',
			rule: {
				config: undefined,
				field: 'openHouseDates',
				type: 'ExistsRule',
			},
		},

		// ─── Feature flags (one BooleanRule per high-traffic feature) ──────
		// Each flag is a separate rule so the consumer can mix-and-match independently of the
		// `features: string[]` array. Defaulting to `undefined` config means "don't filter on
		// this feature" — consumers flip to `true` / `false` to enable filtering.
		...['pool', 'garage', 'waterfront', 'fireplace', 'central-ac', 'solar'].map((feature) => ({
			id: `feature-${feature}`,
			rule: {
				config: undefined,
				field: `feature.${feature}`,
				type: 'BooleanRule',
			},
		})),

		// ─── Text search across address + description ──────────────────────
		{
			id: 'text-search',
			rule: {
				config: { caseSensitive: false, mode: 'substring', query: '' },
				field: 'description',
				type: 'TextSearchRule',
			},
		},
	],
	version: CURRENT_CONFIG_VERSION,
};

/**
 * Get the filter config — wrapper for the MSW handler. Rebuilds dynamically so consumers
 * regenerating the dataset get a fresh config reflecting the new data.
 */
export function getRealEstateFilterConfig(): FilterEngineConfig {
	return realEstateFilterConfig;
}
