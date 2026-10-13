/**
 * `LSH` — Locality-Sensitive Hashing for sub-linear similar-item lookup.
 *
 * @remarks
 * Per `docs/architecture.md` §7.2. Slices each MinHash signature into bands; items with
 * matching bands hash into shared buckets. To find candidate-similar items, look up the query
 * item's buckets. Recall is probabilistic (see the banding curve below): an item above a given
 * similarity is a candidate with a probability set by the banding parameters, not guaranteed.
 *
 * Brings "find similar to item X" from O(N²) brute-force to O(bucket_size) — typically
 * O(10-50) regardless of dataset size.
 *
 * **The banding trick.** A signature of length `k = numHashes` splits into `b = k / r` bands
 * of `r = bandSize` rows each. Two items share a bucket in band `i` iff their signatures
 * agree on all `r` rows of band `i`. The probability that two items with true Jaccard `s`
 * share at least one band is `1 - (1 - s^r)^b` — an S-curve that's tunable via `(b, r)`.
 * The default `k=128, r=8` (→ `b=16`) gives ≈0.06 at `s=0.5`, 0.24 at 0.6, 0.61 at 0.7, 0.95
 * at 0.8 and ≈1.0 at 0.9; the curve's midpoint is near `(1/b)^(1/r) ≈ 0.71`.
 *
 * **Bucket storage.** Two-level `Map<bandIndex, Map<bucketKey, Set<itemIndex>>>`. The
 * bucketKey is an FNV-1a 32-bit hash of the band's `r` signature slots — fast, well-
 * distributed, no string-key intern overhead. Insert is O(b); query is O(b + |candidates|).
 *
 * @packageDocumentation
 */

import { FilterEngineConfigError } from '../errors/index.js';

/**
 * FNV-1a 32-bit offset basis. Standard seed for the FNV hash family.
 */
const FNV_OFFSET = 2166136261;

/**
 * FNV-1a 32-bit prime. Standard multiplier for the FNV hash family.
 */
const FNV_PRIME = 16777619;

// #region docs:band-bucket-key
/**
 * Compute the bucket key for one band of a signature.
 *
 * @remarks
 * FNV-1a over the `bandSize` consecutive u32 values starting at `bandIndex * bandSize`.
 * The XOR-then-multiply mix is what gives FNV its avalanche; over typical signature inputs
 * the bucket distribution is uniform enough that collision rates match the theoretical
 * predictions of the LSH analysis.
 *
 * @param signature - The full MinHash signature
 * @param bandStart - Index of the first signature slot in this band (`bandIndex * bandSize`)
 * @param bandSize - Number of signature slots in each band
 * @returns 32-bit bucket key for this band
 */
function bandBucketKey(signature: Uint32Array, bandStart: number, bandSize: number): number {
	let h = FNV_OFFSET;

	for (let i = 0; i < bandSize; i++) {
		/* v8 ignore next -- defensive: noUncheckedIndexedAccess fallback; bandStart + i < numHashes = signature.length */
		const slot = signature[bandStart + i] ?? 0;

		h ^= slot;
		h = Math.imul(h, FNV_PRIME) >>> 0;
	}

	return h;
}
// #endregion docs:band-bucket-key

/**
 * Locality-Sensitive Hashing index over MinHash signatures.
 */
export class LSH {
	// #region docs:lsh-construct-and-insert
	/** Number of bands the signature is split into — `numHashes / bandSize`. */
	readonly numBands: number;

	/**
	 * Bucket index — `bandIndex -> bucketKey -> Set<itemIndex>`. The outer Map is fixed-size
	 * (`numBands` entries) and pre-populated in the constructor; the inner Maps grow as items
	 * insert.
	 */
	private readonly _bucketsByBand: Map<number, Set<number>>[];

	constructor(
		readonly numHashes: number = 128,
		readonly bandSize: number = 8,
	) {
		if (numHashes <= 0 || !Number.isInteger(numHashes)) {
			throw new FilterEngineConfigError(
				'SIMILARITY_INVALID_OPTIONS',
				`LSH: numHashes must be a positive integer, got ${numHashes}`,
			);
		}
		if (bandSize <= 0 || !Number.isInteger(bandSize)) {
			throw new FilterEngineConfigError(
				'SIMILARITY_INVALID_OPTIONS',
				`LSH: bandSize must be a positive integer, got ${bandSize}`,
			);
		}
		if (numHashes % bandSize !== 0) {
			throw new FilterEngineConfigError(
				'SIMILARITY_INVALID_OPTIONS',
				`LSH: numHashes (${numHashes}) must be divisible by bandSize (${bandSize}) — ` +
				`leftover signature slots would create an undersized final band, distorting the recall curve.`,
			);
		}

		this.numBands = numHashes / bandSize;
		this._bucketsByBand = Array.from(
			{ length: this.numBands },
			() => new Map<number, Set<number>>(),
		);
	}

	/**
	 * Insert an item's signature into its LSH buckets.
	 *
	 * @param itemIndex - The source-data index (or any unique integer id the consumer uses
	 *   to refer back to items in `queryCandidates` results)
	 * @param signature - The item's MinHash signature (must have length `numHashes`)
	 */
	insert(itemIndex: number, signature: Uint32Array): void {
		if (signature.length !== this.numHashes) {
			throw new FilterEngineConfigError(
				'SIMILARITY_SIGNATURE_MISMATCH',
				`LSH.insert: signature length ${signature.length} does not match expected ${this.numHashes}`,
			);
		}
		for (let bandIndex = 0; bandIndex < this.numBands; bandIndex++) {
			const key = bandBucketKey(signature, bandIndex * this.bandSize, this.bandSize);
			const bucketMap = this._bucketsByBand[bandIndex];

			/* v8 ignore next 3 -- defensive: noUncheckedIndexedAccess guard; _bucketsByBand is dense (length numBands) */
			if (bucketMap === undefined) {
				continue;
			}
			let bucket = bucketMap.get(key);

			if (!bucket) {
				bucket = new Set();
				bucketMap.set(key, bucket);
			}
			bucket.add(itemIndex);
		}
	}
	// #endregion docs:lsh-construct-and-insert

	/**
	 * Find candidate similar items by looking up bucket membership for the query signature.
	 *
	 * @param signature - The query item's MinHash signature
	 * @returns A set of item indices that share at least one bucket with the query
	 *
	 * @remarks
	 * Candidates are a superset of "true similar items above the LSH-curve threshold." Callers
	 * should run an exact-Jaccard verification step (cheap — only over the candidate set) to
	 * filter out false positives and rank by actual similarity.
	 */
	queryCandidates(signature: Uint32Array): Set<number> {
		if (signature.length !== this.numHashes) {
			throw new FilterEngineConfigError(
				'SIMILARITY_SIGNATURE_MISMATCH',
				`LSH.queryCandidates: signature length ${signature.length} does not match expected ${this.numHashes}`,
			);
		}
		const candidates = new Set<number>();

		for (let bandIndex = 0; bandIndex < this.numBands; bandIndex++) {
			const key = bandBucketKey(signature, bandIndex * this.bandSize, this.bandSize);
			const bucket = this._bucketsByBand[bandIndex]?.get(key);

			if (bucket) {
				for (const idx of bucket) {
					candidates.add(idx);
				}
			}
		}

		return candidates;
	}

	/** Clear all buckets. */
	clear(): void {
		for (const bucketMap of this._bucketsByBand) {
			bucketMap.clear();
		}
	}

	/**
	 * Diagnostic: total number of items currently indexed (counting each occurrence — an item
	 * inserted once contributes `numBands` to this count). Useful for monitoring + debugging.
	 */
	get totalBucketEntries(): number {
		let total = 0;

		for (const bucketMap of this._bucketsByBand) {
			for (const bucket of bucketMap.values()) {
				total += bucket.size;
			}
		}

		return total;
	}
}
