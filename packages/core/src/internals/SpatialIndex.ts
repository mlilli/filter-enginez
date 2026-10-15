/**
 * `SpatialIndex` — R-tree spatial acceleration for `GeoProximityRule` queries.
 *
 * @remarks
 * Per `docs/architecture.md` §6.2. Used for every `GeoProximityRule` bitmap build with a positive
 * radius (unless `acceleration.spatialIndex: 'off'`). Naive geo evaluation is O(items) haversine
 * computations per query; R-tree pruning narrows candidates to the radius's bounding box, then exact
 * distance check on the post-prune candidate set. Measured in July 2026 on the local real wine
 * corpus (`benchmarks/RESULTS.md`): 165.5× faster than the scan on its 10k sample and 216× over all
 * 129,907 reviews.
 *
 * **Two-phase query.**
 *
 *   1. **Bounding-box prune** — convert `(center, radiusKm)` into a square lat/lng bbox,
 *      query the R-tree, get a superset of candidates whose AABB intersects the bbox.
 *   2. **Exact haversine refinement** — for each candidate, compute the true great-circle
 *      distance and filter by `radiusKm`. The square bbox over-includes by a factor of `4/π`
 *      (the corners), so the refinement step typically discards ~21% of candidates.
 *
 * **Bbox geometry.** A radius of `r` km from latitude `centerLat` covers
 *   - `r / 111` degrees of latitude (1° lat ≈ 111 km everywhere on Earth), and
 *   - `r / (111 * cos(centerLat))` degrees of longitude (1° lng narrows toward the poles).
 *
 * The `cos(centerLat)` factor is clamped to a small floor (0.01) so polar-region queries
 * don't divide by zero. Date-line-spanning queries are NOT supported — the bbox assumes
 * contiguous longitude, so items on the far side of ±180° are pruned before the exact check.
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
 * Minimum value used for `cos(lat)` when computing the longitudinal degree spread. Prevents
 * divide-by-zero at the poles. At `cos(lat) = 0.01` the bbox spans ~100°, large enough that
 * any meaningful query degenerates to a near-global scan — acceptable since polar regions
 * are a rare query target.
 */
const COS_LAT_FLOOR = 0.01;

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

		// Compute the lat/lng bbox.
		const deltaLat = radiusKm * DEGREES_PER_KM_LAT;
		const cosLat = Math.max(Math.cos(toRadians(center.lat)), COS_LAT_FLOOR);
		const deltaLng = radiusKm * DEGREES_PER_KM_LAT / cosLat;

		const bbox = {
			maxX: center.lng + deltaLng,
			maxY: center.lat + deltaLat,
			minX: center.lng - deltaLng,
			minY: center.lat - deltaLat,
		};

		// Bounding-box prune via the R-tree.
		const candidates = this._tree.search(bbox);

		// Exact haversine refinement.
		const result: number[] = [];

		for (const entry of candidates) {
			const distance = haversineKm({ lat: entry.lat, lng: entry.lng }, center);

			if (distance <= radiusKm) {
				result.push(entry.idx);
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
