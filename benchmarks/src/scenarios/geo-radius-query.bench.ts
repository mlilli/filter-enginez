/**
 * `geo-radius-query` — time a "within X km of a point" query, the one scenario where the
 * `spatialIndex` axis is meaningful: `computeResults` builds the geo rule's bitmap via the R-tree
 * (bbox prune + haversine refine) when `spatialIndex:auto`, or a per-item haversine scan when
 * `spatialIndex:off`.
 *
 * @remarks
 * The wine corpus has no coordinates, so we synthesize deterministic lat/lng per wine via a function
 * field extractor (stable reference → the R-tree caches one tree keyed by that extractor). The
 * coordinates are benchmark fixtures, not real geography.
 *
 * @packageDocumentation
 */
import type { Wine } from '@filter-enginez/mock-data/wine';

import { type AccelerationOptions, createFilterEngine, geo, type GeoCoords } from '@filter-enginez/core';

import type { CorpusTier } from '../corpus.js';
import type { Scenario, ScenarioCell } from '../scenario.js';

import { consume } from '../sink.js';

/**
 * Center + radius of the benchmark query. A tight radius relative to the synthetic box (~1300 km
 * square) keeps the query selective — which is where the R-tree's bbox-prune pays off vs a full scan.
 */
const QUERY_CENTER: GeoCoords = { lat: 47, lng: 10 };
const QUERY_RADIUS_KM = 50;

/**
 * Derive deterministic synthetic coordinates for a wine — an FNV-1a hash of winery + vintage mapped
 * into a central-European bounding box. Benchmark fixtures only; not real locations.
 */
function syntheticCoords(wine: Wine): GeoCoords {
	let hash = 2_166_136_261;
	const key = `${wine.winery}:${wine.vintage}`;

	for (let i = 0; i < key.length; i++) {
		hash ^= key.charCodeAt(i);
		hash = Math.imul(hash, 16_777_619);
	}
	const primary = (hash >>> 0) / 0xffff_ffff;
	const secondary = ((hash >>> 8) & 0xffff) / 0xffff;

	// Box roughly covering France → Austria.
	return { lat: 42 + primary * 12, lng: -2 + secondary * 18 };
}

export const geoRadiusQueryScenario: Scenario = {
	applicableAxes: ['spatialIndex'],
	description: 'Find items within X km of a point — R-tree bitmap build vs per-item haversine scan.',
	id: 'geo-radius-query',
	setup(tier: CorpusTier, acceleration: AccelerationOptions): ScenarioCell {
		const engine = createFilterEngine<Wine>({ acceleration, sourceData: tier.data });

		engine.addRule(
			'near',
			geo((item) => syntheticCoords(item as Wine), { center: QUERY_CENTER, radiusKm: QUERY_RADIUS_KM }),
		);

		const run = (): void => {
			// Force a fresh geo-bitmap build each iteration so the `spatialIndex` axis is actually
			// exercised: the built bitmap is otherwise cached, and only the first build touches the
			// R-tree. Invalidating just the rule's bitmap keeps the (cached) R-tree, so this times
			// the radius query — R-tree bbox-prune + haversine-refine vs a full per-item scan.
			engine.bitmapIndex.invalidateRule('near');
			consume(engine.computeResults().length);
		};

		return {
			run,
			async teardown(): Promise<void> {
				await engine.destroy();
			},
		};
	},
	title: 'Geo radius query',
};
