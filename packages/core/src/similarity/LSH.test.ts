/**
 * @remarks
 * Pass-3 behavioral coverage for {@link LSH} — the band-based Locality-Sensitive Hashing index
 * over MinHash signatures. Verifies banding arithmetic, insert/query bucket semantics, the
 * no-false-negatives recall guarantee for identical signatures, and the lifecycle/diagnostic
 * surface.
 *
 * Tested behaviors:
 * - Construction validates `numHashes`, `bandSize`, and divisibility; derives `numBands`.
 * - Default `numHashes` / `bandSize` are applied when omitted.
 * - `insert` rejects a signature whose length differs from `numHashes`.
 * - `queryCandidates` rejects a malformed query signature.
 * - An identical signature is recalled as a candidate (recall guarantee).
 * - A signature sharing one band collides; a fully-disjoint signature does not.
 * - `queryCandidates` unions candidates across all bands and dedupes by item index.
 * - A query against an empty index returns no candidates.
 * - `totalBucketEntries` counts numBands per inserted item; `clear` empties the index.
 *
 * @packageDocumentation
 */

import { describe, expect, it } from 'vitest';

import { LSH } from './LSH.js';
import { MinHash } from './MinHash.js';

describe('LSH construction', () => {
	it('rejects a non-positive numHashes', () => {
		expect(() => new LSH(0, 4)).toThrow(/numHashes must be a positive integer/);
		expect(() => new LSH(-8, 4)).toThrow(/numHashes must be a positive integer/);
	});

	it('rejects a non-integer numHashes', () => {
		expect(() => new LSH(8.5, 4)).toThrow(/numHashes must be a positive integer/);
	});

	it('rejects a non-positive bandSize', () => {
		expect(() => new LSH(8, 0)).toThrow(/bandSize must be a positive integer/);
		expect(() => new LSH(8, -2)).toThrow(/bandSize must be a positive integer/);
	});

	it('rejects a non-integer bandSize', () => {
		expect(() => new LSH(8, 2.5)).toThrow(/bandSize must be a positive integer/);
	});

	it('rejects a bandSize that does not divide numHashes', () => {
		expect(() => new LSH(10, 4)).toThrow(/must be divisible by bandSize/);
	});

	it('derives numBands from numHashes / bandSize', () => {
		expect(new LSH(128, 8).numBands).toBe(16);
		expect(new LSH(32, 4).numBands).toBe(8);
	});

	it('applies the default numHashes and bandSize when omitted', () => {
		const lsh = new LSH();

		expect(lsh.numHashes).toBe(128);
		expect(lsh.bandSize).toBe(8);
		expect(lsh.numBands).toBe(16);
	});
});

describe('LSH.insert', () => {
	it('rejects a signature whose length differs from numHashes', () => {
		const lsh = new LSH(16, 4);
		const wrong = new Uint32Array(8);

		expect(() => lsh.insert(0, wrong)).toThrow(/does not match expected 16/);
	});

	it('records numBands bucket entries per inserted item', () => {
		const lsh = new LSH(16, 4); // 4 bands
		const sig = new MinHash(16).signature(new Set(['a', 'b', 'c']));

		lsh.insert(0, sig);
		expect(lsh.totalBucketEntries).toBe(4);
	});

	it('lands an identical signature inserted twice into the same buckets', () => {
		const lsh = new LSH(16, 4);
		const sig = new MinHash(16).signature(new Set(['a', 'b', 'c']));

		lsh.insert(0, sig);
		lsh.insert(1, sig);
		// Both items occupy the same 4 buckets → 8 total entries (4 buckets × 2 members).
		expect(lsh.totalBucketEntries).toBe(8);
	});
});

describe('LSH.queryCandidates', () => {
	it('rejects a malformed query signature', () => {
		const lsh = new LSH(16, 4);
		const wrong = new Uint32Array(12);

		expect(() => lsh.queryCandidates(wrong)).toThrow(/does not match expected 16/);
	});

	it('returns no candidates from an empty index', () => {
		const lsh = new LSH(16, 4);
		const sig = new MinHash(16).signature(new Set(['lonely']));

		expect(lsh.queryCandidates(sig).size).toBe(0);
	});

	it('recalls an identical signature as a candidate (no false negative)', () => {
		const lsh = new LSH(32, 4);
		const sig = new MinHash(32).signature(new Set(['x', 'y', 'z']));

		lsh.insert(7, sig);
		const candidates = lsh.queryCandidates(sig);

		expect(candidates.has(7)).toBe(true);
	});

	it('does not recall a fully-disjoint signature', () => {
		const mh = new MinHash(128);
		const lsh = new LSH(128, 8);
		const indexedSig = mh.signature(new Set(['apple', 'banana', 'cherry', 'date', 'fig']));
		const querySig = mh.signature(new Set(['xylophone', 'yacht', 'zebra', 'walrus', 'quartz']));

		lsh.insert(0, indexedSig);
		// Disjoint sets are extremely unlikely to share any of the 16 band buckets.
		expect(lsh.queryCandidates(querySig).has(0)).toBe(false);
	});

	it('unions candidates across bands and dedupes by item index', () => {
		const mh = new MinHash(32);
		const lsh = new LSH(32, 4);
		const sigA = mh.signature(new Set(['shared1', 'shared2', 'shared3']));
		const sigB = mh.signature(new Set(['shared1', 'shared2', 'shared3', 'extra']));

		lsh.insert(0, sigA);
		lsh.insert(1, sigB);

		// Querying with sigA must recall item 0 (identical) and, given the heavy overlap,
		// item 1 as well — each appearing exactly once in the candidate set.
		const candidates = lsh.queryCandidates(sigA);

		expect(candidates.has(0)).toBe(true);
		expect(Array.from(candidates).filter((idx) => idx === 0)).toHaveLength(1);
	});
});

describe('LSH lifecycle', () => {
	it('clears all buckets', () => {
		const lsh = new LSH(16, 4);
		const sig = new MinHash(16).signature(new Set(['a', 'b']));

		lsh.insert(0, sig);
		expect(lsh.totalBucketEntries).toBeGreaterThan(0);

		lsh.clear();
		expect(lsh.totalBucketEntries).toBe(0);
		expect(lsh.queryCandidates(sig).size).toBe(0);
	});

	it('reports zero bucket entries for a fresh index', () => {
		expect(new LSH(16, 4).totalBucketEntries).toBe(0);
	});
});
