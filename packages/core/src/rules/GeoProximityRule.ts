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
 * the surviving candidates only. `benchmarks/RESULTS.md` measured radius queries on 2026-10-15
 * over the synthetic wine tiers: 298.5× faster than the scan at 10k items and 290.9× at 150k.
 *
 * An unlimited radius survives JSON: `JSON.stringify` writes `radiusKm: Infinity` as `null`, and
 * {@link GeoProximityRule.deserialize} reads a `null` radius back as `Infinity`.
 *
 * @packageDocumentation
 */

import type { FieldExtractor, FilterRuleAction, SerializedRule } from '../types.js';

import { type GeoCoords, haversineKm } from '../lib/geo.js';
import { FilterRule } from './FilterRule.js';
import { readRecord, reviveBounds, revivedField, reviveFiniteNumber } from './serializedConfig.js';

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
	/** Radius in kilometers. `Infinity` for no limit; JSON writes it as `null`. */
	readonly radiusKm: number;
}

/**
 * Filter items by proximity to a geographic point.
 *
 * The field extractor MUST return a `GeoCoords` object (or `undefined` for items without a
 * location, which fail the rule).
 *
 * Name the field by path, as below, for a rule that is exported, put in a URL, or sent to a worker
 * or server: a function extractor serializes as `'<function>'` and loads back as "the item itself",
 * which carries no `lat` / `lng`, so the loaded rule matches nothing. Data whose coordinates are
 * shaped differently (`{ lat, lon }`, say) gets a `{ lat, lng }` field of its own.
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

	/**
	 * Revive a `GeoProximityRule` from its serialized form. `ruleRegistry.deserialize` calls this hook
	 * with the registered class as `this`, so a subclass registered in its place revives as
	 * itself.
	 *
	 * @remarks
	 * A `null` radius is an unlimited one (`Infinity`), which is what `JSON.stringify` writes for
	 * `Infinity`. The center has no open form, so its `lat` and `lng` must be finite numbers: a `null`
	 * coordinate would otherwise compute distances from `0`. Any other config keys are carried over
	 * unchanged.
	 *
	 * @param json - The serialized rule
	 * @returns The revived rule
	 * @throws `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG` when `config` or
	 *   `config.center` is not an object, a center coordinate is not a finite number, or `radiusKm` is
	 *   neither a number nor `null`
	 */
	static deserialize(this: GeoProximityRuleClass, json: SerializedRule): GeoProximityRule {
		const config = reviveBounds(json, { radiusKm: Number.POSITIVE_INFINITY });
		const { center: serializedCenter } = config;
		const center = readRecord(serializedCenter, `${json.type} config.center`);
		const { lat, lng } = center;

		return new this(revivedField(json), {
			...config,
			center: {
				...center,
				lat: reviveFiniteNumber(lat, `${json.type} config.center.lat`),
				lng: reviveFiniteNumber(lng, `${json.type} config.center.lng`),
			},
		});
	}
}

/** A constructor with `GeoProximityRule`'s signature: the class itself, or a subclass that keeps it. */
type GeoProximityRuleClass = new (field: FieldExtractor, config: GeoProximityRuleConfig) => GeoProximityRule;
