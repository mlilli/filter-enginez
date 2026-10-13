/**
 * `GeoProximityRule` — passes items whose extracted lat/lng falls within a configured
 * radius of a center point.
 *
 * @remarks
 * Uses the haversine formula for great-circle distance on a spherical Earth approximation.
 * Distance is reported in kilometers; multiply by `0.621371` to convert to miles in consumer
 * code.
 *
 * While bitmaps are engaged, the engine builds this rule's bitmap through the R-tree spatial
 * index (`internals/SpatialIndex.ts`): a bounding-box prune, then the exact haversine check on
 * the surviving candidates only. `benchmarks/RESULTS.md` measures radius queries 165.5× faster
 * at 10k items and 216× at 130k.
 *
 * @packageDocumentation
 */

import type { FieldExtractor, FilterRuleAction } from '../types.js';

import { type GeoCoords, haversineKm } from '../lib/geo.js';
import { FilterRule } from './FilterRule.js';

// Re-export the shared geo primitives from this rule's public surface so importers
// (`@filter-enginez/core`'s barrel, consumer code) resolve `GeoCoords` / `haversineKm` here;
// the canonical definitions live in `lib/geo`.
export { type GeoCoords, haversineKm };

// #region docs:geo-proximity-rule
/**
 * Configuration for `GeoProximityRule`.
 */
export interface GeoProximityRuleConfig {
	readonly center: GeoCoords;
	/** Radius in kilometers. */
	readonly radiusKm: number;
}

/**
 * Filter items by proximity to a geographic point.
 *
 * The field extractor MUST return a `GeoCoords` object (or `undefined` for items without a
 * location, which fail the rule).
 *
 * @example
 *   // Items within 5 km of San Francisco's Ferry Building:
 *   engine.addRule(
 *     'near-ferry',
 *     new GeoProximityRule('location', {
 *       center: { lat: 37.7955, lng: -122.3937 },
 *       radiusKm: 5,
 *     }),
 *   );
 */
export class GeoProximityRule extends FilterRule {
	/**
	 * Minifier-proof wire name — see {@link FilterRule.ruleTypeName}. Declared as a literal so
	 * `ruleRegistry.register` can reject a key that disagrees with it at compile time.
	 */
	static override readonly ruleTypeName = 'GeoProximityRule';

	override action: FilterRuleAction = (item, rule): boolean => {
		const coords = this.extractCoords(item);

		if (coords === undefined) {
			return false;
		}
		const { center, radiusKm } = (rule as GeoProximityRule).config;

		return haversineKm(coords, center) <= radiusKm;
	};

	config: GeoProximityRuleConfig;

	constructor(field: FieldExtractor, config: GeoProximityRuleConfig) {
		super(field);
		this.config = config;
	}
	// #endregion docs:geo-proximity-rule

	/**
	 * Extract + validate the item's `GeoCoords`, returning `undefined` when the field is missing
	 * or either component isn't a number.
	 *
	 * @remarks
	 * Shared by `action` (the per-item predicate) and the engine's `SpatialIndex` (which needs a
	 * clean `getLatLng` over the same field). Centralizing the extract-and-validate here is what
	 * lets the R-tree acceleration path stay bit-for-bit consistent with the predicate path — the
	 * two can never drift on what counts as a valid coordinate.
	 */
	extractCoords(item: unknown): GeoCoords | undefined {
		const fieldValue = this.getFieldValue(item) as Partial<GeoCoords> | undefined;

		if (
			!fieldValue ||
			typeof fieldValue.lat !== 'number' ||
			typeof fieldValue.lng !== 'number'
		) {
			return undefined;
		}

		return fieldValue as GeoCoords;
	}
}
