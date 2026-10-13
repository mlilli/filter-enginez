/**
 * @remarks
 * R-tree integration tests for {@link BitmapIndex} — the geo-proximity acceleration path where a
 * `GeoProximityRule`'s bitmap is built from a shared {@link SpatialIndex} instead of a per-item
 * haversine scan. Covers: exact PARITY between the R-tree path (`spatialIndex: 'auto'`) and the
 * haversine fallback (`'off'`) across radii — including the radius-0 fallback (the R-tree path is
 * skipped, so an exact-center item is still included) and coordinate-less items — plus the
 * field-keyed tree sharing (geo rules on the same `field` share one tree; distinct fields get
 * their own) that is what keeps center/radius changes from rebuilding the index.
 *
 * Drives the bitmap index in `'bitmap'` mode against a real (WASM-initialized) Roaring backend;
 * `beforeAll` awaits `initializeBitmapAcceleration()`.
 */

import RBush from 'rbush';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { RuleId } from '../types.js';
import type { SpatialIndexMode } from './accelerationModes.js';

import { GeoProximityRule } from '../rules/GeoProximityRule.js';
import { InternalStore } from '../store/InternalStore.js';
import { BitmapIndex } from './BitmapIndex.js';
import { initializeBitmapAcceleration } from './roaringInit.js';

interface Place {
	readonly location: { lat: number; lng: number } | null;
	readonly name: string;
}

interface TwoFieldPlace {
	readonly home: { lat: number; lng: number };
	readonly work: { lat: number; lng: number };
}

const SF = { lat: 37.7749, lng: -122.4194 };
const OAKLAND = { lat: 37.8044, lng: -122.2712 };
const NYC = { lat: 40.7128, lng: -74.006 };

/** SF (0), Oakland (1) ~13 km away, NYC (2) ~4130 km, a coordinate-less place (3), a second SF (4). */
function makeStore(): InternalStore<Place> {
	return new InternalStore<Place>([
		{ location: SF, name: 'sf' },
		{ location: OAKLAND, name: 'oakland' },
		{ location: NYC, name: 'nyc' },
		{ location: null, name: 'nowhere' },
		{ location: SF, name: 'sf-again' },
	]);
}

function geoRule(radiusKm: number): GeoProximityRule {
	return new GeoProximityRule('location', { center: SF, radiusKm });
}

/** Passing source-data indices for a single geo rule, built under the given spatial mode. */
function indicesFor(spatialMode: SpatialIndexMode, rule: GeoProximityRule): number[] {
	const store = makeStore();

	store.rules.value = new Map<RuleId, GeoProximityRule>([['near', rule]]);
	const index = new BitmapIndex<Place>(store, 'bitmap', spatialMode);

	return [...index.getBitmap('near').toArray()].sort((a, b) => a - b);
}

beforeAll(async () => {
	await initializeBitmapAcceleration();
});

describe('BitmapIndex — geo R-tree / haversine parity', () => {
	it.each([0, 5, 25, 50, 5000])('matches the haversine scan at radius %d km', (radiusKm) => {
		expect(indicesFor('auto', geoRule(radiusKm))).toEqual(indicesFor('off', geoRule(radiusKm)));
	});

	it('includes an exact-center item at radius 0 via the haversine fallback (not the R-tree)', () => {
		// radiusKm 0 -> the R-tree branch is skipped (guarded on radiusKm > 0), so 'auto' also runs
		// the scan, which includes items sitting exactly on the center (distance 0 <= 0).
		expect(indicesFor('auto', geoRule(0))).toEqual([0, 4]);
		expect(indicesFor('off', geoRule(0))).toEqual([0, 4]);
	});

	it('excludes coordinate-less items on the R-tree path', () => {
		// SF(0), Oakland(1), SF-again(4) within 50 km; NYC(2) out; the null-location place (3) never appears.
		const rtree = indicesFor('auto', geoRule(50));

		expect(rtree).toEqual([0, 1, 4]);
		expect(rtree).not.toContain(3);
	});
});

describe('BitmapIndex — field-keyed spatial-tree sharing', () => {
	it('shares one R-tree across geo rules on the same field', () => {
		const store = makeStore();

		store.rules.value = new Map<RuleId, GeoProximityRule>([
			['near5', geoRule(5)],
			['near50', geoRule(50)],
		]);
		const loadSpy = vi.spyOn(RBush.prototype, 'load');
		const index = new BitmapIndex<Place>(store, 'bitmap', 'auto');

		index.getBitmap('near5');
		index.getBitmap('near50');

		// Same 'location' field -> one shared tree -> exactly one bulk load (a radius change never
		// rebuilds the index).
		expect(loadSpy).toHaveBeenCalledTimes(1);
		loadSpy.mockRestore();
	});

	it('builds a separate R-tree per distinct coordinate field', () => {
		const store = new InternalStore<TwoFieldPlace>([
			{ home: SF, work: OAKLAND },
			{ home: OAKLAND, work: NYC },
		]);

		store.rules.value = new Map<RuleId, GeoProximityRule>([
			['nearHome', new GeoProximityRule('home', { center: SF, radiusKm: 50 })],
			['nearWork', new GeoProximityRule('work', { center: OAKLAND, radiusKm: 50 })],
		]);
		const loadSpy = vi.spyOn(RBush.prototype, 'load');
		const index = new BitmapIndex<TwoFieldPlace>(store, 'bitmap', 'auto');

		index.getBitmap('nearHome');
		index.getBitmap('nearWork');

		// Distinct fields ('home' vs 'work') -> two trees -> two bulk loads.
		expect(loadSpy).toHaveBeenCalledTimes(2);
		loadSpy.mockRestore();
	});
});
