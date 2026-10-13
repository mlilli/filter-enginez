/**
 * Tests for the lodash-free internal helpers — `isNil`, `xor`, `deepEqual`, `groupBy`, `flatten`.
 *
 * @remarks
 * Each helper is exercised across its happy path plus the branches its implementation
 * distinguishes: `deepEqual` in particular walks primitives, `null`, type mismatch, `Date`,
 * arrays (length + element divergence), and plain objects (key-count + key-value divergence).
 */

import { describe, expect, it } from 'vitest';

import { deepEqual, flatten, groupBy, isNil, xor } from './internal.js';

describe('isNil', () => {
	it('is true for null and undefined', () => {
		expect(isNil(null)).toBe(true);
		expect(isNil(undefined)).toBe(true);
	});

	it('is false for falsy-but-present values', () => {
		expect(isNil(0)).toBe(false);
		expect(isNil('')).toBe(false);
		expect(isNil(false)).toBe(false);
		expect(isNil(Number.NaN)).toBe(false);
	});
});

describe('xor', () => {
	it('returns elements present in exactly one array', () => {
		expect(xor([1, 2, 3], [2, 3, 4])).toEqual([1, 4]);
	});

	it('preserves first-array order, then second-array order', () => {
		expect(xor([3, 1], [1, 2])).toEqual([3, 2]);
	});

	it('returns an empty array for identical inputs', () => {
		expect(xor([1, 2], [1, 2])).toEqual([]);
	});

	it('returns the other array when one is empty', () => {
		expect(xor([], [1, 2])).toEqual([1, 2]);
		expect(xor([1, 2], [])).toEqual([1, 2]);
	});
});

describe('deepEqual', () => {
	it('is true for reference-equal and primitive-equal values', () => {
		const shared = { a: 1 };

		expect(deepEqual(shared, shared)).toBe(true);
		expect(deepEqual(1, 1)).toBe(true);
		expect(deepEqual('x', 'x')).toBe(true);
	});

	it('is false when exactly one value is null', () => {
		expect(deepEqual(null, { a: 1 })).toBe(false);
		expect(deepEqual({ a: 1 }, null)).toBe(false);
	});

	it('is false on type mismatch', () => {
		expect(deepEqual(1, '1')).toBe(false);
		expect(deepEqual(1, true)).toBe(false);
	});

	it('compares Dates by timestamp', () => {
		expect(deepEqual(new Date('2026-01-01'), new Date('2026-01-01'))).toBe(true);
		expect(deepEqual(new Date('2026-01-01'), new Date('2026-01-02'))).toBe(false);
	});

	it('compares arrays element-wise', () => {
		expect(deepEqual([1, [2, 3]], [1, [2, 3]])).toBe(true);
		expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
		expect(deepEqual([1, 2], [1, 9])).toBe(false);
	});

	it('compares plain objects by keys and values', () => {
		expect(deepEqual({ a: 1, b: { c: 2 }}, { a: 1, b: { c: 2 }})).toBe(true);
		expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
		expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
	});

	it('treats an array and a same-shaped index object as equal (documented limitation)', () => {
		// Not a full deep-equal: an array and an object with matching enumerable
		// index keys/values fall through to the plain-object branch and compare equal.
		expect(deepEqual([1, 2], { 0: 1, 1: 2 })).toBe(true);
	});

	it('is false for differing primitives of the same type (reaches the final fallthrough)', () => {
		expect(deepEqual(1, 2)).toBe(false);
		expect(deepEqual(true, false)).toBe(false);
	});
});

describe('groupBy', () => {
	it('groups items by the key function, preserving insertion order', () => {
		const grouped = groupBy(
			[
				{ kind: 'a', n: 1 },
				{ kind: 'b', n: 2 },
				{ kind: 'a', n: 3 },
			],
			(item) => item.kind,
		);

		expect([...grouped.keys()]).toEqual(['a', 'b']);
		expect(grouped.get('a')).toEqual([
			{ kind: 'a', n: 1 },
			{ kind: 'a', n: 3 },
		]);
		expect(grouped.get('b')).toEqual([{ kind: 'b', n: 2 }]);
	});

	it('returns an empty map for an empty array', () => {
		expect(groupBy([], (x: number) => x).size).toBe(0);
	});
});

describe('flatten', () => {
	it('flattens one level deep', () => {
		expect(flatten([[1, 2], [3], [4, 5]])).toEqual([1, 2, 3, 4, 5]);
	});

	it('drops empty inner arrays', () => {
		expect(flatten([[1], [], [2]])).toEqual([1, 2]);
	});

	it('returns an empty array for no inner arrays', () => {
		expect(flatten<number>([])).toEqual([]);
	});
});
