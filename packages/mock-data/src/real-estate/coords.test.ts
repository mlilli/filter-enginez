/**
 * `Listing.coords` — the `{ lat, lng }` field that lets a real-estate geo filter be serialized.
 *
 * @remarks
 * `GeoProximityRule` and the engine's R-tree spatial index read `{ lat, lng }` through the rule's
 * field. `Listing.coordinates` is `{ lat, lon }`, so without `coords` the only way to aim a geo rule at
 * a listing is a FUNCTION extractor that renames `lon` — and `exportConfig` writes a function field as
 * the placeholder `'<function>'`, which revives as "the item itself" and matches nothing. These tests
 * prove the string-field path end to end over the generated default tier:
 *
 * - **The field.** Every listing's `coords` is its `coordinates` point, renamed, and adding it drew
 *   nothing from the seeded RNG, so every other field of every listing is what it was.
 * - **The rule.** `new GeoProximityRule('coords', …)` matches exactly what the function-extractor rule
 *   matches, for several centers and radii.
 * - **The round trip.** That rule survives `exportConfig` → `JSON.stringify` → `JSON.parse` →
 *   `loadConfig` with identical matches; the function-extractor rule, put through the same trip,
 *   matches nothing — the failure `coords` exists to remove.
 * - **The R-tree.** Through the bitmap path with `spatialIndex: 'auto'` the rule's bitmap comes from
 *   `SpatialIndex.queryRadius` (spied, so a silent fallback to the scan would fail), and its matches
 *   equal the haversine scan's under `spatialIndex: 'off'`.
 * - **The served config.** `realEstateFilterConfig`'s `geo-proximity` rule reads `coords` and matches
 *   listings.
 *
 * @packageDocumentation
 */

import {
	createFilterEngine,
	CURRENT_CONFIG_VERSION,
	exportConfig,
	type FieldExtractor,
	type FilterEngine,
	type FilterEngineConfig,
	type GeoCoords,
	GeoProximityRule,
	initializeBitmapAcceleration,
	loadConfig,
	SpatialIndex,
} from '@filter-enginez/core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Listing } from './types.js';

import { listings } from './data.js';
import { realEstateFilterConfig } from './filter-config.js';
import { generateListings } from './generate.js';

/** The rule id every engine in this suite registers its geo rule under. */
const RULE_ID = 'near';

/**
 * The function extractor consumers wrote before `coords` existed: rename `coordinates.lon` to `lng`.
 * The reference the string field must agree with.
 */
const extractCoordinatesAsGeoCoords: FieldExtractor = (item: unknown): GeoCoords => {
	const { coordinates } = item as Listing;

	return { lat: coordinates.lat, lng: coordinates.lon };
};

/**
 * Query points: the served config's San Francisco default, two tighter metro-core queries, a radius
 * wide enough to take in a whole metro, and open ocean, which matches nothing in either form.
 */
const QUERIES: readonly (readonly [label: string, center: GeoCoords, radiusKm: number, isEmpty: boolean])[] = [
	['San Francisco, 25 km', { lat: 37.7749, lng: -122.4194 }, 25, false],
	['Denver, 10 km', { lat: 39.7392, lng: -104.9903 }, 10, false],
	['Miami, 5 km', { lat: 25.7617, lng: -80.1918 }, 5, false],
	['Chicago, 60 km', { lat: 41.8781, lng: -87.6298 }, 60, false],
	['the Gulf of Guinea, 50 km', { lat: 0, lng: 0 }, 50, true],
];

/** The San Francisco query, the one the served config defaults to. */
const SAN_FRANCISCO: GeoCoords = { lat: 37.7749, lng: -122.4194 };

/**
 * An engine over the default tier with one geo rule.
 *
 * @param field - The rule's field: `'coords'` or the function extractor.
 * @param center - The query center.
 * @param radiusKm - The query radius.
 * @param spatialIndex - The R-tree mode; the bitmap path is forced on whenever it is given.
 * @returns The engine, with the rule registered as {@link RULE_ID}.
 */
function engineWithGeoRule(
	field: FieldExtractor,
	center: GeoCoords,
	radiusKm: number,
	spatialIndex?: 'auto' | 'off',
): FilterEngine<Listing> {
	const engine = createFilterEngine<Listing>({
		acceleration: spatialIndex === undefined ? {} : { bitmap: 'on', spatialIndex },
		sourceData: listings,
	});

	engine.addRule(RULE_ID, new GeoProximityRule(field, { center, radiusKm }));

	return engine;
}

/**
 * Put an engine's state through the trip a shared link or a saved config takes, and load it into a
 * fresh engine over the same listings.
 *
 * @param engine - The engine to export.
 * @returns The exported document as it reads after JSON, and the engine it was loaded into.
 */
function roundTrip(engine: FilterEngine<Listing>): { readonly document: FilterEngineConfig; readonly reloaded: FilterEngine<Listing> } {
	const document = JSON.parse(JSON.stringify(exportConfig(engine))) as FilterEngineConfig;
	const reloaded = createFilterEngine<Listing>({ sourceData: listings });

	loadConfig(reloaded, document);

	return { document, reloaded };
}

/**
 * The field an exported document wrote for the rule this suite registers.
 *
 * @param document - An exported config.
 * @returns The serialized `field` of {@link RULE_ID}.
 */
function exportedField(document: FilterEngineConfig): unknown {
	return document.rules.find((entry) => entry.id === RULE_ID)?.rule.field;
}

beforeAll(async () => {
	await initializeBitmapAcceleration();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('Listing.coords', () => {
	it('is the coordinates point in { lat, lng } shape, on every listing', () => {
		expect(listings).toHaveLength(10_000);

		for (const listing of listings) {
			expect(listing.coords).toStrictEqual({ lat: listing.coordinates.lat, lng: listing.coordinates.lon });
		}
	});

	it('draws nothing from the seeded generator, so every other field keeps its value', () => {
		// A single extra RNG call anywhere in a listing would shift every value after it, including the
		// next listing's id and the corpus-wide sums pinned here. The MLS ids are generated text.
		// cspell:ignore DVJR
		const regenerated = generateListings(10_000);
		const [first] = regenerated;
		const last = regenerated.at(-1);

		expect(regenerated).toStrictEqual(listings);
		expect(first?.id).toBe('coral-gables-wynwood-spruce-7045-0');
		expect(first?.coordinates).toStrictEqual({ lat: 25.83698, lon: -80.190418 });
		expect(first?.mlsId).toBe('HEE8DVJR');
		expect(last?.id).toBe('brookline-jamaica-plain-maple-7098-9999');
		expect(last?.coords).toStrictEqual({ lat: 42.32678, lng: -71.092203 });
		expect(last?.mlsId).toBe('N9M67VCE');
		expect(regenerated.reduce((sum, listing) => sum + listing.priceUsd, 0)).toBe(7_850_453_459);
		expect(regenerated.reduce((sum, listing) => sum + listing.squareFeet, 0)).toBe(27_121_700);
	});
});

describe('GeoProximityRule over the coords string field', () => {
	it.each(QUERIES)('matches what the function extractor matches: %s', (_label, center, radiusKm, isEmpty) => {
		const byField = Array.from(engineWithGeoRule('coords', center, radiusKm).getResultIndices());
		const byFunction = Array.from(engineWithGeoRule(extractCoordinatesAsGeoCoords, center, radiusKm).getResultIndices());

		expect(byField).toStrictEqual(byFunction);
		expect(byField.length === 0).toBe(isEmpty);
		expect(byField.length).toBeLessThan(listings.length);
	});

	it.each(QUERIES)('survives exportConfig → JSON → loadConfig with the same matches: %s', (_label, center, radiusKm) => {
		const engine = engineWithGeoRule('coords', center, radiusKm);
		const { document, reloaded } = roundTrip(engine);

		expect(exportedField(document)).toBe('coords');
		expect(Array.from(reloaded.getResultIndices())).toStrictEqual(Array.from(engine.getResultIndices()));
	});

	it('is what a function extractor cannot be: that rule exports as <function> and reloads matching nothing', () => {
		const engine = engineWithGeoRule(extractCoordinatesAsGeoCoords, SAN_FRANCISCO, 25);
		const { document, reloaded } = roundTrip(engine);

		expect(engine.getResultIndices().length).toBeGreaterThan(0);
		expect(exportedField(document)).toBe('<function>');
		expect(reloaded.getResultIndices()).toHaveLength(0);
	});

	it.each(QUERIES)('builds its bitmap through the R-tree under spatialIndex auto, matching the scan: %s', (_label, center, radiusKm) => {
		const queryRadius = vi.spyOn(SpatialIndex.prototype, 'queryRadius');
		const throughTree = Array.from(engineWithGeoRule('coords', center, radiusKm, 'auto').computeResults());

		expect(queryRadius).toHaveBeenCalledWith(center, radiusKm);
		queryRadius.mockClear();

		const throughScan = Array.from(engineWithGeoRule('coords', center, radiusKm, 'off').computeResults());

		expect(queryRadius).not.toHaveBeenCalled();
		expect(throughTree).toStrictEqual(throughScan);
		expect(throughTree).toStrictEqual(Array.from(engineWithGeoRule(extractCoordinatesAsGeoCoords, center, radiusKm).getResultIndices()));
	});

	it('serves a geo-proximity rule in realEstateFilterConfig that reads coords and matches listings', () => {
		const served = realEstateFilterConfig.rules.find((entry) => entry.id === 'geo-proximity');
		const engine = createFilterEngine<Listing>({ sourceData: listings });

		expect(served?.rule.field).toBe('coords');
		loadConfig(engine, { rules: served === undefined ? [] : [served], version: CURRENT_CONFIG_VERSION });

		const reference = engineWithGeoRule(extractCoordinatesAsGeoCoords, SAN_FRANCISCO, 25).getResultIndices();

		expect(reference.length).toBeGreaterThan(0);
		expect(Array.from(engine.getResultIndices())).toStrictEqual(Array.from(reference));
	});
});
