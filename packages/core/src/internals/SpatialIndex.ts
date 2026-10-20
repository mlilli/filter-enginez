/**
 * `SpatialIndex` — R-tree spatial acceleration for `GeoProximityRule` queries.
 *
 * @remarks
 * Per `docs/architecture.md` §6.2. Used for every `GeoProximityRule` bitmap build with a positive
 * radius (unless `acceleration.spatialIndex: 'off'`). Naive geo evaluation is O(items) haversine
 * computations per query; R-tree pruning narrows candidates to the radius's bounding box, then exact
 * distance check on the post-prune candidate set. Measured on 2026-10-15 over the synthetic wine
 * tiers (`benchmarks/RESULTS.md`): 298.5× faster than the scan at 10k items and 290.9× at 150k.
 *
 * **Two-phase query.**
 *
 *   1. **Bounding-box prune** — convert `(center, radiusKm)` into the lat/lng bbox of the
 *      spherical cap, query the R-tree, get a superset of candidates whose AABB intersects it.
 *      A cap that crosses ±180° is searched as two boxes, one on each side.
 *   2. **Exact haversine refinement** — for each candidate, compute the true great-circle
 *      distance and filter by `radiusKm`. A box over-includes a small cap by about `4/π` (its
 *      corners), so the refinement step typically discards ~21% of candidates.
 *
 * **Bbox geometry.** A radius of `r` km is an angular radius `d = r / R` on the sphere (`R` is
 * {@link EARTH_RADIUS_KM}). From latitude `φ` the cap covers
 *   - `d` of latitude either side (1° lat ≈ 111 km everywhere on Earth), and
 *   - `asin(sin d / cos φ)` of longitude either side, the cap's widest point (which lies poleward
 *     of `φ`, so `d / cos φ` would cut its flanks off).
 *
 * When the cap reaches a pole (`φ + d ≥ 90°` or `φ − d ≤ −90°`) it covers every longitude, and the
 * box spans them all. Both extents carry a small margin so floating-point rounding can never prune
 * an item the exact check would keep: the bitmap answer equals the per-item `GeoProximityRule`
 * scan for every center and radius. Coordinates follow the `GeoCoords` convention, `lng` in
 * [-180, 180].
 *
 * **Lazy build + version invalidation.** The R-tree is built on first `queryRadius()` call
 * and rebuilt automatically when the store's `sourceDataVersion` advances. Items whose
 * extracted coordinates are `undefined` are skipped entirely (they can never match a geo
 * proximity query and shouldn't bloat the tree).
 *
 * @packageDocumentation
 */

// `rbush@4` ambient types live in `../types/rbush.d.ts` (see that file for rationale).
import RBush from 'rbush';

import type { InternalStore } from '../store/InternalStore.js';

import { EARTH_RADIUS_KM, type GeoCoords, haversineKm, toRadians } from '../lib/geo.js';

// Re-export the shared coordinate type so `internals/index.ts` (`GeoCoords as SpatialGeoCoords`)
// and this module's test keep importing it from here even though the canonical home is `lib/geo`.
export type { GeoCoords };

// #region docs:spatial-index-entry
/**
 * One R-tree entry — a point bbox plus the source-data index it points at.
 *
 * @internal
 */
interface SpatialIndexEntry {
	readonly idx: number;
	readonly lat: number;
	readonly lng: number;
	readonly maxX: number;
	readonly maxY: number;
	readonly minX: number;
	readonly minY: number;
}
// #endregion docs:spatial-index-entry

/**
 * Degrees per kilometer of latitude — essentially `1 / 111`. Constant everywhere on Earth.
 * Derived from the shared {@link EARTH_RADIUS_KM} so the bbox math tracks the haversine math.
 */
const DEGREES_PER_KM_LAT = 1 / (EARTH_RADIUS_KM * Math.PI / 180);

/**
 * Degrees added to each bbox extent so rounding in the bbox math can never prune an item the exact
 * haversine check keeps. About 0.1 m — far below anything the refinement step would notice.
 */
const BBOX_MARGIN_DEGREES = 1e-6;

/** One axis-aligned search box, in the R-tree's `minX`/`maxX` (lng), `minY`/`maxY` (lat) terms. */
interface SearchBox {
	readonly maxX: number;
	readonly maxY: number;
	readonly minX: number;
	readonly minY: number;
}

/**
 * The boxes covering the spherical cap of `radiusKm` around `center`: one box, or two when the cap
 * crosses ±180°, or one full longitude band when it reaches a pole.
 *
 * @param center - The cap's center
 * @param radiusKm - Its radius, positive
 * @returns Boxes whose union holds every point within `radiusKm` of `center`
 */
function capSearchBoxes(center: GeoCoords, radiusKm: number): readonly SearchBox[] {
	const angularRadius = radiusKm / EARTH_RADIUS_KM;
	const deltaLat = radiusKm * DEGREES_PER_KM_LAT + BBOX_MARGIN_DEGREES;
	const minY = center.lat - deltaLat;
	const maxY = center.lat + deltaLat;

	// The cap holds a pole: every longitude. Otherwise `d < 90° − |φ|`, so `sinRatio < 1`.
	if (maxY >= 90 || minY <= -90) {
		return [{ maxX: Number.POSITIVE_INFINITY, maxY, minX: Number.NEGATIVE_INFINITY, minY }];
	}
	const sinRatio = Math.sin(angularRadius) / Math.cos(toRadians(center.lat));
	const deltaLng = Math.asin(sinRatio) * 180 / Math.PI + BBOX_MARGIN_DEGREES;
	const minX = center.lng - deltaLng;
	const maxX = center.lng + deltaLng;

	if (minX < -180) {
		return [{ maxX, maxY, minX: -180, minY }, { maxX: 180, maxY, minX: minX + 360, minY }];
	}
	if (maxX > 180) {
		return [{ maxX: 180, maxY, minX, minY }, { maxX: maxX - 360, maxY, minX: -180, minY }];
	}

	return [{ maxX, maxY, minX, minY }];
}

/**
 * R-tree spatial index for radius queries.
 */
export class SpatialIndex<T> {
	private _cachedVersion = -1;
	private _tree: RBush<SpatialIndexEntry> | undefined;

	constructor(
		private readonly _store: InternalStore<T>,
		private readonly _getLatLng: (item: T) => GeoCoords | undefined,
	) {}

	/**
	 * Whether the spatial index has built indices and is ready for queries. Useful for
	 * diagnostics; callers don't need to gate on this — `queryRadius` builds lazily.
	 */
	get isReady(): boolean {
		return this._tree !== undefined && this._cachedVersion === this._store.sourceDataVersion.value;
	}

	// #region docs:spatial-query-radius
	/**
	 * Find the source-data indices within `radiusKm` of `center`. Uses R-tree bounding-box
	 * pruning + exact haversine distance check on candidates.
	 *
	 * @param center - The center point of the query
	 * @param radiusKm - The radius in kilometers
	 * @returns Array of source-data indices that lie within `radiusKm` of `center`
	 */
	queryRadius(center: GeoCoords, radiusKm: number): number[] {
		this._ensureBuilt();
		/* v8 ignore next 3 -- defensive: _ensureBuilt() always assigns _tree, so it is never falsy here */
		if (!this._tree) {
			return [];
		}
		if (radiusKm <= 0) {
			return [];
		}

		// Bounding-box prune via the R-tree, then exact haversine refinement. The two boxes of a cap
		// that crosses ±180° are disjoint, so no index is reported twice.
		const result: number[] = [];

		for (const box of capSearchBoxes(center, radiusKm)) {
			for (const entry of this._tree.search(box)) {
				if (haversineKm({ lat: entry.lat, lng: entry.lng }, center) <= radiusKm) {
					result.push(entry.idx);
				}
			}
		}

		return result;
	}
	// #endregion docs:spatial-query-radius

	/**
	 * Force-rebuild the index. Usually unnecessary — `queryRadius` auto-rebuilds when
	 * `sourceDataVersion` advances. Exposed for consumers who mutate items in place (which is
	 * discouraged but does happen) and need to invalidate explicitly.
	 */
	rebuild(): void {
		this._cachedVersion = -1;
		this._ensureBuilt();
	}

	/** Drop the index. Next `queryRadius` rebuilds from scratch. */
	clear(): void {
		this._tree = undefined;
		this._cachedVersion = -1;
	}

	// ─── Internal ──────────────────────────────────────────────────────────

	/**
	 * Build (or rebuild) the R-tree if it's stale relative to the current source-data version.
	 * Bulk-loads via `tree.load(entries)` which is ~3× faster than per-item `insert`.
	 */
	private _ensureBuilt(): void {
		const currentVersion = this._store.sourceDataVersion.value;

		if (this._tree && this._cachedVersion === currentVersion) {
			return;
		}

		const items = this._store.sourceData.value;
		const entries: SpatialIndexEntry[] = [];

		for (let i = 0; i < items.length; i++) {
			const item = items[i];

			if (item === undefined) {
				continue;
			}
			const coords = this._getLatLng(item);

			if (!coords || typeof coords.lat !== 'number' || typeof coords.lng !== 'number') {
				continue;
			}
			entries.push({
				idx: i,
				lat: coords.lat,
				lng: coords.lng,
				maxX: coords.lng,
				maxY: coords.lat,
				minX: coords.lng,
				minY: coords.lat,
			});
		}

		const tree = new RBush<SpatialIndexEntry>();

		if (entries.length > 0) {
			tree.load(entries);
		}
		this._tree = tree;
		this._cachedVersion = currentVersion;
	}
}
