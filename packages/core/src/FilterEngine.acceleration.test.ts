/**
 * @remarks
 * Engine-level tests for the `acceleration` construction toggles beyond `bitmap` (which
 * `FilterEngine.test.ts` covers): the `exclusionGraph` build strategy (`'lazy'` | `'eager'` |
 * `'off'`) and the `simulationCache` on/off switch. These assert the wiring in the
 * `FilterEngine` constructor + `_maybeWarmExclusionGraph` — that `'eager'` keeps the graph warm
 * off the query hot path (re-precomputing after each rule mutation), `'lazy'` stays cold until
 * the first query, `'off'` stays inert, and `simulationCache: false` bypasses the memo layer
 * while `true` (default) memoizes.
 *
 * The bitmap layer runs in `'on'` mode against a real (WASM-initialized) Roaring backend so
 * `exclusionGraph.isReady` can actually flip true; `beforeAll` awaits
 * `initializeBitmapAcceleration()`.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { FilterEngine } from './FilterEngine.js';
import { initializeBitmapAcceleration } from './internals/roaringInit.js';
import { value } from './rules/factories.js';
import { GeoProximityRule } from './rules/GeoProximityRule.js';

interface Item {
	readonly color: string;
	readonly price: number;
}

interface Place {
	readonly location: { lat: number; lng: number };
	readonly name: string;
}

const SAMPLE: readonly Item[] = [
	{ color: 'red', price: 10 },
	{ color: 'red', price: 50 },
	{ color: 'blue', price: 30 },
	{ color: 'green', price: 70 },
];

const SF = { lat: 37.7749, lng: -122.4194 };

const PLACES: readonly Place[] = [
	{ location: SF, name: 'sf' },
	{ location: { lat: 37.8044, lng: -122.2712 }, name: 'oakland' },
	{ location: { lat: 40.7128, lng: -74.006 }, name: 'nyc' },
];

beforeAll(async () => {
	await initializeBitmapAcceleration();
});

describe('FilterEngine — acceleration.exclusionGraph', () => {
	it('eager keeps the graph warm after each rule mutation, off the query path', () => {
		const engine = new FilterEngine<Item>({
			acceleration: { bitmap: 'on', exclusionGraph: 'eager' },
			sourceData: SAMPLE,
		});

		engine.addRule('red', value('color', 'red'));
		engine.addRule('blue', value('color', 'blue'));

		// No query was issued — eager re-warming alone should have built a fresh graph.
		expect(engine.exclusionGraph.isReady).toBe(true);
		// red {0,1} and blue {2} are disjoint.
		expect(engine.exclusionGraph.areExclusive('red', 'blue')).toBe(true);
	});

	it('lazy (default) leaves the graph cold until the first query', () => {
		// `exclusionGraph` omitted -> defaults to 'lazy'.
		const engine = new FilterEngine<Item>({
			acceleration: { bitmap: 'on' },
			sourceData: SAMPLE,
		});

		engine.addRule('red', value('color', 'red'));
		engine.addRule('blue', value('color', 'blue'));

		// Not warmed — lazy builds on demand.
		expect(engine.exclusionGraph.isReady).toBe(false);

		// The first query builds it.
		expect(engine.exclusionGraph.areExclusive('red', 'blue')).toBe(true);
		expect(engine.exclusionGraph.isReady).toBe(true);
	});

	it('off keeps the graph inert regardless of the data', () => {
		const engine = new FilterEngine<Item>({
			acceleration: { bitmap: 'on', exclusionGraph: 'off' },
			sourceData: SAMPLE,
		});

		engine.addRule('red', value('color', 'red'));
		engine.addRule('blue', value('color', 'blue'));

		expect(engine.exclusionGraph.isReady).toBe(false);
		expect(engine.exclusionGraph.areExclusive('red', 'blue')).toBe(false);
		expect(engine.exclusionGraph.getExclusions('red')).toEqual([]);
	});
});

describe('FilterEngine — acceleration.simulationCache', () => {
	it('false recomputes every simulate without populating the cache', () => {
		const engine = new FilterEngine<Item>({
			acceleration: { simulationCache: false },
			sourceData: SAMPLE,
		});

		const first = engine.simulate({ withRule: ['red', value('color', 'red')]});
		const second = engine.simulate({ withRule: ['red', value('color', 'red')]});

		expect(first.resultCount).toBe(2);
		expect(second.resultCount).toBe(2);
		// Recomputed, not memoized — distinct instances, empty cache.
		expect(second).not.toBe(first);
		expect(engine.simulationCache.size).toBe(0);
	});

	it('true (default) memoizes identical simulations', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });

		const first = engine.simulate({ withRule: ['red', value('color', 'red')]});
		const second = engine.simulate({ withRule: ['red', value('color', 'red')]});

		// Content-identical modifications fold to the same cache key -> same instance served.
		expect(second).toBe(first);
		expect(engine.simulationCache.size).toBe(1);
	});
});

describe('FilterEngine — acceleration.spatialIndex', () => {
	/** Simulate a 50 km proximity filter around SF under the given spatial-index mode. */
	function simulateNearSf(spatialIndex: 'auto' | 'off'): number {
		// bitmap: 'on' forces the bitmap path so simulate() runs simulateIntersection -> the geo
		// bitmap build, which is where the R-tree engages (or not).
		const engine = new FilterEngine<Place>({
			acceleration: { bitmap: 'on', spatialIndex },
			sourceData: PLACES,
		});

		return engine.simulate({
			withRule: ['near', new GeoProximityRule('location', { center: SF, radiusKm: 50 })],
		}).resultCount;
	}

	it('auto (R-tree) and off (haversine) yield identical geo simulations', () => {
		// SF + Oakland are within 50 km; NYC is not — both paths must agree.
		expect(simulateNearSf('auto')).toBe(2);
		expect(simulateNearSf('off')).toBe(simulateNearSf('auto'));
	});
});
