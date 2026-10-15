/**
 * `TextInvertedIndex` — Roaring-backed word + character-trigram postings that accelerate
 * `TextSearchRule`'s `'allWords'` mode and `FuzzySearchRule`.
 *
 * @remarks
 * Per `docs/architecture.md` §8a (Consumer 2). Lives INSIDE `BitmapIndex` (the `SpatialIndex`
 * precedent), keyed per field, so the bitmap it produces composes with the other rules' bitmaps
 * in one native intersection. Two posting maps, built **lazily and separately**:
 *
 *   - `words` — `word → RoaringBitmap32` of source-data indices whose field contains that whole
 *     word. Powers `allWords` **authoritatively**: `queryAllWords` ANDs the query words' postings
 *     and the result IS the passing set (no confirm). Built only when a `'allWords'` rule asks.
 *   - `trigrams` — `trigram → RoaringBitmap32` of indices whose field contains that character
 *     trigram. Powers the fuzzy **candidate** pre-filter: `queryFuzzyCandidates` keeps indices
 *     sharing ≥ `minSharedTrigrams` of the pattern's distinct trigrams — a provable superset of the
 *     Fuse matches (see `fuzzyTrigramBound`), which the caller confirms with the exact Fuse pass.
 *     Built only when a fuzzy pattern with a usable bound asks.
 *
 * **Normalization.** Field text and query tokens are lowercased — matching Fuse's case-insensitive
 * default and the `allWords` case-insensitive path. Case-sensitive `allWords` and multi-key fuzzy
 * are bypassed upstream (see `textPlan`), so the lowercase index never has to serve them.
 *
 * **Lazy build + version invalidation.** Each posting map builds on first use and rebuilds when the
 * store's `sourceDataVersion` advances (a whole rebuild — the same coarse invalidation the bitmap
 * and spatial layers use). Items whose extracted text is `undefined` (missing / non-string field)
 * are skipped entirely; they can never match a text query. Postings are `runOptimize`d after build
 * so dense runs compress.
 *
 * @packageDocumentation
 */

import type { InternalStore } from '../store/InternalStore.js';

import { distinctTrigrams, extractWords } from '../lib/textTokens.js';
import { RoaringBitmap32 } from './roaringInit.js';

/**
 * Per-field inverted text index. Constructed + cached by `BitmapIndex`; not used directly by
 * consumers (though exported for advanced use + the benchmark suite).
 *
 * @typeParam T - The source-data item type
 */
export class TextInvertedIndex<T> {
	private _trigrams: Map<string, RoaringBitmap32> | undefined;
	private _trigramsVersion = -1;
	private _words: Map<string, RoaringBitmap32> | undefined;
	private _wordsVersion = -1;

	/**
	 * @param _store - The engine's store — source of the data + the version counter
	 * @param _getText - Extracts the item's text field as a string (or `undefined` when the field
	 *   is missing / non-string). Supplied by `BitmapIndex` from the rule's field extractor so the
	 *   index and the rule's predicate resolve fields identically.
	 */
	constructor(
		private readonly _store: InternalStore<T>,
		private readonly _getText: (item: T) => string | undefined,
	) {}

	/**
	 * Whether either posting map is built and current — diagnostic only; the query methods build
	 * lazily, so callers never need to gate on this.
	 */
	get isReady(): boolean {
		const version = this._store.sourceDataVersion.value;

		return (this._words !== undefined && this._wordsVersion === version)
			|| (this._trigrams !== undefined && this._trigramsVersion === version);
	}

	/**
	 * The exact set of source-data indices whose field contains EVERY query word (as a whole word)
	 * — the AND of the per-word postings.
	 *
	 * @param queryWords - The (already-lowercased, distinct-enough) query words. An empty list, or
	 *   any word absent from the index, yields an empty bitmap.
	 * @returns A fresh `RoaringBitmap32` of the passing indices (owned by the caller)
	 */
	queryAllWords(queryWords: readonly string[]): RoaringBitmap32 {
		const words = this._ensureWords();
		let accumulator: RoaringBitmap32 | undefined;

		for (const word of queryWords) {
			const posting = words.get(word);

			if (posting === undefined) {
				// A required word has no posting → nothing can contain all query words.
				return new RoaringBitmap32();
			}
			if (accumulator === undefined) {
				accumulator = posting.clone();
			} else {
				accumulator.andInPlace(posting);
			}
			if (accumulator.size === 0) {
				return accumulator;
			}
		}

		return accumulator ?? new RoaringBitmap32();
	}

	/**
	 * The candidate source-data indices for a fuzzy pattern — those sharing at least
	 * `minSharedTrigrams` of the pattern's distinct trigrams. A provable SUPERSET of the Fuse
	 * matches (the sound bound guarantees no real match is dropped); the caller MUST confirm each
	 * with the exact per-item Fuse pass before treating it as a match.
	 *
	 * @remarks
	 * The count accumulator is a `Uint16Array(N)` (posting ids increment into it; a final scan
	 * collects ids at or above the bound). A one-off micro-benchmark against a `Map<idx, count>`
	 * (2026-07-08, over the 129,907-review real wine corpus; not part of `benchmarks/`) found the
	 * typed array winning whenever the pattern's trigram postings are more than ~2% dense over the
	 * corpus — which real query trigrams are (dense, the `Map` ran up to ~9× slower) — and the only
	 * regime the `Map` won (rare-trigram queries over a huge corpus) under 100 µs either way, so the
	 * typed array stays. Counts are bounded by the pattern's distinct-trigram count (≤ ~30, patterns
	 * being ≤ 32 chars), well within `Uint16`.
	 *
	 * @param patternTrigrams - The pattern's DISTINCT lowercased trigrams (duplicates would
	 *   over-count and break the bound)
	 * @param minSharedTrigrams - The sound minimum shared-trigram count from `fuzzyTrigramBound`
	 * @returns The candidate indices in ascending order
	 */
	queryFuzzyCandidates(patternTrigrams: readonly string[], minSharedTrigrams: number): readonly number[] {
		const trigrams = this._ensureTrigrams();
		const counts = new Uint16Array(this._store.sourceData.value.length);

		for (const trigram of patternTrigrams) {
			const posting = trigrams.get(trigram);

			if (posting === undefined) {
				continue;
			}
			for (const idx of posting.toArray()) {
				/* v8 ignore next -- defensive: noUncheckedIndexedAccess fallback; idx is an in-bounds posting index */
				counts[idx] = (counts[idx] ?? 0) + 1;
			}
		}
		const candidates: number[] = [];

		for (let i = 0; i < counts.length; i++) {
			/* v8 ignore next -- defensive: noUncheckedIndexedAccess fallback; i < counts.length */
			const sharedCount = counts[i] ?? 0;

			if (sharedCount >= minSharedTrigrams) {
				candidates.push(i);
			}
		}

		return candidates;
	}

	/** Drop both posting maps. Next query rebuilds from scratch. */
	clear(): void {
		this._trigrams = undefined;
		this._trigramsVersion = -1;
		this._words = undefined;
		this._wordsVersion = -1;
	}

	// ─── Internal ──────────────────────────────────────────────────────────

	/** Get (lazily building / rebuilding on a version bump) the whole-word posting map. */
	private _ensureWords(): Map<string, RoaringBitmap32> {
		const version = this._store.sourceDataVersion.value;

		if (this._words !== undefined && this._wordsVersion === version) {
			return this._words;
		}
		this._words = this._buildPostings((normalizedText) => new Set(extractWords(normalizedText)));
		this._wordsVersion = version;

		return this._words;
	}

	/** Get (lazily building / rebuilding on a version bump) the character-trigram posting map. */
	private _ensureTrigrams(): Map<string, RoaringBitmap32> {
		const version = this._store.sourceDataVersion.value;

		if (this._trigrams !== undefined && this._trigramsVersion === version) {
			return this._trigrams;
		}
		this._trigrams = this._buildPostings((normalizedText) => distinctTrigrams(normalizedText));
		this._trigramsVersion = version;

		return this._trigrams;
	}

	/**
	 * Build a posting map by tokenizing each item's lowercased field text and adding the item's
	 * index to every token's bitmap. Indices are added in ascending order (append-sorted, cheap for
	 * Roaring); each posting is `runOptimize`d at the end. Shared by the word + trigram builds — the
	 * only difference is the `tokenize` function (distinct words vs distinct trigrams).
	 *
	 * @param tokenize - Maps one item's already-lowercased field text to its distinct tokens
	 */
	private _buildPostings(tokenize: (normalizedText: string) => Iterable<string>): Map<string, RoaringBitmap32> {
		const map = new Map<string, RoaringBitmap32>();
		const items = this._store.sourceData.value;

		for (let i = 0; i < items.length; i++) {
			const item = items[i];

			if (item === undefined) {
				continue;
			}
			const text = this._getText(item);

			if (text === undefined) {
				continue;
			}
			for (const token of tokenize(text.toLowerCase())) {
				let posting = map.get(token);

				if (posting === undefined) {
					posting = new RoaringBitmap32();
					map.set(token, posting);
				}
				posting.add(i);
			}
		}
		for (const posting of map.values()) {
			posting.runOptimize();
		}

		return map;
	}
}
