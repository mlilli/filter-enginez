/**
 * Tests for `GeoProximityRule` — haversine radius filter around a center point.
 *
 * @remarks
 * Covers the `action` guard (missing value, non-number lat, non-number lng) and the inside /
 * boundary / outside radius outcomes, the public `extractCoords` (which `action` and the engine's
 * `SpatialIndex` share), plus the exported `haversineKm` helper directly: a known distance, the
 * zero-distance identity, and symmetry. The boundary case uses a point placed at exactly the
 * configured radius via `haversineKm` so the `<=` comparison's equality edge is hit.
 */

import { describe, expect, it } from 'vitest';

import { GeoProximityRule, haversineKm } from './GeoProximityRule.js';

const ferryBuilding = { lat: 37.7955, lng: -122.3937 };

describe('GeoProximityRule', () => {
	it('passes an item inside the radius', () => {
		const rule = new GeoProximityRule('location', { center: ferryBuilding, radiusKm: 5 });
		// ~1 km away.
		const near = { lat: 37.8045, lng: -122.3937 };

		expect(rule.action({ location: near }, rule)).toBe(true);
	});

	it('fails an item outside the radius', () => {
		const rule = new GeoProximityRule('location', { center: ferryBuilding, radiusKm: 5 });
		// Oakland — well over 5 km away.
		const far = { lat: 37.8044, lng: -122.2712 };

		expect(rule.action({ location: far }, rule)).toBe(false);
	});

	it('includes a point at exactly the radius boundary (<= is inclusive)', () => {
		const point = { lat: 37.9, lng: -122.3937 };
		const exactRadius = haversineKm(point, ferryBuilding);
		const rule = new GeoProximityRule('location', {
			center: ferryBuilding,
			radiusKm: exactRadius,
		});

		expect(rule.action({ location: point }, rule)).toBe(true);
	});

	it('fails when the field value is missing', () => {
		const rule = new GeoProximityRule('location', { center: ferryBuilding, radiusKm: 5 });

		expect(rule.action({}, rule)).toBe(false);
	});

	it('fails when lat is not a number', () => {
		const rule = new GeoProximityRule('location', { center: ferryBuilding, radiusKm: 5 });

		expect(rule.action({ location: { lat: 'x', lng: -122.3937 }}, rule)).toBe(false);
	});

	it('fails when lng is not a number', () => {
		const rule = new GeoProximityRule('location', { center: ferryBuilding, radiusKm: 5 });

		expect(rule.action({ location: { lat: 37.7955, lng: null }}, rule)).toBe(false);
	});

	describe('extractCoords', () => {
		const rule = new GeoProximityRule('location', { center: ferryBuilding, radiusKm: 5 });

		it('returns the validated coordinate pair for a well-formed field', () => {
			expect(rule.extractCoords({ location: { lat: 1, lng: 2 }})).toEqual({ lat: 1, lng: 2 });
		});

		it('returns undefined when the field is missing', () => {
			expect(rule.extractCoords({})).toBeUndefined();
		});

		it('returns undefined when lat is not a number', () => {
			expect(rule.extractCoords({ location: { lat: 'x', lng: 2 }})).toBeUndefined();
		});

		it('returns undefined when lng is not a number', () => {
			expect(rule.extractCoords({ location: { lat: 1, lng: null }})).toBeUndefined();
		});
	});

	describe('haversineKm', () => {
		it('returns zero for identical points', () => {
			expect(haversineKm(ferryBuilding, ferryBuilding)).toBeCloseTo(0, 6);
		});

		it('computes a known great-circle distance', () => {
			// SF Ferry Building → Oakland City Hall is roughly 10.5 km.
			const oakland = { lat: 37.8056, lng: -122.2727 };

			expect(haversineKm(ferryBuilding, oakland)).toBeCloseTo(10.8, 0);
		});

		it('is symmetric in its arguments', () => {
			const oakland = { lat: 37.8056, lng: -122.2727 };

			expect(haversineKm(ferryBuilding, oakland)).toBeCloseTo(
				haversineKm(oakland, ferryBuilding),
				9,
			);
		});
	});

	it('serializes to the inherited JSON shape', () => {
		const rule = new GeoProximityRule('location', { center: ferryBuilding, radiusKm: 5 });

		expect(rule.serialize()).toEqual({
			config: { center: ferryBuilding, radiusKm: 5 },
			field: 'location',
			type: 'GeoProximityRule',
		});
	});
});
