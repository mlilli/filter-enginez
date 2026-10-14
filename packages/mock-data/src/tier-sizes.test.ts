/**
 * Tests for the canonical tier-size constants.
 *
 * @remarks
 * Node runtime. These are the single source of truth for per-tier record counts; the test pins
 * the values and the invariant every consumer relies on — the default tier stays below the
 * worker-bridge auto-engagement threshold (50k) while every full tier crosses it.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_TIER_SIZE, FULL_TIER_SIZES, FULL_WINE_TIER_SIZE } from './tier-sizes.js';
import { WINE_ORIGIN_MEASURED_TOTAL } from './wine/generate-origins.js';

const WORKER_AUTO_THRESHOLD = 50_000;

describe('tier-sizes', () => {
	it('sizes the default tier below the worker auto-engagement threshold', () => {
		expect(DEFAULT_TIER_SIZE).toBe(10_000);
		expect(DEFAULT_TIER_SIZE).toBeLessThan(WORKER_AUTO_THRESHOLD);
	});

	it('sizes every full tier at or above the worker auto-engagement threshold', () => {
		expect(FULL_TIER_SIZES).toEqual({ books: 100_000, 'real-estate': 50_000, wine: 150_000 });
		for (const size of Object.values(FULL_TIER_SIZES)) {
			expect(size).toBeGreaterThanOrEqual(WORKER_AUTO_THRESHOLD);
		}
	});

	it('sizes the wine full tier from one constant, above the measured review count', () => {
		// The generator gives every measured (origin, varietal) pairing at least one record only when
		// the full tier is at least as large as the review count the pairings were measured over.
		expect(FULL_TIER_SIZES.wine).toBe(FULL_WINE_TIER_SIZE);
		expect(FULL_WINE_TIER_SIZE).toBeGreaterThanOrEqual(WINE_ORIGIN_MEASURED_TOTAL);
	});
});
