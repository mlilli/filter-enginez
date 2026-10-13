/**
 * Tests for the deterministic seeded PRNG + sampling helpers.
 *
 * @remarks
 * Node runtime (no DOM). Determinism is asserted by comparing two same-seed streams; the
 * distribution helpers are driven by stub RNGs so every branch — including the defensive
 * out-of-bounds guards, which a caller can legitimately trip by passing a non-conforming RNG
 * (one that returns a value outside `[0, 1)`) — is exercised deterministically.
 */

import { describe, expect, it } from 'vitest';

import {
	mulberry32,
	normalSample,
	pickN,
	pickOne,
	pickWeighted,
	randomFloat,
	randomInt,
	slugify,
} from './random.js';

/** Draw `count` values from a freshly-seeded stream. */
function stream(seed: number, count: number): number[] {
	const rng = mulberry32(seed);

	return Array.from({ length: count }, () => rng());
}

describe('mulberry32', () => {
	it('is deterministic — the same seed yields the same sequence', () => {
		expect(stream(0xc4b3a4e7, 5)).toEqual(stream(0xc4b3a4e7, 5));
	});

	it('yields different sequences for different seeds', () => {
		expect(stream(1, 5)).not.toEqual(stream(2, 5));
	});

	it('coerces the seed to uint32, so a negative seed matches its `>>> 0` form', () => {
		expect(stream(-1, 5)).toEqual(stream(0xffffffff, 5));
	});

	it('yields values in [0, 1)', () => {
		for (const value of stream(42, 20)) {
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThan(1);
		}
	});
});

describe('randomInt / randomFloat', () => {
	it('maps the RNG range onto the inclusive integer bounds', () => {
		expect(randomInt(() => 0, 5, 10)).toBe(5);
		expect(randomInt(() => 0.9999, 5, 10)).toBe(10);
		expect(randomInt(() => 0.5, 0, 9)).toBe(5);
	});

	it('maps the RNG range onto the float bounds', () => {
		expect(randomFloat(() => 0, 2, 4)).toBe(2);
		expect(randomFloat(() => 0.5, 0, 10)).toBe(5);
	});
});

describe('pickOne', () => {
	it('picks by scaled index', () => {
		expect(pickOne(() => 0, ['a', 'b', 'c'])).toBe('a');
		expect(pickOne(() => 0.9999, ['a', 'b', 'c'])).toBe('c');
	});

	it('throws on an empty array', () => {
		expect(() => pickOne(() => 0, [])).toThrow('cannot pick from an empty array');
	});

	it('throws when a non-conforming RNG pushes the index out of bounds', () => {
		expect(() => pickOne(() => 1, ['a', 'b'])).toThrow('outside the array bounds');
	});
});

describe('pickN', () => {
	it('returns `count` distinct elements from the source', () => {
		const picked = pickN(mulberry32(1), ['a', 'b', 'c', 'd'], 2);

		expect(picked).toHaveLength(2);
		expect(new Set(picked).size).toBe(2);
		for (const element of picked) {
			expect(['a', 'b', 'c', 'd']).toContain(element);
		}
	});

	it('caps `count` at the source length', () => {
		expect(pickN(mulberry32(1), ['a', 'b'], 5)).toHaveLength(2);
	});

	it('tolerates a non-conforming RNG (out-of-bounds swap index is skipped)', () => {
		// `() => 1` drives every swap index to `length`, so each swap is skipped — the result is
		// the first `count` elements in original order.
		expect(pickN(() => 1, ['a', 'b', 'c'], 2)).toEqual(['a', 'b']);
	});
});

describe('pickWeighted', () => {
	it('picks proportionally to weight', () => {
		expect(pickWeighted(() => 0, [['a', 1], ['b', 1]])).toBe('a');
		expect(pickWeighted(() => 0.9, [['a', 1], ['b', 1]])).toBe('b');
	});

	it('throws on an empty list', () => {
		expect(() => pickWeighted(() => 0, [])).toThrow('empty list');
	});

	it('degrades to the first element when all weights are non-positive', () => {
		expect(pickWeighted(() => 0.5, [['a', 0], ['b', -1]])).toBe('a');
	});

	it('falls back to the last element on a numerical overshoot', () => {
		// A non-conforming RNG (> 1) leaves `target` positive after every subtraction, so the
		// loop never returns and the trailing fallback fires.
		expect(pickWeighted(() => 1.0001, [['a', 1], ['b', 1]])).toBe('b');
	});
});

describe('normalSample', () => {
	it('produces a deterministic in-range sample for a fixed RNG', () => {
		expect(normalSample(() => 0.5, 5, 1, 0, 10)).toBeCloseTo(3.823, 2);
	});

	it('clamps above the max and below the min', () => {
		expect(normalSample(() => 0.5, 100, 1, 0, 10)).toBe(10);
		expect(normalSample(() => 0.5, -100, 1, 0, 10)).toBe(0);
	});
});

describe('slugify', () => {
	it('lowercases, strips accents, and collapses non-alphanumerics to single dashes', () => {
		expect(slugify('Hello World — Test')).toBe('hello-world-test');
		expect(slugify('café 2024!')).toBe('cafe-2024');
		expect(slugify('--leading--trailing--')).toBe('leading-trailing');
	});
});
