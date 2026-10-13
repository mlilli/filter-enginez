/**
 * `BloomFilter` — space-efficient probabilistic set membership.
 *
 * @remarks
 * See [`docs/architecture.md`](../../../../docs/architecture.md) §8a for the design. Its consumer is
 * the serializable `BloomMembershipRule` (the text index uses exact postings, not a Bloom pre-screen).
 *
 * A Bloom filter is a bit array of `m` bits plus `k` hash functions. `add(value)` sets the `k`
 * bits the hashes map `value` to; `test(value)` returns `true` only if all `k` of those bits are
 * set. This yields **no false negatives** (a value that was added always tests `true`) and a
 * **tunable false-positive rate** (an un-added value may collide on all `k` bits). The trade is
 * space + certainty for a compact, fixed-size structure — ideal for shipping a multi-million-element
 * allow/deny list as a serialized bitset rather than the raw set.
 *
 * **Sizing (`forCapacity`).** Given an expected item count `n` and a target false-positive rate
 * `p`, the optimal parameters are:
 *
 *   - `m = ceil( -(n · ln p) / (ln 2)² )`   — bit-array length
 *   - `k = round( (m / n) · ln 2 )`          — number of hash functions (min 1)
 *
 * **Hashing.** `k` indices are derived from two base hashes via Kirsch-Mitzenmacher double
 * hashing — `h_i = (h1 + i · h2) mod m` — so only two base hashes are computed per value, not `k`.
 * The base hashes come from {@link murmur3_32} (shared from `lib/murmur3.js`) under two distinct
 * seeds — the DRY contract mandates the single shared implementation.
 *
 * **Isomorphic.** Pure JS, no browser globals — clean against the `no-browser-api-in-core`
 * boundary. The bit array is a `Uint8Array`; serialization base64-encodes it via the runtime-neutral
 * {@link bytesToBase64} codec (no `btoa`/`Buffer`).
 *
 * @packageDocumentation
 */

import { FilterEngineConfigError } from '../errors/index.js';
import { base64ToBytes, bytesToBase64 } from './base64.js';
import { murmur3_32 } from './murmur3.js';

/**
 * First base-hash seed for the Kirsch-Mitzenmacher scheme (`h1`). An arbitrary fixed 32-bit
 * constant — only its distinctness from {@link SEED_B} matters for hash independence.
 */
const SEED_A = 0x9747b28c;

/**
 * Second base-hash seed for the Kirsch-Mitzenmacher scheme (`h2`). Distinct from {@link SEED_A}
 * so the two base hashes decorrelate.
 */
const SEED_B = 0x5bd1e995;

/**
 * Explicit `(m, k)` construction parameters. Most consumers use {@link BloomFilter.forCapacity}
 * instead, which derives these from a target false-positive rate + expected item count.
 */
export interface BloomFilterOptions {
	/** Number of hash functions, `k` (≥ 1). */
	readonly hashCount: number;
	/** Bit-array length in bits, `m` (> 0). */
	readonly sizeBits: number;
}

/**
 * Serialized form — the shape that round-trips through JSON config, URL-state, and worker-bridge
 * postMessage. The bitset is base64 so it stays compact + JSON-safe.
 */
export interface SerializedBloomFilter {
	/** Base64-encoded bit array (`Uint8Array` of `ceil(sizeBits / 8)` bytes). */
	readonly bits: string;
	/** Number of hash functions, `k`. */
	readonly hashCount: number;
	/** Count of items added — diagnostic; not load-bearing for membership. */
	readonly itemCount: number;
	/** Bit-array length in bits, `m`. */
	readonly sizeBits: number;
}

/**
 * A probabilistic set-membership filter. Construct with explicit `(m, k)` via the constructor, or
 * (preferred) size from a target false-positive rate via {@link BloomFilter.forCapacity}.
 */
export class BloomFilter {
	/** Packed bit array — `ceil(sizeBits / 8)` bytes; bit `n` lives at byte `n >> 3`, offset `n & 7`. */
	private readonly _bits: Uint8Array;

	/** Number of hash functions, `k`. */
	private readonly _hashCount: number;

	/** Count of `add` calls — surfaced via {@link BloomFilter.itemCount}. */
	private _itemCount = 0;

	/** Bit-array length in bits, `m`. */
	private readonly _sizeBits: number;

	constructor(options: BloomFilterOptions) {
		if (!Number.isInteger(options.sizeBits) || options.sizeBits <= 0) {
			throw new FilterEngineConfigError(
				'BLOOM_FILTER_INVALID_OPTIONS',
				`BloomFilter: sizeBits must be a positive integer, got ${options.sizeBits}`,
			);
		}

		if (!Number.isInteger(options.hashCount) || options.hashCount < 1) {
			throw new FilterEngineConfigError(
				'BLOOM_FILTER_INVALID_OPTIONS',
				`BloomFilter: hashCount must be an integer >= 1, got ${options.hashCount}`,
			);
		}

		this._sizeBits = options.sizeBits;
		this._hashCount = options.hashCount;
		this._bits = new Uint8Array(Math.ceil(options.sizeBits / 8));
	}

	/**
	 * Size a filter from an expected item count + target false-positive rate, using the optimal
	 * `m`/`k` formulas (see class docs). The returned filter is empty and ready for `add`.
	 *
	 * @param expectedItemCount - Anticipated number of distinct items (`n`, a positive integer)
	 * @param targetFalsePositiveRate - Desired false-positive probability in `(0, 1)` (`p`)
	 * @returns An empty `BloomFilter` sized for the requested capacity + accuracy
	 * @throws `FilterEngineConfigError` with code `BLOOM_FILTER_INVALID_OPTIONS` if
	 *   `expectedItemCount` is not a positive integer, or `p` is not in `(0, 1)`
	 */
	static forCapacity(expectedItemCount: number, targetFalsePositiveRate: number): BloomFilter {
		if (!Number.isInteger(expectedItemCount) || expectedItemCount <= 0) {
			throw new FilterEngineConfigError(
				'BLOOM_FILTER_INVALID_OPTIONS',
				`BloomFilter.forCapacity: expectedItemCount must be a positive integer, got ${expectedItemCount}`,
			);
		}

		if (!(targetFalsePositiveRate > 0 && targetFalsePositiveRate < 1)) {
			throw new FilterEngineConfigError(
				'BLOOM_FILTER_INVALID_OPTIONS',
				`BloomFilter.forCapacity: targetFalsePositiveRate must be in (0, 1), got ${targetFalsePositiveRate}`,
			);
		}

		// m = ceil( -(n · ln p) / (ln 2)² ); at least 1 bit. k = round( (m / n) · ln 2 ); at least 1.
		const sizeBits = Math.max(1, Math.ceil(-(expectedItemCount * Math.log(targetFalsePositiveRate)) / Math.LN2 ** 2));
		const hashCount = Math.max(1, Math.round((sizeBits / expectedItemCount) * Math.LN2));

		return new BloomFilter({ hashCount, sizeBits });
	}

	/**
	 * Reconstruct a filter from its serialized form. Round-trips exactly:
	 * `deserialize(x.serialize())` tests identically to `x`.
	 *
	 * @param serialized - A {@link SerializedBloomFilter} produced by {@link BloomFilter.serialize}
	 *   (or a hand-built equivalent)
	 * @returns The reconstructed filter
	 * @throws `FilterEngineConfigError` with code `BLOOM_FILTER_INVALID_OPTIONS` if `sizeBits` or
	 *   `hashCount` is out of range, or `BLOOM_FILTER_INVALID_PAYLOAD` if `bits` is not valid base64
	 *   (the decoder's error is the `cause`) or decodes to a length that does not match `sizeBits`
	 */
	static deserialize(serialized: SerializedBloomFilter): BloomFilter {
		const filter = new BloomFilter({ hashCount: serialized.hashCount, sizeBits: serialized.sizeBits });
		let decodedBits: Uint8Array;

		try {
			decodedBits = base64ToBytes(serialized.bits);
		} catch (cause) {
			throw new FilterEngineConfigError(
				'BLOOM_FILTER_INVALID_PAYLOAD',
				'BloomFilter.deserialize: `bits` is not valid base64 — see `cause`.',
				{ cause },
			);
		}
		const expectedByteLength = Math.ceil(serialized.sizeBits / 8);

		if (decodedBits.length !== expectedByteLength) {
			throw new FilterEngineConfigError(
				'BLOOM_FILTER_INVALID_PAYLOAD',
				`BloomFilter.deserialize: decoded bit array is ${decodedBits.length} bytes but sizeBits ${serialized.sizeBits} needs ${expectedByteLength}`,
			);
		}

		filter._bits.set(decodedBits);
		filter._itemCount = serialized.itemCount;

		return filter;
	}

	/** Number of hash functions, `k`. */
	get hashCount(): number {
		return this._hashCount;
	}

	/** Count of items added (diagnostic — the filter can't enumerate its members). */
	get itemCount(): number {
		return this._itemCount;
	}

	/** Bit-array length in bits, `m`. */
	get sizeBits(): number {
		return this._sizeBits;
	}

	/**
	 * Add a value to the set — sets the `k` bits its hashes map to. Idempotent on membership
	 * (adding a value twice leaves the same bits set); `itemCount` still increments each call.
	 */
	add(value: string): void {
		for (const bitIndex of this._iterateBitIndices(value)) {
			const byteIndex = bitIndex >> 3;

			// `?? 0` is a no-op fallback satisfying noUncheckedIndexedAccess — `byteIndex` is
			// provably in-bounds (`bitIndex < sizeBits`, and `_bits` has `ceil(sizeBits / 8)` bytes).
			/* v8 ignore next -- defensive: noUncheckedIndexedAccess fallback; byteIndex provably in-bounds */
			this._bits[byteIndex] = (this._bits[byteIndex] ?? 0) | (1 << (bitIndex & 7));
		}

		this._itemCount++;
	}

	/**
	 * Test membership. Returns `false` with certainty (no false negatives) or `true` with the
	 * configured false-positive probability. A `true` result means "possibly present"; pair with
	 * an exact check where a false positive would be incorrect.
	 */
	test(value: string): boolean {
		for (const bitIndex of this._iterateBitIndices(value)) {
			const byteIndex = bitIndex >> 3;

			/* v8 ignore next -- defensive: noUncheckedIndexedAccess fallback; byteIndex provably in-bounds */
			const byte = this._bits[byteIndex] ?? 0;

			if ((byte & (1 << (bitIndex & 7))) === 0) {
				return false;
			}
		}

		return true;
	}

	/** Serialize to the JSON-safe {@link SerializedBloomFilter} shape (base64 bitset). */
	serialize(): SerializedBloomFilter {
		return {
			bits: bytesToBase64(this._bits),
			hashCount: this._hashCount,
			itemCount: this._itemCount,
			sizeBits: this._sizeBits,
		};
	}

	/**
	 * Yield the `k` bit indices a value maps to, via Kirsch-Mitzenmacher double hashing off two
	 * murmur3 base hashes. Shared by {@link BloomFilter.add} and {@link BloomFilter.test} so the
	 * index derivation lives in exactly one place (DRY).
	 *
	 * @param value - The value to hash
	 * @returns A generator of `hashCount` bit indices, each in `[0, sizeBits)`
	 */
	private *_iterateBitIndices(value: string): Generator<number, void, void> {
		const h1 = murmur3_32(value, SEED_A);
		const h2 = murmur3_32(value, SEED_B);

		for (let i = 0; i < this._hashCount; i++) {
			// (h1 + i · h2) mod m. Both base hashes are non-negative u32 and `i · h2` stays well
			// within Number.MAX_SAFE_INTEGER for any realistic k, so the sum is exact and the
			// modulo lands in [0, m) without needing a negative-guard.
			yield (h1 + i * h2) % this._sizeBits;
		}
	}
}
