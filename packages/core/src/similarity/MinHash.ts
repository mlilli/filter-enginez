/**
 * `MinHash` — compact signature for approximate Jaccard similarity.
 *
 * @remarks
 * Per `docs/architecture.md` §7.1. Computes a fixed-size signature from an item's attribute
 * set such that the Jaccard similarity between two items can be approximated by counting how
 * many positions in their signatures match — `matches / numHashes ≈ Jaccard(setA, setB)`.
 *
 * **The algorithm.** For a set of `k` independent hash functions `h_1..h_k`, the MinHash
 * signature of a set `S` is the vector `[min(h_i(s) for s in S) for i in 1..k]`. The
 * theoretical guarantee is `P(signature_A[i] == signature_B[i]) == Jaccard(A, B)`, so counting
 * matching positions across all `k` slots produces an unbiased estimator.
 *
 * **The hash family.** We use one strong base hash (Murmur3-32, shared from `lib/murmur3.js` —
 * no third-party dependency needed) plus a family of `k` linear-combination variants of the form
 * `h_i(x) = (a_i * murmur3(x) + b_i) mod p`, where `p` is the Mersenne prime `2^31 - 1`
 * and `(a_i, b_i)` are generated once at construction time from a seeded LCG. This is the
 * standard "universal hash family" construction — provably good distribution properties at
 * O(1) per-hash cost.
 *
 * **Determinism.** All signatures are reproducible from the seed alone. Same items + same
 * `(numHashes, seed)` → identical signatures across runs / processes / machines. Critical
 * for snapshot persistence and worker-bridge serialization round-trip.
 *
 * @packageDocumentation
 */

import { FilterEngineConfigError } from '../errors/index.js';
import { murmur3_32 } from '../lib/murmur3.js';

/**
 * Mersenne prime `2^31 - 1`. Used as the modulus in the universal hash family. Fits in a
 * signed 32-bit int with one bit to spare, which keeps the `Math.imul`-based intermediate
 * math from overflowing into BigInt territory.
 */
const MERSENNE_31 = 0x7fffffff;

/**
 * Numerical Recipes LCG — fast, deterministic, good-enough-for-non-crypto pseudorandom.
 * Used once at construction to generate the `(a_i, b_i)` hash-family coefficients from
 * the seed.
 *
 * @param state - Current LCG state (any 32-bit value)
 * @returns Next LCG state
 */
function nextLcg(state: number): number {
	return (Math.imul(state, 1664525) + 1013904223) >>> 0;
}

/**
 * Approximate Jaccard similarity via MinHash signatures.
 */
export class MinHash {
	/** Coefficient `a_i` for each of the `numHashes` hash family members. Odd, in `[1, p)`. */
	private readonly _aValues: Uint32Array;

	/** Coefficient `b_i` for each of the `numHashes` hash family members. In `[0, p)`. */
	private readonly _bValues: Uint32Array;

	constructor(
		readonly numHashes: number = 128,
		readonly seed: number = 42,
	) {
		if (numHashes <= 0 || !Number.isInteger(numHashes)) {
			throw new FilterEngineConfigError(
				'SIMILARITY_INVALID_OPTIONS',
				`MinHash: numHashes must be a positive integer, got ${numHashes}`,
			);
		}

		// Generate the (a_i, b_i) family from the seed. We pull 2 values per hash family member.
		this._aValues = new Uint32Array(numHashes);
		this._bValues = new Uint32Array(numHashes);
		let state = (seed >>> 0) || 1; // LCG state of 0 is degenerate

		for (let i = 0; i < numHashes; i++) {
			state = nextLcg(state);
			// `a` must be in [1, p) AND odd (the odd-ness gives better distribution in linear hash
			// families per Carter-Wegman). Force the low bit and clamp to the modulus range.
			this._aValues[i] = ((state % MERSENNE_31) | 1) >>> 0;
			state = nextLcg(state);
			this._bValues[i] = (state % MERSENNE_31) >>> 0;
		}
	}

	// #region docs:minhash-signature
	/**
	 * Compute the MinHash signature for an item's attribute set.
	 *
	 * @param attributes - The string-set representation of the item — typically built by the
	 *   `SimilaritySearch` config's `signatureFn` or by extracting `attributes` paths
	 * @returns A fixed-length signature (`Uint32Array` of `numHashes` elements)
	 *
	 * @remarks
	 * Empty input set returns an all-`0xffffffff`-sentinel signature. Comparing two such
	 * signatures gives a (misleading) similarity of 1.0 since every slot matches — consumers
	 * should filter out empty-signature items before similarity ranking, or special-case via
	 * `isAllSentinel(sig)`.
	 */
	signature(attributes: ReadonlySet<string>): Uint32Array {
		const k = this.numHashes;
		const sig = new Uint32Array(k);

		// Sentinel = max u32; we track the minimum as we scan elements.
		sig.fill(0xffffffff);

		for (const element of attributes) {
			const baseHash = murmur3_32(element, this.seed);

			for (let i = 0; i < k; i++) {
				// `i` is provably in-bounds (`i < k`, and all three typed arrays have length `k`),
				// so `?? 0` is a no-op fallback that satisfies noUncheckedIndexedAccess without a
				// non-null assertion. `a`/`b` are coefficients; `current` is the running minimum.
				// noUncheckedIndexedAccess fallbacks — `i < k` and all three typed arrays have length
				// `k`, so each `??` right-hand side is unreachable. Per-line ignores (a single
				// multi-line `v8 ignore next 3` does NOT reliably span three separate statements).
				/* v8 ignore next -- defensive: i < k; _aValues has length k */
				const a = this._aValues[i] ?? 0;
				/* v8 ignore next -- defensive: i < k; _bValues has length k */
				const b = this._bValues[i] ?? 0;
				/* v8 ignore next -- defensive: i < k; sig has length k */
				const current = sig[i] ?? 0xffffffff;
				// `(a * baseHash + b) mod p`. `Math.imul` keeps the multiply in 32-bit signed
				// space; the `>>> 0` converts to unsigned before the modulo. The modulo on a
				// 32-bit-bounded numerator with prime `p = 2^31 - 1` gives a value in `[0, p)`.
				const h = (((Math.imul(a, baseHash) >>> 0) + b) >>> 0) % MERSENNE_31;

				if (h < current) {
					sig[i] = h;
				}
			}
		}

		return sig;
	}
	// #endregion docs:minhash-signature

	// #region docs:minhash-jaccard-estimate
	/**
	 * Approximate the Jaccard similarity between two signatures by counting matching positions.
	 *
	 * @param signatureA - First MinHash signature
	 * @param signatureB - Second MinHash signature (must be same length as `signatureA`)
	 * @returns A value in `[0, 1]` approximating `|A ∩ B| / |A ∪ B|`
	 *
	 * @remarks
	 * **Static** because the estimator is signature-shape-agnostic — only the count of matching
	 * slots matters. Doesn't need a `MinHash` instance to compute.
	 *
	 * **Standard-error.** The estimator's standard error is `~1/sqrt(numHashes)` — for the
	 * default `numHashes=128` that's ~9% standard error. Tighten by raising `numHashes` at the
	 * cost of proportionally more signature storage + computation.
	 *
	 * @throws `FilterEngineConfigError` with code `SIMILARITY_SIGNATURE_MISMATCH` if the two
	 *   signatures differ in length (they came from `MinHash` instances with different `numHashes`)
	 */
	static jaccardEstimate(signatureA: Uint32Array, signatureB: Uint32Array): number {
		if (signatureA.length !== signatureB.length) {
			throw new FilterEngineConfigError(
				'SIMILARITY_SIGNATURE_MISMATCH',
				`MinHash.jaccardEstimate: signature lengths must match (got ${signatureA.length} vs ${signatureB.length})`,
			);
		}
		let matches = 0;

		for (let i = 0; i < signatureA.length; i++) {
			if (signatureA[i] === signatureB[i]) {
				matches++;
			}
		}

		return matches / signatureA.length;
	}
	// #endregion docs:minhash-jaccard-estimate

	/**
	 * Convenience: check whether a signature is the all-sentinel "empty input" signature.
	 * Consumers building "find similar" UX can use this to skip empty-attribute items rather
	 * than ranking them as 1.0-similar to other empty-attribute items.
	 */
	static isAllSentinel(signature: Uint32Array): boolean {
		for (const slot of signature) {
			if (slot !== 0xffffffff) {
				return false;
			}
		}

		return true;
	}
}
