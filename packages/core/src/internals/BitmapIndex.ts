/**
 * `BitmapIndex` — Roaring-Bitmap acceleration layer for filter intersection.
 *
 * @remarks
 * Per `docs/architecture.md` §6.1. For each active rule,
 * maintains a `RoaringBitmap32` where bit `i` is 1 iff source-data item `i` passes that rule.
 * Filter intersection then becomes a bitwise AND across bitmaps — O(rules) AND ops instead of
 * O(items × rules) predicate evaluations (42.1× faster than a predicate pass at 10k items with
 * warm bitmaps; see `benchmarks/RESULTS.md`).
 *
 * **The bitmap path serves conjunctions only.** It engages for flat-map mode when every filter
 * group is conjunctive and the working set is the source data. Expression mode, an `'or'` group
 * spanning two or more registered rules, or a narrowed working set make
 * {@link BitmapIndex.tryComputeResults} and {@link BitmapIndex.simulateIntersection} return
 * `null`, and the caller evaluates with the predicate path instead — same answer, different cost.
 *
 * **Lazy per-rule build.** A rule's bitmap is built on first access via predicate evaluation
 * across the current source data (`O(items)` per rule, one-time). Cached and reused; cleared
 * on `invalidateRule(ruleId)` (`RULE_CHANGED`) or `clear()` (`SOURCE_DATA_SET`).
 *
 * **Auto-engagement threshold.** In `'auto'` mode, the bitmap path engages when source data
 * length ≥ 500. Below that the bitmap-build cost (one predicate pass) exceeds the
 * intersection-time savings; above it the bitmap path strictly wins.
 *
 * @packageDocumentation
 */

import type { InternalStore } from '../store/InternalStore.js';
import type { FieldExtractor, RuleId, SimulationModification } from '../types.js';

import { isConjunctive } from '../composition/composeFlatExpression.js';
import { FilterEngineRuleError } from '../errors/index.js';
import { CompositeRule } from '../rules/CompositeRule.js';
import { type FilterRule, prepareRuleForCollection } from '../rules/FilterRule.js';
import { FuzzySearchRule } from '../rules/FuzzySearchRule.js';
import { GeoProximityRule } from '../rules/GeoProximityRule.js';
import { TextSearchRule } from '../rules/TextSearchRule.js';
// Bitmap library imports go through the `roaringInit` adapter, which:
//   - re-exports `RoaringBitmap32` so we don't depend on the library's module shape directly
//   - exposes `isBitmapAccelerationReady()` for the use-before-init guard below
//   - keeps the library swap (we went WASM-first for isomorphic browser support) in one
//     place rather than scattered across BitmapIndex
import {
	type AccelerationMode,
	AUTO_BITMAP_THRESHOLD,
	type SpatialIndexMode,
	TEXT_INDEX_AUTO_THRESHOLD,
	type TextIndexMode,
} from './accelerationModes.js';
import { isBitmapAccelerationReady, RoaringBitmap32 } from './roaringInit.js';
import { SpatialIndex } from './SpatialIndex.js';
import { TextInvertedIndex } from './TextInvertedIndex.js';
import { compileTextPlan } from './textPlan.js';

/**
 * Per-rule compressed bitmap index. Lazy-built, version-invalidated.
 */
export class BitmapIndex<T> {
	/**
	 * Per-rule bitmap cache. Built lazily on `getBitmap(ruleId)` call. Cleared per-rule on
	 * `invalidateRule` and fully on `clear()` / source-data version change.
	 */
	private readonly _bitmaps = new Map<RuleId, RoaringBitmap32>();

	/**
	 * The source-data version the cached bitmaps were built against. If the store's current
	 * version differs, all bitmaps are stale and must be cleared.
	 */
	private _cachedVersion = -1;

	/**
	 * Per-coordinate-source R-tree cache, keyed by the geo rule's `field` extractor (NOT the
	 * rule). The tree depends only on (source data, coordinate source), so all geo rules that
	 * read the same field share one tree and center/radius changes never rebuild it. Populated
	 * lazily by `_getSpatialIndexFor`; each `SpatialIndex` self-invalidates on a source-data
	 * version bump, and the map is dropped wholesale on `clear()`.
	 */
	private readonly _spatialIndexes = new Map<FieldExtractor, SpatialIndex<T>>();

	/**
	 * Per-field inverted-text-index cache, keyed by the text rule's `field` extractor (NOT the
	 * rule) — same rationale as the spatial cache: postings are a pure function of (source data,
	 * field), so all text rules on one field share an index and query changes never rebuild it.
	 * Each index self-invalidates on a source-data version bump; the map is dropped on `clear()`.
	 */
	private readonly _textIndexes = new Map<FieldExtractor, TextInvertedIndex<T>>();

	constructor(
		private readonly _store: InternalStore<T>,
		private readonly _mode: AccelerationMode = 'auto',
		private readonly _spatialMode: SpatialIndexMode = 'auto',
		private readonly _textMode: TextIndexMode = 'auto',
	) {}

	/**
	 * Whether the bitmap index is ready for queries — the configured mode allows the bitmap
	 * path AND there's source data to index. Consumers (notably `SimulationCache`) check this
	 * before reaching for the fast path; when `false`, they fall back to the predicate evaluator.
	 */
	get isReady(): boolean {
		return this.shouldUseBitmap();
	}

	/**
	 * Decide whether the bitmap path is the right choice for the current mode + data size.
	 *
	 * @remarks
	 * Three gates in order:
	 *
	 *   1. **Explicit override** — `'predicate'` always returns false; `'bitmap'` always tries
	 *      to engage (but still defers to gate 3 below — even an explicit `'bitmap'` request
	 *      can't actually intersect bitmaps if the WASM module isn't loaded yet).
	 *   2. **Data-size threshold** (auto mode only) — small datasets skip the bitmap path
	 *      because the index-build overhead exceeds the per-eval predicate cost.
	 *   3. **WASM readiness** — `roaring-wasm` initializes asynchronously in the browser. If
	 *      the consumer hasn't awaited `initializeBitmapAcceleration()` yet, we can't safely
	 *      construct `RoaringBitmap32` instances and must fall back to predicate. This gate
	 *      is the one that makes the engine usable in a browser app that hasn't yet completed
	 *      its WASM init (the early ticks of page load) without the engine throwing —
	 *      everything downstream of `shouldUseBitmap()` already knows to handle false by
	 *      routing through the predicate path.
	 */
	shouldUseBitmap(): boolean {
		if (this._mode === 'predicate') {
			return false;
		}
		// WASM-readiness gate — applies to BOTH 'bitmap' and 'auto'. Without this, an explicit
		// `accelerationMode: 'bitmap'` would attempt to construct RoaringBitmap32 before the
		// WASM module loaded and throw a runtime error.
		if (!isBitmapAccelerationReady()) {
			return false;
		}
		if (this._mode === 'bitmap') {
			return true;
		}

		// 'auto' — also size-gated.
		return this._store.sourceData.value.length >= AUTO_BITMAP_THRESHOLD;
	}

	/**
	 * Get (lazily building if needed) the bitmap for a rule.
	 *
	 * @param ruleId - The rule id to fetch the bitmap for. Must be currently registered.
	 * @returns A bitmap whose set bits are the source-data indices passing the rule
	 * @throws If `ruleId` isn't currently registered in the store
	 */
	getBitmap(ruleId: RuleId): RoaringBitmap32 {
		this._invalidateIfVersionChanged();

		const cached = this._bitmaps.get(ruleId);

		if (cached) {
			return cached;
		}

		const rule = this._store.rules.value.get(ruleId);

		if (!rule) {
			throw new FilterEngineRuleError(
				'RULE_NOT_FOUND',
				`BitmapIndex.getBitmap: rule '${ruleId}' is not registered. Call `
				+ `engine.addRule(ruleId, rule) first.`,
			);
		}

		const bitmap = this._buildBitmapForRule(rule);

		this._bitmaps.set(ruleId, bitmap);

		return bitmap;
	}

	// #region docs:bitmap-compute-results
	/**
	 * Compute the result indices for the currently-active rule set via bitwise AND of all
	 * rule bitmaps.
	 *
	 * @returns A `Uint32Array` of source-data indices that pass all active rules. Returns the
	 *   indices of all source data when no rules are active.
	 */
	computeResults(): Uint32Array {
		this._invalidateIfVersionChanged();

		const rules = this._store.rules.value;
		const items = this._store.sourceData.value;

		if (rules.size === 0) {
			// No active rules → all indices pass.
			const all = new Uint32Array(items.length);

			for (let i = 0; i < items.length; i++) {
				all[i] = i;
			}

			return all;
		}

		// Start with a clone of the smallest bitmap (smallest-first → fastest AND chain).
		const ruleIds = [...rules.keys()];
		const bitmapsForRules = ruleIds.map((id) => this.getBitmap(id));

		bitmapsForRules.sort((a, b) => a.size - b.size);

		const [smallest] = bitmapsForRules;

		/* v8 ignore next 3 -- defensive: rules.size > 0 checked above, so `smallest` is always defined; guard keeps access type-safe */
		if (smallest === undefined) {
			return new Uint32Array(0);
		}
		const accumulator = smallest.clone();

		for (let i = 1; i < bitmapsForRules.length; i++) {
			const next = bitmapsForRules[i];

			/* v8 ignore next 3 -- defensive: noUncheckedIndexedAccess guard; bitmapsForRules is dense */
			if (next === undefined) {
				continue;
			}
			accumulator.andInPlace(next);
			if (accumulator.size === 0) {
				break;
			} // Short-circuit on empty intersection.
		}

		return Uint32Array.from(accumulator.toArray());
	}
	// #endregion docs:bitmap-compute-results

	/**
	 * The accelerated answer to "which working-set positions pass?", or `null` when the bitmap
	 * path cannot give the exact answer right now. Declines when bitmaps are not engaged
	 * ({@link BitmapIndex.shouldUseBitmap}), in expression mode, when an `'or'` group spans two or
	 * more registered rules, and when the working set is not the source data (bitmaps index the
	 * source data). Installed as the store's results accelerator and used by
	 * `engine.computeResults()`.
	 *
	 * @returns Passing indices, ascending — identical to the predicate evaluator's — or `null`
	 */
	tryComputeResults(): Uint32Array | null {
		const store = this._store;

		if (store.expression.value !== null || store.workingSet.value !== store.sourceData.value) {
			return null;
		}
		if (!isConjunctive(store.rules.value.keys(), store.groups.value) || !this.shouldUseBitmap()) {
			return null;
		}

		return this.computeResults();
	}

	/**
	 * Build a one-off bitmap for an arbitrary rule over the current source data, through the same
	 * routes a registered rule's bitmap takes (R-tree for geo, inverted index for text, predicate
	 * scan otherwise). Not cached. Used by the exclusion graph for a hypothetical candidate rule.
	 * Requires bitmaps to be engaged ({@link BitmapIndex.isReady}).
	 */
	buildEphemeralBitmap(rule: FilterRule): RoaringBitmap32 {
		this._invalidateIfVersionChanged();

		return this._buildBitmapForRule(rule);
	}

	/**
	 * Hypothetical intersection for the simulation API — applies a modification to a clone of
	 * the active rule set, computes the resulting items, returns them.
	 *
	 * @param modification - The hypothetical modification to apply
	 * @returns The would-be result items, or `null` if the bitmap path can't handle this
	 *   modification. The caller falls back to predicate evaluation when `null` is returned.
	 *
	 * @remarks
	 * Modifications the bitmap path handles cleanly:
	 *   - `withRule: [id, rule]` — build the new rule's bitmap on the fly, AND it into the chain
	 *   - `withoutRule: id` — skip that rule's bitmap from the AND chain
	 *   - `ignoreRules: [ids]` — skip those rules' bitmaps from the AND chain
	 *
	 * Modifications the bitmap path declines:
	 *   - `withSourceData` — would invalidate the index against a different corpus
	 *   - `withExpression` set to a non-null `CompositeRule` (OR / NOT need recursive eval)
	 *   - Engine currently in expression mode (active expression isn't a simple AND chain)
	 *   - A working set that differs from the source data (bitmaps index the source data)
	 *   - An `'or'` group that would span two or more of the effective rules
	 */
	simulateIntersection(modification: SimulationModification): null | readonly T[] {
		if (!this._canSimulate(modification)) {
			return null;
		}

		const items = this._store.sourceData.value;
		const ignoredIds = new Set(modification.ignoreRules ?? []);

		// Build the effective rule list: start from active rules, apply withoutRule + ignoreRules.
		const ruleIds: RuleId[] = [];

		for (const id of this._store.rules.value.keys()) {
			if (ignoredIds.has(id)) {
				continue;
			}
			if (modification.withoutRule === id) {
				continue;
			}
			ruleIds.push(id);
		}
		const effectiveIds = modification.withRule ? [...ruleIds, modification.withRule[0]] : ruleIds;

		if (!isConjunctive(effectiveIds, this._store.groups.value)) {
			return null;
		}

		this._invalidateIfVersionChanged();

		// Build the working bitmap chain.
		const bitmaps: RoaringBitmap32[] = [];

		for (const id of ruleIds) {
			// If the with-rule's id matches an active rule, skip the cached version — the
			// WITH-version is added below.
			if (modification.withRule && modification.withRule[0] === id) {
				continue;
			}
			bitmaps.push(this.getBitmap(id));
		}

		// Append the withRule bitmap if present.
		if (modification.withRule) {
			const [, withRule] = modification.withRule;

			bitmaps.push(this._buildBitmapForRule(withRule));
		}

		if (bitmaps.length === 0) {
			// No effective rules → all items pass.
			return [...items];
		}

		// Sort smallest-first for fastest intersection, then AND.
		bitmaps.sort((a, b) => a.size - b.size);

		const [smallest] = bitmaps;

		/* v8 ignore next 3 -- defensive: bitmaps.length === 0 handled above, so `smallest` is always defined */
		if (smallest === undefined) {
			return [...items];
		}
		const accumulator = smallest.clone();

		for (let i = 1; i < bitmaps.length; i++) {
			const next = bitmaps[i];

			/* v8 ignore next 3 -- defensive: noUncheckedIndexedAccess guard; bitmaps is dense */
			if (next === undefined) {
				continue;
			}
			accumulator.andInPlace(next);
			if (accumulator.size === 0) {
				break;
			}
		}

		// Convert indices to items.
		const indices = accumulator.toArray();
		const result: T[] = [];

		for (const idx of indices) {
			const item = items[idx];

			/* v8 ignore next 3 -- defensive: items is dense; a bitmap index always resolves to an item */
			if (item === undefined) {
				continue;
			}
			result.push(item);
		}

		return result;
	}

	/** Invalidate the cached bitmap for a specific rule (on rule change). */
	invalidateRule(ruleId: RuleId): void {
		this._bitmaps.delete(ruleId);
	}

	/** Clear all bitmaps + spatial indexes (on source-data change / reset). */
	clear(): void {
		this._bitmaps.clear();
		this._spatialIndexes.clear();
		this._textIndexes.clear();
		this._cachedVersion = -1;
	}

	/** Diagnostic: how many per-rule bitmaps are currently cached. */
	get cachedBitmapCount(): number {
		return this._bitmaps.size;
	}

	// ─── Internal ──────────────────────────────────────────────────────────

	/**
	 * Whether the store and modification are within the bitmap path's competence: no data swap,
	 * no expression (current or hypothetical), the working set is the source data, and bitmaps
	 * are engaged. The group check needs the modified rule ids, so it stays in the caller.
	 */
	private _canSimulate(modification: SimulationModification): boolean {
		const store = this._store;

		return modification.withSourceData === undefined
			&& modification.withExpression === undefined
			&& store.expression.value === null
			&& store.workingSet.value === store.sourceData.value
			&& this.isReady;
	}

	// #region docs:bitmap-lazy-build
	/**
	 * Drop all cached bitmaps if the store's source-data version has advanced since the cache
	 * was built. Cheap O(1) check, called at the top of every public method that reads bitmaps.
	 */
	private _invalidateIfVersionChanged(): void {
		const currentVersion = this._store.sourceDataVersion.value;

		if (this._cachedVersion !== currentVersion) {
			this._bitmaps.clear();
			this._cachedVersion = currentVersion;
		}
	}

	/**
	 * Build the per-rule bitmap by predicate-evaluating each source-data item against the rule.
	 * One-time O(items) cost per rule; the bitmap caches forever (until invalidation).
	 *
	 * `CompositeRule` inputs would normally short-circuit through the predicate evaluator
	 * recursively, which works but defeats the bitmap-acceleration purpose. The
	 * `simulateIntersection` / `computeResults` callers only pass leaf rules into this method
	 * in typical use; for completeness we still evaluate composites here (correct but slow).
	 */
	private _buildBitmapForRule(rule: FilterRule): RoaringBitmap32 {
		// Geo-proximity acceleration: resolve the passing indices via the shared R-tree instead
		// of a per-item haversine scan. Gated on a positive radius so this stays bit-for-bit
		// identical to `GeoProximityRule.action` — which includes an item sitting *exactly* on
		// the center at radius 0 (distance 0 <= 0), a case `SpatialIndex.queryRadius` returns
		// empty for. At radius <= 0 (and when the R-tree is off) we fall through to the scan.
		if (rule instanceof GeoProximityRule && this._spatialMode !== 'off' && rule.config.radiusKm > 0) {
			return this._buildGeoBitmap(rule);
		}
		if ((rule instanceof TextSearchRule || rule instanceof FuzzySearchRule) && this._shouldUseTextIndex()) {
			const textBitmap = this._buildTextBitmap(rule);

			if (textBitmap !== null) {
				return textBitmap;
			}
			// Plan said bypass — fall through to the per-item predicate scan below.
		}
		const items = this._store.sourceData.value;
		const bitmap = new RoaringBitmap32();

		prepareRuleForCollection(rule, items);
		if (rule instanceof CompositeRule) {
			// Composite — defer to predicate evaluation per item. Rare in flat-map mode; the
			// normal arrival path for composites is `engine.setExpression(...)` which short-
			// circuits this whole code path via the expression-mode guard in
			// `simulateIntersection`.
			for (let i = 0; i < items.length; i++) {
				const item = items[i];

				if (item !== undefined && rule.action(item, rule)) {
					bitmap.add(i);
				}
			}

			return bitmap;
		}

		// Leaf rule — direct predicate evaluation.
		for (let i = 0; i < items.length; i++) {
			const item = items[i];

			if (item !== undefined && rule.action(item, rule)) {
				bitmap.add(i);
			}
		}

		return bitmap;
	}
	// #endregion docs:bitmap-lazy-build

	/**
	 * Build a geo rule's bitmap from its R-tree candidate set. `queryRadius` already does the
	 * exact haversine refinement, so its returned indices ARE the passing set — no re-check.
	 */
	private _buildGeoBitmap(rule: GeoProximityRule): RoaringBitmap32 {
		const bitmap = new RoaringBitmap32();
		const indices = this._getSpatialIndexFor(rule).queryRadius(rule.config.center, rule.config.radiusKm);

		for (const idx of indices) {
			bitmap.add(idx);
		}

		return bitmap;
	}

	/**
	 * Get (lazily building) the `SpatialIndex` for a geo rule's coordinate source. Keyed by the
	 * rule's `field` extractor so every geo rule reading the same field shares one tree; the
	 * representative rule's `extractCoords` supplies the `getLatLng` (pure over `field`, so any
	 * same-field rule yields identical coordinates).
	 */
	private _getSpatialIndexFor(rule: GeoProximityRule): SpatialIndex<T> {
		let index = this._spatialIndexes.get(rule.field);

		if (index === undefined) {
			index = new SpatialIndex<T>(this._store, (item) => rule.extractCoords(item));
			this._spatialIndexes.set(rule.field, index);
		}

		return index;
	}

	/**
	 * Build a text rule's bitmap via the inverted index when the compiled plan allows it, else
	 * return `null` so the caller falls back to the per-item predicate scan.
	 *
	 * - **authoritative** (`allWords`) — the AND of word postings IS the exact passing set.
	 * - **candidate** (fuzzy) — the trigram pre-filter is a superset of the Fuse matches; confirm
	 *   each survivor with the rule's exact per-item `action` (the sound bound guarantees nothing
	 *   real was pruned, so the confirmed set is exact).
	 * - **bypass** — `null`.
	 */
	private _buildTextBitmap(rule: FuzzySearchRule | TextSearchRule): RoaringBitmap32 | null {
		const plan = compileTextPlan(rule);

		if (plan.strategy === 'bypass') {
			return null;
		}
		const index = this._getTextIndexFor(rule);

		if (plan.strategy === 'authoritative') {
			return index.queryAllWords(plan.queryWords);
		}
		// Candidate: trigram pre-filter → exact Fuse confirm per surviving item.
		const items = this._store.sourceData.value;
		const candidates = index.queryFuzzyCandidates(plan.patternTrigrams, plan.minSharedTrigrams);
		const bitmap = new RoaringBitmap32();

		for (const idx of candidates) {
			const item = items[idx];

			if (item !== undefined && rule.action(item, rule)) {
				bitmap.add(idx);
			}
		}

		return bitmap;
	}

	/**
	 * Whether the inverted text index should serve text-rule bitmaps now: forced `'on'`, or `'auto'`
	 * at or above {@link TEXT_INDEX_AUTO_THRESHOLD}. `'off'` short-circuits to `false`.
	 */
	private _shouldUseTextIndex(): boolean {
		if (this._textMode === 'off') {
			return false;
		}
		if (this._textMode === 'on') {
			return true;
		}

		return this._store.sourceData.value.length >= TEXT_INDEX_AUTO_THRESHOLD;
	}

	/**
	 * Get (lazily building) the `TextInvertedIndex` for a text rule's field. Keyed by the rule's
	 * `field` extractor so every text rule on the same field shares one index (postings are a pure
	 * function of source data + field — the geo R-tree cache's rationale). The word + trigram maps
	 * inside build independently on first use.
	 */
	private _getTextIndexFor(rule: FuzzySearchRule | TextSearchRule): TextInvertedIndex<T> {
		let index = this._textIndexes.get(rule.field);

		if (index === undefined) {
			index = new TextInvertedIndex<T>(this._store, (item) => rule.extractText(item));
			this._textIndexes.set(rule.field, index);
		}

		return index;
	}
}
