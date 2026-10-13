/**
 * Tests for the `BloomFilter` probabilistic-membership primitive.
 *
 * @remarks
 * Covers the load-bearing guarantee (no false negatives), the false-positive rate tracking its
 * configured target, `forCapacity` sizing math, the serialize/deserialize round-trip (including a
 * hand-built serialized shape), the diagnostic getters + `itemCount` semantics, and every guard
 * (constructor `sizeBits`/`hashCount`, `forCapacity` bounds, and the deserialize length check).
 * The murmur3 base hashes are deterministic, so the false-positive measurements are reproducible —
 * these tests do not flake.
 */

import { describe, expect, it } from 'vitest';

import { bytesToBase64 } from './base64.js';
import { BloomFilter, type SerializedBloomFilter } from './BloomFilter.js';

describe('BloomFilter.forCapacity', () => {
	it('derives sensible (m, k) from an item count + target false-positive rate', () => {
		const filter = BloomFilter.forCapacity(1000, 0.01);

		// m = ceil( -(1000 · ln 0.01) / (ln 2)² ) = 9586;  k = round( (m / 1000) · ln 2 ) = 7.
		expect(filter.sizeBits).toBe(9586);
		expect(filter.hashCount).toBe(7);
		expect(filter.itemCount).toBe(0);
	});

	it('clamps hashCount to at least 1 for a very loose target', () => {
		const filter = BloomFilter.forCapacity(1000, 0.9);

		expect(filter.hashCount).toBeGreaterThanOrEqual(1);
	});

	it('throws when expectedItemCount is not a positive integer', () => {
		expect(() => BloomFilter.forCapacity(0, 0.01)).toThrow(/positive integer/u);
		expect(() => BloomFilter.forCapacity(1.5, 0.01)).toThrow(/positive integer/u);
	});

	it('throws when targetFalsePositiveRate is outside (0, 1)', () => {
		expect(() => BloomFilter.forCapacity(1000, 0)).toThrow(/\(0, 1\)/u);
		expect(() => BloomFilter.forCapacity(1000, 1)).toThrow(/\(0, 1\)/u);
	});
});

describe('BloomFilter constructor', () => {
	it('throws when sizeBits is not a positive integer', () => {
		expect(() => new BloomFilter({ hashCount: 3, sizeBits: 0 })).toThrow(/sizeBits/u);
		expect(() => new BloomFilter({ hashCount: 3, sizeBits: 12.5 })).toThrow(/sizeBits/u);
	});

	it('throws when hashCount is below 1 or non-integer', () => {
		expect(() => new BloomFilter({ hashCount: 0, sizeBits: 64 })).toThrow(/hashCount/u);
		expect(() => new BloomFilter({ hashCount: 2.5, sizeBits: 64 })).toThrow(/hashCount/u);
	});

	it('exposes its configured parameters via the getters', () => {
		const filter = new BloomFilter({ hashCount: 4, sizeBits: 128 });

		expect(filter.hashCount).toBe(4);
		expect(filter.sizeBits).toBe(128);
		expect(filter.itemCount).toBe(0);
	});
});

describe('BloomFilter.add / test', () => {
	it('never reports a false negative — every added value tests true', () => {
		const filter = BloomFilter.forCapacity(1000, 0.01);

		for (let i = 0; i < 1000; i++) {
			filter.add(`item-${i}`);
		}

		for (let i = 0; i < 1000; i++) {
			expect(filter.test(`item-${i}`)).toBe(true);
		}
	});

	it('reports false for values not added to an empty filter', () => {
		const filter = new BloomFilter({ hashCount: 4, sizeBits: 512 });

		expect(filter.test('never-added')).toBe(false);
	});

	it('keeps the measured false-positive rate near its configured target', () => {
		const targetRate = 0.01;
		const filter = BloomFilter.forCapacity(1000, targetRate);

		for (let i = 0; i < 1000; i++) {
			filter.add(`present-${i}`);
		}

		let falsePositives = 0;
		const trials = 20000;

		for (let i = 0; i < trials; i++) {
			if (filter.test(`absent-${i}`)) {
				falsePositives++;
			}
		}

		// Deterministic hashing → a fixed count; assert it stays within a generous band of target.
		expect(falsePositives / trials).toBeLessThanOrEqual(targetRate * 2.5);
	});

	it('increments itemCount on every add, including idempotent re-adds', () => {
		const filter = new BloomFilter({ hashCount: 3, sizeBits: 128 });

		filter.add('duplicate');
		const bitsAfterFirstAdd = filter.serialize().bits;

		filter.add('duplicate');

		// Membership bits are unchanged by the re-add, but itemCount still counts the call.
		expect(filter.serialize().bits).toBe(bitsAfterFirstAdd);
		expect(filter.itemCount).toBe(2);
	});

	it('works with a single hash function (k = 1)', () => {
		const filter = new BloomFilter({ hashCount: 1, sizeBits: 64 });

		filter.add('solo');

		expect(filter.test('solo')).toBe(true);
	});
});

describe('BloomFilter serialize / deserialize', () => {
	it('round-trips exactly — a deserialized filter tests identically', () => {
		const original = BloomFilter.forCapacity(500, 0.02);

		for (let i = 0; i < 500; i++) {
			original.add(`value-${i}`);
		}

		const restored = BloomFilter.deserialize(original.serialize());

		expect(restored.sizeBits).toBe(original.sizeBits);
		expect(restored.hashCount).toBe(original.hashCount);
		expect(restored.itemCount).toBe(original.itemCount);

		for (let i = 0; i < 500; i++) {
			expect(restored.test(`value-${i}`)).toBe(original.test(`value-${i}`));
		}
	});

	it('serializes to a JSON-safe, alphabetically-keyed shape', () => {
		const filter = new BloomFilter({ hashCount: 3, sizeBits: 64 });

		filter.add('x');
		const serialized = filter.serialize();

		expect(Object.keys(serialized)).toEqual(['bits', 'hashCount', 'itemCount', 'sizeBits']);
		expect(typeof serialized.bits).toBe('string');
		expect(JSON.parse(JSON.stringify(serialized))).toEqual(serialized);
	});

	it('reconstructs from a hand-built serialized shape', () => {
		const source = new BloomFilter({ hashCount: 2, sizeBits: 128 });

		source.add('alpha');
		source.add('beta');
		const handBuilt: SerializedBloomFilter = {
			bits: source.serialize().bits,
			hashCount: 2,
			itemCount: 2,
			sizeBits: 128,
		};

		const restored = BloomFilter.deserialize(handBuilt);

		expect(restored.test('alpha')).toBe(true);
		expect(restored.test('beta')).toBe(true);
	});

	it('throws when the decoded bit array length does not match sizeBits', () => {
		// sizeBits 64 needs 8 bytes; supply a 4-byte bitset so the length check fails.
		const malformed: SerializedBloomFilter = {
			bits: bytesToBase64(new Uint8Array(4)),
			hashCount: 3,
			itemCount: 0,
			sizeBits: 64,
		};

		expect(() => BloomFilter.deserialize(malformed)).toThrow(/does not|needs|bit array/u);
	});
});
