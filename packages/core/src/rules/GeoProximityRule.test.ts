/**
 * Tests for `GeoProximityRule` — haversine radius filter around a center point.
 *
 * @remarks
 * Covers the `action` guard (missing value, non-number lat, non-number lng) and the inside /
 * boundary / outside radius outcomes, the public `extractCoords` (which `action` and the engine's
 * `SpatialIndex` share), plus the exported `haversineKm` helper directly: a known distance, the
 * zero-distance identity, and symmetry. The boundary case uses a point placed at exactly the
 * configured radius via `haversineKm` so the `<=` comparison's equality edge is hit. The
 * `static deserialize` hook: a `null` radius (what JSON writes for `Infinity`) revives as unlimited,
 * extra keys carry over in the config and the center, a registered subclass revives as itself, and a
 * center that is not an object, a non-finite coordinate, or a radius that is not a number throws.
 */

import { describe, expect, it } from 'vitest';

import type { SerializedRule } from '../types.js';

import { FilterEngineRuleError } from '../errors/index.js';
import { GeoProximityRule, haversineKm } from './GeoProximityRule.js';
import { RuleRegistry } from './ruleRegistry.js';

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

	describe('deserialize', () => {
		it('revives a null radius — what JSON writes for Infinity — as unlimited', () => {
			const original = new GeoProximityRule('location', { center: ferryBuilding, radiusKm: Number.POSITIVE_INFINITY });
			const rule = GeoProximityRule.deserialize(JSON.parse(JSON.stringify(original.serialize())) as SerializedRule);

			expect(rule.config).toEqual({ center: ferryBuilding, radiusKm: Number.POSITIVE_INFINITY });
			expect(rule.action({ location: { lat: -33.8688, lng: 151.2093 }}, rule)).toBe(true);
		});

		it('carries extra keys over, in the config and in the center', () => {
			const rule = GeoProximityRule.deserialize({
				config: { center: { ...ferryBuilding, label: 'Ferry Building' }, radiusKm: 5, unit: 'km' },
				field: 'location',
				type: 'GeoProximityRule',
			});

			expect(rule.config).toEqual({ center: { ...ferryBuilding, label: 'Ferry Building' }, radiusKm: 5, unit: 'km' });
		});

		it('revives as the class registered under its name, so a replacing subclass revives as itself', () => {
			/** A subclass registered in place of the built-in. */
			class AuditedProximity extends GeoProximityRule {
				readonly isAudited = true;
			}
			const registry = new RuleRegistry();

			registry.unregister('GeoProximityRule');
			registry.register('GeoProximityRule', AuditedProximity);

			expect(registry.deserialize({ config: { center: ferryBuilding, radiusKm: 1 }, field: 'location', type: 'GeoProximityRule' }))
				.toBeInstanceOf(AuditedProximity);
		});

		it.each([
			[{ radiusKm: 5 }, 'GeoProximityRule config.center must be an object; got undefined.'],
			[{ center: { lat: null, lng: 0 }, radiusKm: 5 }, 'GeoProximityRule config.center.lat must be a finite number; got null.'],
			[{ center: { lat: 0, lng: Number.NaN }, radiusKm: 5 }, 'GeoProximityRule config.center.lng must be a finite number; got NaN.'],
			[{ center: ferryBuilding, radiusKm: '5' }, 'GeoProximityRule config.radiusKm must be a number, or null for an open bound; got "5".'],
		])('rejects the config %o', (config, message) => {
			expect(() => GeoProximityRule.deserialize({ config, field: 'location', type: 'GeoProximityRule' })).toThrowError(FilterEngineRuleError);
			expect(() => GeoProximityRule.deserialize({ config, field: 'location', type: 'GeoProximityRule' })).toThrowError(message);
		});
	});
});
