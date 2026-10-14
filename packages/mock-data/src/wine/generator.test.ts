// cspell:ignore Acklam -- Peter Acklam's inverse-normal approximation
/**
 * The worker-safe generator sub-export: its API, its portable arithmetic and a fingerprint of the
 * canonical stream.
 *
 * @remarks
 * Node runtime. What the sub-export may import (no `node:` modules, no loaders, no engine-dependent
 * math) is a file-reading check, so it lives in the `tooling` project
 * (`tests/tooling/wineGeneratorWorkerSafe.test.ts`); this suite covers behavior.
 *
 * - **Portable arithmetic.** The generator computes e^x, ln x and the normal quantile from series and
 *   rational approximations, so every engine produces the same bits. They must still agree with
 *   the engine's own functions to within a few units in the last place.
 * - **A fingerprint of the stream.** A hash of the first records pins the exact output for the
 *   canonical seed, so a change to what the demos receive is always a deliberate one.
 */

import { describe, expect, it } from 'vitest';

import { portableExp, portableLog, portableNormalQuantile } from './generate-math.js';
import {
	DEFAULT_TIER_SIZE,
	FULL_WINE_TIER_SIZE,
	generateWineRange,
	generateWines,
	WINE_GENERATOR_SEED,
} from './generator.js';

/**
 * FNV-1a hash of a string, as eight hex digits.
 *
 * @param text - Any string.
 * @returns The hash.
 */
function fingerprint(text: string): string {
	let hash = 0x811C9DC5;

	for (let index = 0; index < text.length; index++) {
		hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
	}

	return (hash >>> 0).toString(16).padStart(8, '0');
}

describe('the generator sub-export', () => {
	it('exposes the tier sizes and the canonical seed', () => {
		expect(DEFAULT_TIER_SIZE).toBe(10_000);
		expect(FULL_WINE_TIER_SIZE).toBe(150_000);
		expect(WINE_GENERATOR_SEED).toBe(0xC4B3A4E7);
	});

	it('builds the same records in chunks as in one call', () => {
		const chunked = [...generateWineRange(0, 300, WINE_GENERATOR_SEED, 'full'), ...generateWineRange(300, 700, WINE_GENERATOR_SEED, 'full')];

		expect(chunked).toStrictEqual(generateWines(700, WINE_GENERATOR_SEED, 'full'));
	});

	it('matches the pinned fingerprint of the canonical stream', () => {
		// A deliberate change to the generator or its tables changes this value. Update it in the same
		// change, and say in the changeset that the generated records changed.
		expect(fingerprint(JSON.stringify(generateWines(1000)))).toBe('7a80a0a5');
	});
});

describe('portable arithmetic', () => {
	it('computes e^x within a few units in the last place across the price range', () => {
		for (let x = -2; x <= 9; x += 0.01) {
			expect(Math.abs(portableExp(x) / Math.exp(x) - 1), `x = ${x}`).toBeLessThan(1e-15);
		}
	});

	it('computes ln x within a few units in the last place, down to the generator grid', () => {
		for (const x of [2 ** -33, 1e-6, 0.024, 0.5, 0.7, 1, 1.41, 2, 10, 3300]) {
			expect(Math.abs(portableLog(x) - Math.log(x)), `x = ${x}`).toBeLessThan(1e-14);
		}
	});

	it('inverts the normal distribution to Acklam\'s accuracy, symmetrically', () => {
		const known: readonly (readonly [probability: number, quantile: number])[] = [
			[0.5, 0], [0.8413447460685429, 1], [0.9772498680518208, 2], [0.9986501019683699, 3], [0.0013498980316301, -3],
		];

		for (const [probability, expected] of known) {
			expect(portableNormalQuantile(probability)).toBeCloseTo(expected, 7);
		}
		expect(portableNormalQuantile(0.01)).toBe(-portableNormalQuantile(0.99));
	});
});
