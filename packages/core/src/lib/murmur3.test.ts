/**
 * Tests for `murmur3_32` — the shared per-codepoint Murmur3-32 string hash.
 *
 * @remarks
 * Covers pinned known-vectors (regression guard against any accidental change to the mixing
 * constants), total determinism (same input → same output on repeated calls), seed sensitivity
 * (the seed actually perturbs the result), the empty-string boundary, and the unsigned-32-bit
 * range invariant of every output.
 */

import { describe, expect, it } from 'vitest';

import { murmur3_32 } from './murmur3.js';

/**
 * Pinned reference outputs, computed once from this exact implementation. Their purpose is not to
 * match some external Murmur3 oracle (this is the per-codepoint variant, so it deliberately differs
 * from the bytewise reference) but to lock the hash so a future edit to the mixing math trips here.
 */
const KNOWN_VECTORS: readonly { expected: number; seed: number; value: string }[] = [
	{ expected: 0, seed: 0, value: '' },
	{ expected: 142593372, seed: 42, value: '' },
	{ expected: 721651713, seed: 0, value: 'a' },
	{ expected: 449616461, seed: 0, value: 'hello' },
	{ expected: 1641515738, seed: 1, value: 'hello' },
	{ expected: 538438324, seed: 42, value: 'The quick brown fox' },
];

describe('murmur3_32', () => {
	it('matches its pinned known-vectors', () => {
		for (const { expected, seed, value } of KNOWN_VECTORS) {
			expect(murmur3_32(value, seed)).toBe(expected);
		}
	});

	it('is deterministic — repeated calls with the same input return the same hash', () => {
		const first = murmur3_32('reproducible', 7);
		const second = murmur3_32('reproducible', 7);

		expect(second).toBe(first);
	});

	it('is seed-sensitive — the same string under different seeds hashes differently', () => {
		expect(murmur3_32('hello', 0)).not.toBe(murmur3_32('hello', 1));
	});

	it('hashes the empty string to the seed-derived finalization (0 for seed 0)', () => {
		expect(murmur3_32('', 0)).toBe(0);
		expect(murmur3_32('', 42)).not.toBe(0);
	});

	it('always returns an unsigned 32-bit integer', () => {
		for (const value of ['', 'a', 'longer input string with spaces', '🍷 unicode 日本語']) {
			const hash = murmur3_32(value, 123);

			expect(Number.isInteger(hash)).toBe(true);
			expect(hash).toBeGreaterThanOrEqual(0);
			expect(hash).toBeLessThanOrEqual(0xffffffff);
		}
	});
});
