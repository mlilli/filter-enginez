/**
 * Real-estate dataset types — `Listing` and its supporting enums.
 *
 * @remarks
 * The "kitchen-sink" dataset — exercises every rule
 * type in the catalog: `RangeRule` (price, sqft, beds, baths, year), `BooleanRule` (has pool,
 * has garage, waterfront), `InSetRule` (property type, neighborhood, school district),
 * `GeoProximityRule` (`coords` → "within N km of"), `HierarchicalRule` (state → metro →
 * neighborhood → block), `DateRangeRule` (listed date), `TextSearchRule` (full-text address +
 * description), `ExistsRule` (has open house scheduled).
 *
 * Provenance: every listing is synthetic, produced by the seeded generator in `./generate.ts`.
 * No third-party listing or map data is included.
 *   - **Addresses + coordinates** — synthetic street names and numbers; coordinates drawn inside
 *     each metro's bounding box from a curated metro table
 *   - **Neighborhoods + school districts** — real place names, hand-picked per metro in the same
 *     table and assigned to listings at random
 *   - **Price/sqft/beds/baths** — price is normally distributed around a per-metro median taken
 *     from approximate 2024 Zillow Home Value Index figures, so regional cost looks plausible;
 *     square footage scales with price, and beds/baths are drawn from simple ranges
 *
 * @packageDocumentation
 */

import type { BaseRecord } from '../shared.js';

/** Top-level property classifications surfaced as an `InSetRule` facet. */
export type PropertyType =
	| 'condo'
	| 'land'
	| 'mobile'
	| 'multi-family'
	| 'single-family'
	| 'townhouse';

/** Listing status — drives "active vs sold vs pending" filtering. */
export type ListingStatus = 'active' | 'off-market' | 'pending' | 'sold';

/**
 * A single binary feature flag — surfaced as a `BooleanRule` per feature, or as an
 * `InSetofSetsRule` for the "must-have features" multi-select.
 */
export type ListingFeature =
	| 'central-ac'
	| 'ev-charger'
	| 'finished-basement'
	| 'fireplace'
	| 'garage'
	| 'home-office'
	| 'open-floor-plan'
	| 'pool'
	| 'solar'
	| 'updated-kitchen'
	| 'view-city'
	| 'view-mountain'
	| 'view-water'
	| 'waterfront';

/**
 * Geographic coordinate — kept structural rather than reusing `GeoCoords` from `@filter-engine
 * z/core` so the `mock-data` type files have no runtime dependency edge into `core` (only the
 * filter-config files import core).
 */
export interface ListingCoordinates {
	readonly lat: number;
	readonly lon: number;
}

/**
 * The same point as {@link ListingCoordinates}, in the `{ lat, lng }` shape that `GeoProximityRule`
 * and the engine's R-tree spatial index read.
 *
 * @remarks
 * Structurally identical to `GeoCoords` from `@filter-enginez/core`, and declared here for the same
 * reason as {@link ListingCoordinates}: the type files stay free of a dependency edge into `core`.
 */
export interface ListingGeoCoords {
	readonly lat: number;
	readonly lng: number;
}

/**
 * A single real-estate listing.
 */
export interface Listing extends BaseRecord {
	// ─── Identity / address ────────────────────────────────────────────────
	readonly addressLine1: string;
	readonly city: string;
	/** Where the listing is, as `{ lat, lon }`. {@link Listing.coords} holds the same point for geo rules. */
	readonly coordinates: ListingCoordinates;
	/**
	 * Where the listing is, as `{ lat, lng }` — the field a `GeoProximityRule` names by string.
	 *
	 * @remarks
	 * Redundant with `coordinates` on purpose, for the reason `locationId` below is: a rule that
	 * reaches a value through a function extractor cannot be serialized. `exportConfig` writes a
	 * function field as the placeholder `'<function>'`, which revives as "the item itself", so a radius
	 * filter in a shared link or a saved config would match nothing once loaded. Mapping
	 * `coordinates.lon` to `lng` therefore happens here, once, at generation time, and
	 * `new GeoProximityRule('coords', { center, radiusKm })` round-trips through `exportConfig` →
	 * JSON → `loadConfig`, a URL, a worker and a server. The R-tree spatial index reads the same
	 * field, so it accelerates the rule unchanged.
	 *
	 * Both fields carry identical values: `coords.lat === coordinates.lat` and
	 * `coords.lng === coordinates.lon` for every listing.
	 */
	readonly coords: ListingGeoCoords;
	/**
	 * Composite `state/metro/neighborhood` path, materialized rather than derived.
	 *
	 * @remarks
	 * Redundant with `state` + `metroArea` + `neighborhood` on purpose. A hierarchical location
	 * filter needs a single addressable value, and a *derived* one can only be reached through a
	 * function extractor — which cannot be serialized. `FilterBundleQuery` crosses Comlink to the
	 * worker tier and JSON to the server tier, and names its fields by string, so predictive disable
	 * on the location tree is only expressible against a real field.
	 *
	 * Substituting `neighborhood` was measured and rejected: names collide across metros
	 * (`Capitol Hill` is in both Seattle and Denver, `Hyde Park` in both Austin and Chicago), so a
	 * projection keyed on the bare name over-matches and would report a node as reachable when it
	 * isn't — a false ENABLE, more harmful than no disable at all because it looks authoritative.
	 *
	 * Format matches `extractListingLocationId` in `examples-shared`: `{state}/{metro}/{neighborhood}`.
	 */
	readonly locationId: string;
	readonly metroArea: string;
	readonly mlsId: string;
	readonly neighborhood: string;
	readonly schoolDistrict: string;
	readonly state: string;
	readonly zip: string;

	// ─── Numerics ──────────────────────────────────────────────────────────
	readonly bathrooms: number;
	readonly bedrooms: number;
	readonly lotSizeAcres: number;
	readonly priceUsd: number;
	readonly squareFeet: number;
	readonly yearBuilt: number;

	// ─── Classifications ───────────────────────────────────────────────────
	readonly features: readonly ListingFeature[];
	readonly propertyType: PropertyType;
	readonly status: ListingStatus;

	// ─── Dates ─────────────────────────────────────────────────────────────
	readonly listedDate: string;
	readonly openHouseDates: readonly string[];

	// ─── Marketing ─────────────────────────────────────────────────────────
	readonly description: string;
	readonly photos: readonly string[];
	readonly title: string;
}
