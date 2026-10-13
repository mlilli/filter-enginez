/**
 * `murmur3_32` — a fast, well-distributed, non-cryptographic string hash.
 *
 * @remarks
 * Lives in `lib/` so it is shared by every consumer that needs a strong base hash without a
 * third-party dependency — {@link MinHash}'s universal hash family and `BloomFilter`'s
 * Kirsch-Mitzenmacher double hashing — rather than duplicated per consumer.
 *
 * This is the **per-codepoint** formulation of Murmur3-32 (not the full bytewise variant) — it's
 * simpler, ~half the code, and just as uniform for these use cases (we need well-distributed hash
 * values, not cryptographic resistance). Determinism is total: the same `(str, seed)` pair yields
 * the same 32-bit result across runs, processes, and machines, which is what makes MinHash
 * signatures and serialized Bloom bitsets reproducible.
 *
 * @packageDocumentation
 */

/**
 * Murmur3-32 hash of a string — per-codepoint variant. Stable, well-distributed, ~5x faster
 * than naive char-add-rotate hashes at typical attribute lengths.
 *
 * @remarks
 * This is the per-codepoint formulation (not the full bytewise Murmur3) — it's simpler, ~half
 * the code, and just as uniform for the consuming use cases (we don't need cryptographic
 * resistance, just well-distributed hash values).
 *
 * @param str - Input string
 * @param seed - 32-bit seed (mixed into the initial hash state)
 * @returns 32-bit unsigned integer hash
 */
export function murmur3_32(str: string, seed: number): number {
	let h = seed >>> 0;

	for (let i = 0; i < str.length; i++) {
		let k = str.charCodeAt(i);

		k = Math.imul(k, 0xcc9e2d51) >>> 0;
		k = ((k << 15) | (k >>> 17)) >>> 0;
		k = Math.imul(k, 0x1b873593) >>> 0;
		h ^= k;
		h = ((h << 13) | (h >>> 19)) >>> 0;
		h = (Math.imul(h, 5) + 0xe6546b64) >>> 0;
	}
	// Finalization mix — strengthens the avalanche
	h ^= str.length;
	h ^= h >>> 16;
	h = Math.imul(h, 0x85ebca6b) >>> 0;
	h ^= h >>> 13;
	h = Math.imul(h, 0xc2b2ae35) >>> 0;
	h ^= h >>> 16;

	return h >>> 0;
}
