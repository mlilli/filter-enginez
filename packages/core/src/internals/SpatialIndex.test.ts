/**
 * @remarks
 * Behavior-asserting unit tests for {@link SpatialIndex} — the R-tree (rbush) proximity index
 * behind `GeoProximityRule`. Covers the two-phase query (`queryRadius`): bounding-box prune +
 * exact haversine refinement (a point inside the bbox but outside the true radius is rejected),
 * nearest-and-self inclusion, the `radiusKm <= 0` guard, caps that reach a pole (every
 * longitude) or cross ±180° on either side (two boxes), a high-latitude cap's flanks, and
 * agreement with a brute-force haversine scan over a grid of centers and radii; skipping items whose extracted
 * coordinate is `undefined` and items that are sparse-array holes, the empty-tree path, lazy
 * build + automatic rebuild on source-data-version advance, explicit `rebuild()`, `clear()`,
 * and the `isReady` diagnostic across all of those transitions.
 */

import { describe, expect, it } from 'vitest';

import { haversineKm } from '../lib/geo.js';
import { InternalStore } from '../store/InternalStore.js';
import { type GeoCoords, SpatialIndex } from './SpatialIndex.js';

interface Place {
	readonly lat: number | null;
	readonly lng: number | null;
	readonly name: string;
}

/** Extractor returning `undefined` for places with missing coordinates. */
function placeCoords(place: Place): GeoCoords | undefined {
	if (place.lat === null || place.lng === null) {
		return undefined;
	}

	return { lat: place.lat, lng: place.lng };
}

// Reference coordinates (decimal degrees).
const SF: GeoCoords = { lat: 37.7749, lng: -122.4194 };
const OAKLAND: GeoCoords = { lat: 37.8044, lng: -122.2712 };
const NYC: GeoCoords = { lat: 40.7128, lng: -74.006 };

/** Replace the store's source data and bump its version (mimics a `SOURCE_DATA_SET`). */
function setData(store: InternalStore<Place>, data: readonly Place[]): void {
	store.sourceData.value = data;
	store.sourceDataVersion.value = store.sourceDataVersion.value + 1;
}

function makeStore(places: readonly Place[]): InternalStore<Place> {
	return new InternalStore<Place>(places);
}

describe('SpatialIndex.queryRadius', () => {
	it('returns indices inside the radius (self + nearby), excluding the far point', () => {
		const store = makeStore([
			{ lat: SF.lat, lng: SF.lng, name: 'sf' },
			{ lat: OAKLAND.lat, lng: OAKLAND.lng, name: 'oakland' },
			{ lat: NYC.lat, lng: NYC.lng, name: 'nyc' },
		]);
		const index = new SpatialIndex(store, placeCoords);

		const hits = index.queryRadius(SF, 50);

		// SF (idx 0) and Oakland (idx 1) are within 50km; NYC (idx 2) is not.
		expect([...hits].sort((a, b) => a - b)).toEqual([0, 1]);
	});

	it('rejects a point inside the bounding box but outside the true radius', () => {
		// ~14 km due east of SF: inside a generous bbox for radius 10, rejected by haversine.
		const store = makeStore([
			{ lat: SF.lat, lng: SF.lng, name: 'sf' },
			{ lat: SF.lat, lng: SF.lng + 0.16, name: 'edge' },
		]);
		const index = new SpatialIndex(store, placeCoords);

		expect(index.queryRadius(SF, 10)).toEqual([0]);
	});

	it('rejects a bbox-corner candidate that is outside the exact radius (haversine refinement)', () => {
		// ~8 km north AND ~8 km east of SF: inside the radius-widened bbox on each axis (8 < 10),
		// but the diagonal distance (~11 km) exceeds the 10 km radius. Unlike a due-east point,
		// this survives the bbox prune and reaches the haversine check's rejection arm.
		const store = makeStore([
			{ lat: SF.lat, lng: SF.lng, name: 'sf' },
			{ lat: SF.lat + 0.0721, lng: SF.lng + 0.0911, name: 'ne-corner' },
		]);
		const index = new SpatialIndex(store, placeCoords);

		expect(index.queryRadius(SF, 10)).toEqual([0]);
	});

	it('returns an empty array when nothing is in range', () => {
		const store = makeStore([{ lat: NYC.lat, lng: NYC.lng, name: 'nyc' }]);
		const index = new SpatialIndex(store, placeCoords);

		expect(index.queryRadius(SF, 5)).toEqual([]);
	});

	it('returns an empty array for a non-positive radius (guard)', () => {
		const store = makeStore([{ lat: SF.lat, lng: SF.lng, name: 'sf' }]);
		const index = new SpatialIndex(store, placeCoords);

		expect(index.queryRadius(SF, 0)).toEqual([]);
		expect(index.queryRadius(SF, -5)).toEqual([]);
	});

	it('returns an empty array when the corpus is empty', () => {
		const store = makeStore([]);
		const index = new SpatialIndex(store, placeCoords);

		expect(index.queryRadius(SF, 100)).toEqual([]);
	});

	it('handles a search centered at the pole without dividing by zero', () => {
		// cos(90deg) === 0, so the longitude-delta denominator hits the COS_LAT_FLOOR clamp.
		const pole: GeoCoords = { lat: 90, lng: 0 };
		const store = makeStore([{ lat: 90, lng: 0, name: 'pole' }]);
		const index = new SpatialIndex(store, placeCoords);

		expect(index.queryRadius(pole, 100)).toEqual([0]);
	});

	it('skips items whose extracted coordinate is undefined', () => {
		const store = makeStore([
			{ lat: SF.lat, lng: SF.lng, name: 'sf' },
			{ lat: null, lng: null, name: 'missing' },
		]);
		const index = new SpatialIndex(store, placeCoords);

		// Only the SF entry (idx 0) is tree-eligible.
		expect(index.queryRadius(SF, 50)).toEqual([0]);
	});

	it('skips sparse-array holes during the build', () => {
		const sparse: Place[] = [];

		sparse[0] = { lat: SF.lat, lng: SF.lng, name: 'sf' };
		// index 1 left as a hole
		sparse[2] = { lat: OAKLAND.lat, lng: OAKLAND.lng, name: 'oakland' };
		const store = makeStore(sparse);
		const index = new SpatialIndex(store, placeCoords);

		expect([...index.queryRadius(SF, 50)].sort((a, b) => a - b)).toEqual([0, 2]);
	});
});

describe('SpatialIndex lifecycle + isReady', () => {
	it('lazily builds on first query and reports readiness', () => {
		const store = makeStore([{ lat: SF.lat, lng: SF.lng, name: 'sf' }]);
		const index = new SpatialIndex(store, placeCoords);

		expect(index.isReady).toBe(false);

		index.queryRadius(SF, 10);

		expect(index.isReady).toBe(true);
	});

	it('rebuilds automatically when the source-data version advances', () => {
		const store = makeStore([{ lat: SF.lat, lng: SF.lng, name: 'sf' }]);
		const index = new SpatialIndex(store, placeCoords);

		expect(index.queryRadius(SF, 50)).toEqual([0]);

		setData(store, [
			{ lat: SF.lat, lng: SF.lng, name: 'sf' },
			{ lat: OAKLAND.lat, lng: OAKLAND.lng, name: 'oakland' },
		]);

		// Stale-version detection forces a rebuild against the new corpus.
		expect([...index.queryRadius(SF, 50)].sort((a, b) => a - b)).toEqual([0, 1]);
	});

	it('reports not-ready after the version advances until the next query rebuilds', () => {
		const store = makeStore([{ lat: SF.lat, lng: SF.lng, name: 'sf' }]);
		const index = new SpatialIndex(store, placeCoords);

		index.queryRadius(SF, 10);
		expect(index.isReady).toBe(true);

		setData(store, [{ lat: OAKLAND.lat, lng: OAKLAND.lng, name: 'oakland' }]);

		// Cached version no longer matches the store version.
		expect(index.isReady).toBe(false);
	});

	it('rebuild() forces a fresh build (for in-place item mutation)', () => {
		const store = makeStore([{ lat: SF.lat, lng: SF.lng, name: 'sf' }]);
		const index = new SpatialIndex(store, placeCoords);

		index.rebuild();

		expect(index.isReady).toBe(true);
		expect(index.queryRadius(SF, 10)).toEqual([0]);
	});

	it('clear() drops the tree and forces a rebuild on the next query', () => {
		const store = makeStore([{ lat: SF.lat, lng: SF.lng, name: 'sf' }]);
		const index = new SpatialIndex(store, placeCoords);

		index.queryRadius(SF, 10);
		expect(index.isReady).toBe(true);

		index.clear();
		expect(index.isReady).toBe(false);

		expect(index.queryRadius(SF, 10)).toEqual([0]);
		expect(index.isReady).toBe(true);
	});
});

describe('SpatialIndex.queryRadius — cap geometry', () => {
	/** Points every 10° of latitude and 15° of longitude, both poles and ±180° included. */
	const GRID: readonly Place[] = (() => {
		const places: Place[] = [];

		for (let lat = -90; lat <= 90; lat += 10) {
			for (let lng = -180; lng <= 180; lng += 15) {
				places.push({ lat, lng, name: `${String(lat)},${String(lng)}` });
			}
		}

		return places;
	})();

	/**
	 * The indices a per-item haversine scan keeps, ascending.
	 *
	 * @param center - The query center
	 * @param radiusKm - The query radius
	 * @returns What `GeoProximityRule.action` would pass
	 */
	function scan(center: GeoCoords, radiusKm: number): number[] {
		return GRID.flatMap((place, idx) =>
			haversineKm({ lat: place.lat as number, lng: place.lng as number }, center) <= radiusKm ? [idx] : []);
	}

	/**
	 * The indices the R-tree query keeps, ascending.
	 *
	 * @param center - The query center
	 * @param radiusKm - The query radius
	 * @returns What the bitmap path would pass
	 */
	function query(center: GeoCoords, radiusKm: number): number[] {
		return new SpatialIndex(makeStore(GRID), placeCoords).queryRadius(center, radiusKm).toSorted((a, b) => a - b);
	}

	it('keeps exactly what a haversine scan keeps, for every center and radius on a grid', () => {
		let compared = 0;
		let nonEmpty = 0;

		for (const lat of [-89, -60, -35, 0, 35, 60, 89]) {
			for (const lng of [-179, -120, 0, 120, 179]) {
				for (const radiusKm of [100, 900, 2_500, 6_000, 12_000, 20_000]) {
					const expected = scan({ lat, lng }, radiusKm);

					expect(query({ lat, lng }, radiusKm), `${String(lat)},${String(lng)} r=${String(radiusKm)}`).toEqual(expected);
					compared++;
					nonEmpty += expected.length > 0 ? 1 : 0;
				}
			}
		}
		expect(compared).toBe(210);
		expect(nonEmpty).toBeGreaterThan(150);
	});

	it('finds a point across ±180° from either side', () => {
		const fiji = { lat: -17, lng: 179 };
		const samoa = { lat: -14, lng: -172 };
		const store = makeStore([{ ...fiji, name: 'fiji' }, { ...samoa, name: 'samoa' }]);
		const index = new SpatialIndex(store, placeCoords);

		// About 1,000 km apart, straddling the antimeridian.
		expect(index.queryRadius(fiji, 1_500).toSorted((a, b) => a - b)).toEqual([0, 1]);
		expect(index.queryRadius(samoa, 1_500).toSorted((a, b) => a - b)).toEqual([0, 1]);
	});

	it('covers every longitude when the cap reaches either pole', () => {
		const store = makeStore([{ lat: 85, lng: 0, name: 'n0' }, { lat: 85, lng: 180, name: 'n180' }, { lat: -85, lng: 90, name: 's90' }]);
		const index = new SpatialIndex(store, placeCoords);

		expect(index.queryRadius({ lat: 80, lng: 0 }, 2_000).toSorted((a, b) => a - b)).toEqual([0, 1]);
		expect(index.queryRadius({ lat: -80, lng: -90 }, 2_000)).toEqual([2]);
	});

	it('keeps a high-latitude cap\'s flanks, which lie poleward of its center', () => {
		// From 60°N, 2,200 km reaches about 40° of longitude at 64°N — past the 40° that r / cos φ allows.
		const center = { lat: 60, lng: 0 };
		const flank = { lat: 64, lng: 40.5 };
		const index = new SpatialIndex(makeStore([{ ...flank, name: 'flank' }]), placeCoords);

		expect(haversineKm(center, flank)).toBeLessThan(2_200);
		expect(index.queryRadius(center, 2_200)).toEqual([0]);
	});
});
