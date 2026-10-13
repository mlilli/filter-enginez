/**
 * @remarks
 * Pass-3 behavioral coverage for {@link MinHash} — the universal-hash-family MinHash signature
 * generator that backs approximate Jaccard similarity. Exploits the engine's deterministic-
 * from-seed guarantee for exact assertions where the algorithm is deterministic, and asserts
 * bounds / ordering invariants where the estimator is probabilistic.
 *
 * Tested behaviors:
 * - Construction validates `numHashes` and rejects non-positive / non-integer values.
 * - Default `numHashes` / `seed` are applied when omitted.
 * - The degenerate seed `0` is coerced to a usable LCG state (no all-identical signature).
 * - `signature` produces a `Uint32Array` of length `numHashes`.
 * - Empty input yields the all-sentinel signature (`isAllSentinel` true).
 * - Signatures are deterministic across instances with the same `(numHashes, seed)`.
 * - Signatures are insertion-order independent (set semantics).
 * - Identical sets estimate to exactly `1`; self-similarity is `1`.
 * - Disjoint sets estimate near `0`; bounds hold (`0 <= est <= 1`).
 * - More-overlapping pairs rank above less-overlapping pairs.
 * - `jaccardEstimate` throws on length mismatch and counts matching slots both arms.
 * - `isAllSentinel` returns false as soon as any slot differs from the sentinel.
 *
 * @packageDocumentation
 */

import { describe, expect, it } from 'vitest';

import { MinHash } from './MinHash.js';

describe('MinHash construction', () => {
	it('rejects a non-positive numHashes', () => {
		expect(() => new MinHash(0)).toThrow(/positive integer/);
		expect(() => new MinHash(-4)).toThrow(/positive integer/);
	});

	it('rejects a non-integer numHashes', () => {
		expect(() => new MinHash(12.5)).toThrow(/positive integer/);
	});

	it('applies the default numHashes and seed when omitted', () => {
		const mh = new MinHash();

		expect(mh.numHashes).toBe(128);
		expect(mh.seed).toBe(42);
	});

	it('respects an explicit numHashes and seed', () => {
		const mh = new MinHash(64, 7);

		expect(mh.numHashes).toBe(64);
		expect(mh.seed).toBe(7);
		expect(mh.signature(new Set(['x'])).length).toBe(64);
	});

	it('coerces the degenerate seed 0 to a usable LCG state', () => {
		// A seed of 0 would freeze the LCG; the implementation forces it to 1. The resulting
		// signature must still be a real (non-sentinel) signature for a non-empty input.
		const mh = new MinHash(16, 0);
		const sig = mh.signature(new Set(['alpha', 'beta']));

		expect(MinHash.isAllSentinel(sig)).toBe(false);
	});
});

describe('MinHash.signature', () => {
	it('produces a signature of length numHashes', () => {
		const mh = new MinHash(32);
		const sig = mh.signature(new Set(['red', 'green', 'blue']));

		expect(sig).toBeInstanceOf(Uint32Array);
		expect(sig.length).toBe(32);
	});

	it('returns the all-sentinel signature for an empty input set', () => {
		const mh = new MinHash(16);
		const sig = mh.signature(new Set<string>());

		expect(MinHash.isAllSentinel(sig)).toBe(true);
		for (const slot of sig) {
			expect(slot).toBe(0xffffffff);
		}
	});

	it('is deterministic across instances with the same (numHashes, seed)', () => {
		const a = new MinHash(48, 99);
		const b = new MinHash(48, 99);
		const features = new Set(['cabernet', 'napa', '2018']);

		expect(Array.from(a.signature(features))).toEqual(Array.from(b.signature(features)));
	});

	it('is independent of element insertion order', () => {
		const mh = new MinHash(48, 99);
		const forward = mh.signature(new Set(['a', 'b', 'c']));
		const reversed = mh.signature(new Set(['c', 'b', 'a']));

		expect(Array.from(forward)).toEqual(Array.from(reversed));
	});

	it('produces different signatures for different seeds', () => {
		const features = new Set(['merlot', 'sonoma']);
		const seedA = new MinHash(64, 1).signature(features);
		const seedB = new MinHash(64, 2).signature(features);

		// Overwhelmingly likely to differ in at least one slot under independent seeds.
		expect(Array.from(seedA)).not.toEqual(Array.from(seedB));
	});
});

describe('MinHash.jaccardEstimate', () => {
	it('estimates exactly 1 for two signatures of identical sets', () => {
		const mh = new MinHash(128);
		const features = new Set(['x', 'y', 'z']);
		const sigA = mh.signature(features);
		const sigB = mh.signature(new Set(features));

		expect(MinHash.jaccardEstimate(sigA, sigB)).toBe(1);
	});

	it('estimates exactly 1 for self-similarity', () => {
		const mh = new MinHash(128);
		const sig = mh.signature(new Set(['solo']));

		expect(MinHash.jaccardEstimate(sig, sig)).toBe(1);
	});

	it('keeps every estimate within [0, 1]', () => {
		const mh = new MinHash(128);
		const sigA = mh.signature(new Set(['a', 'b', 'c', 'd']));
		const sigB = mh.signature(new Set(['c', 'd', 'e', 'f']));
		const est = MinHash.jaccardEstimate(sigA, sigB);

		expect(est).toBeGreaterThanOrEqual(0);
		expect(est).toBeLessThanOrEqual(1);
	});

	it('estimates near 0 for fully disjoint sets', () => {
		const mh = new MinHash(128);
		const sigA = mh.signature(new Set(['apple', 'banana', 'cherry', 'date']));
		const sigB = mh.signature(new Set(['xylophone', 'yacht', 'zebra', 'walrus']));
		const est = MinHash.jaccardEstimate(sigA, sigB);

		// With 128 hashes the disjoint estimate should be very small (~1/sqrt(128) std error).
		expect(est).toBeLessThan(0.1);
	});

	it('ranks a more-overlapping pair above a less-overlapping pair', () => {
		const mh = new MinHash(128);
		const base = new Set(['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8']);
		const highOverlap = mh.signature(new Set(['t1', 't2', 't3', 't4', 't5', 't6', 't7']));
		const lowOverlap = mh.signature(new Set(['t1', 't2', 'q1', 'q2', 'q3', 'q4', 'q5']));
		const baseSig = mh.signature(base);

		const high = MinHash.jaccardEstimate(baseSig, highOverlap);
		const low = MinHash.jaccardEstimate(baseSig, lowOverlap);

		expect(high).toBeGreaterThan(low);
	});

	it('throws when the two signatures differ in length', () => {
		const short = new MinHash(8).signature(new Set(['a']));
		const long = new MinHash(16).signature(new Set(['a']));

		expect(() => MinHash.jaccardEstimate(short, long)).toThrow(/lengths must match/);
	});

	it('counts a partial match fraction correctly on hand-built signatures', () => {
		// Hand-built signatures sidestep the hash math: 2 of 4 slots match → estimate 0.5.
		const a = Uint32Array.from([1, 2, 3, 4]);
		const b = Uint32Array.from([1, 2, 99, 100]);

		expect(MinHash.jaccardEstimate(a, b)).toBe(0.5);
	});

	it('estimates 0 when no slots match', () => {
		const a = Uint32Array.from([1, 2, 3]);
		const b = Uint32Array.from([4, 5, 6]);

		expect(MinHash.jaccardEstimate(a, b)).toBe(0);
	});
});

describe('MinHash.isAllSentinel', () => {
	it('is true for an all-0xffffffff signature', () => {
		const sig = new Uint32Array(8).fill(0xffffffff);

		expect(MinHash.isAllSentinel(sig)).toBe(true);
	});

	it('is false as soon as one slot differs from the sentinel', () => {
		const sig = new Uint32Array(8).fill(0xffffffff);

		sig[3] = 7;
		expect(MinHash.isAllSentinel(sig)).toBe(false);
	});

	it('is false for a real computed signature of a non-empty set', () => {
		const sig = new MinHash(16).signature(new Set(['something']));

		expect(MinHash.isAllSentinel(sig)).toBe(false);
	});
});
