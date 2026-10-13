/**
 * The acceleration-mode vocabulary and auto-engagement thresholds shared by `BitmapIndex`,
 * `createAccelerationStack` and `FilterEngineOptions`.
 *
 * @packageDocumentation
 */

/**
 * Acceleration mode selection for the engine's filter evaluation path.
 *
 * - `'bitmap'` — always use the Roaring Bitmap acceleration
 * - `'predicate'` — always use the per-item predicate evaluator (no acceleration)
 * - `'auto'` — engine picks based on `sourceData.length` (threshold 500 items)
 */
export type AccelerationMode = 'auto' | 'bitmap' | 'predicate';

/**
 * R-tree spatial-index engagement for `GeoProximityRule` bitmaps.
 *
 * - `'auto'` (default) — build a geo rule's bitmap via the `SpatialIndex` (bbox prune + exact
 *   haversine refinement) instead of a per-item haversine scan, when the radius is positive.
 * - `'off'` — always build geo bitmaps by the per-item predicate scan (no R-tree).
 *
 * Only affects the bitmap-build path; with `acceleration.bitmap: 'off'` no bitmaps are built at
 * all, so this setting is inert (same story as the exclusion graph).
 */
export type SpatialIndexMode = 'auto' | 'off';

/**
 * Inverted-text-index engagement for `TextSearchRule` (`'allWords'`) + `FuzzySearchRule` bitmaps.
 *
 * - `'auto'` (default) — engage the index only at source data ≥ {@link TEXT_INDEX_AUTO_THRESHOLD}
 *   items (below that a single predicate scan is sub-millisecond and the posting-build overhead
 *   isn't repaid — see the constant). When engaged, serve `'allWords'` from word postings
 *   (authoritative) and pre-filter fuzzy candidates from trigram postings before the Fuse confirm.
 * - `'on'` — always engage the index regardless of size (skips the floor).
 * - `'off'` — build those rules' bitmaps by the per-item predicate scan (no inverted index).
 *
 * Only affects the bitmap-build path; inert when `acceleration.bitmap: 'off'`.
 */
export type TextIndexMode = 'auto' | 'off' | 'on';

/**
 * Source-data-size threshold for `'auto'` mode — engage the bitmap path at or above this
 * many items. Below it, one predicate pass is already cheap enough that building per-rule
 * bitmaps does not pay for itself.
 */
export const AUTO_BITMAP_THRESHOLD = 500;

/**
 * Source-data-size floor for the inverted text index in `'auto'` mode — engage only at or above
 * this many items. Below it, a full per-item predicate scan for a text rule is already
 * sub-millisecond, so the one-time posting-build cost is pure overhead for a one-shot query. Set to
 * the bitmap threshold: the text index rides the bitmap-build path, which itself doesn't auto-engage
 * below this size.
 *
 * @remarks
 * A cold posting-build costs about as much as one predicate scan (both tokenize every item, and
 * Roaring adds a small constant factor), while a warm query is nearly flat and the scan grows
 * linearly — so the index wins from the second query on. `'auto'` waits until the scan itself
 * starts to cost (≥ this floor); `'on'` engages it at any size for repeated-query workloads.
 */
export const TEXT_INDEX_AUTO_THRESHOLD = 500;
