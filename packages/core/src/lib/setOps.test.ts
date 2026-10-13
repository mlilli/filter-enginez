/**
 * Tests for the Set operation helpers — `intersectionSet`, `unionSet`, `differenceSet`.
 *
 * @remarks
 * Covers each operation's happy path, empty-input edge cases, the
 * smaller-set-iteration branch selection in `intersectionSet` (both orderings), input
 * immutability (the inputs are never mutated), and the new-Set identity of every result.
 */

import { describe, expect, it } from 'vitest';

import { differenceSet, intersectionSet, unionSet } from './setOps.js';

describe('intersectionSet', () => {
	it('returns elements present in both sets', () => {
		const result = intersectionSet(new Set([1, 2, 3]), new Set([2, 3, 4]));

		expect([...result].sort((a, b) => a - b)).toEqual([2, 3]);
	});

	it('iterates the smaller set when setA is smaller', () => {
		const result = intersectionSet(new Set([2]), new Set([1, 2, 3, 4]));

		expect([...result]).toEqual([2]);
	});

	it('iterates the smaller set when setB is smaller', () => {
		const result = intersectionSet(new Set([1, 2, 3, 4]), new Set([3]));

		expect([...result]).toEqual([3]);
	});

	it('handles equal-size sets (the <= tie picks setA as smaller)', () => {
		const result = intersectionSet(new Set([1, 2]), new Set([2, 3]));

		expect([...result]).toEqual([2]);
	});

	it('returns an empty set when there is no overlap', () => {
		const result = intersectionSet(new Set([1, 2]), new Set([3, 4]));

		expect(result.size).toBe(0);
	});

	it('returns an empty set when either input is empty', () => {
		expect(intersectionSet(new Set<number>(), new Set([1])).size).toBe(0);
		expect(intersectionSet(new Set([1]), new Set<number>()).size).toBe(0);
	});

	it('does not mutate its inputs', () => {
		const a = new Set([1, 2]);
		const b = new Set([2, 3]);

		intersectionSet(a, b);

		expect([...a]).toEqual([1, 2]);
		expect([...b]).toEqual([2, 3]);
	});
});

describe('unionSet', () => {
	it('returns elements present in either set, de-duplicated', () => {
		const result = unionSet(new Set([1, 2]), new Set([2, 3]));

		expect([...result].sort((a, b) => a - b)).toEqual([1, 2, 3]);
	});

	it('returns a copy of setA when setB is empty', () => {
		const a = new Set([1, 2]);
		const result = unionSet(a, new Set<number>());

		expect([...result]).toEqual([1, 2]);
		// Distinct object identity — not the same Set reference.
		expect(result).not.toBe(a);
	});

	it('returns the elements of setB when setA is empty', () => {
		const result = unionSet(new Set<number>(), new Set([5, 6]));

		expect([...result].sort((a, b) => a - b)).toEqual([5, 6]);
	});

	it('does not mutate its inputs', () => {
		const a = new Set([1]);
		const b = new Set([2]);

		unionSet(a, b);

		expect([...a]).toEqual([1]);
		expect([...b]).toEqual([2]);
	});
});

describe('differenceSet', () => {
	it('returns elements in setA that are not in setB', () => {
		const result = differenceSet(new Set([1, 2, 3]), new Set([2, 3, 4]));

		expect([...result]).toEqual([1]);
	});

	it('is asymmetric — order of arguments matters', () => {
		expect([...differenceSet(new Set([1, 2]), new Set([2, 3]))]).toEqual([1]);
		expect([...differenceSet(new Set([2, 3]), new Set([1, 2]))]).toEqual([3]);
	});

	it('returns an empty set when setA is a subset of setB', () => {
		expect(differenceSet(new Set([1, 2]), new Set([1, 2, 3])).size).toBe(0);
	});

	it('returns a copy of setA when setB is empty', () => {
		const result = differenceSet(new Set([1, 2]), new Set<number>());

		expect([...result]).toEqual([1, 2]);
	});

	it('does not mutate its inputs', () => {
		const a = new Set([1, 2, 3]);
		const b = new Set([2]);

		differenceSet(a, b);

		expect([...a]).toEqual([1, 2, 3]);
		expect([...b]).toEqual([2]);
	});
});
