/**
 * PINNED fuzz test — the adversarial soundness guard for {@link computeFuzzyTrigramBound} against the
 * INSTALLED fuse.js (pinned to 7.4.2 in `packages/core/package.json`).
 *
 * @remarks
 * The whole trigram fuzzy pre-filter rests on two facts about Fuse v7's internals: the Bitap score is
 * additive (`errors/m + location/distance`, penalty ≥ 0, so a match implies `errors ≤ floor(t·m)`),
 * and patterns longer than 32 chars are chunk-OR'd. This test encodes the invariant those facts imply
 * — **every haystack Fuse returns as a match must share ≥ `minSharedTrigrams` distinct trigrams with
 * the pattern (when the bound applies)** — and fuzzes it across thresholds, distances, `ignoreLocation`,
 * and edit budgets. A Fuse upgrade that changes the score model or the chunking will flip a match into
 * a would-be-pruned item and turn this red BEFORE the bound silently rots.
 *
 * If this fails after a `fuse.js` bump: re-derive the bound against the new Fuse `computeScore` /
 * `search` / `searchIn`, do not just widen the tolerance. The bound is a correctness contract.
 *
 * Deterministic (seeded PRNG) so it never flakes.
 */

import Fuse from 'fuse.js';
import { describe, expect, it } from 'vitest';

import { distinctTrigrams } from '../lib/textTokens.js';
import { computeFuzzyTrigramBound } from './fuzzyTrigramBound.js';

/** Deterministic PRNG (mulberry32) — a fixed seed keeps the fuzz reproducible run to run. */
function createRandom(seed: number): () => number {
	let state = seed >>> 0;

	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);

		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz ';

function sharedTrigramCount(pattern: string, haystack: string): number {
	const haystackTrigrams = distinctTrigrams(haystack);
	let shared = 0;

	for (const trigram of distinctTrigrams(pattern)) {
		if (haystackTrigrams.has(trigram)) {
			shared++;
		}
	}

	return shared;
}

describe('fuzzyTrigramBound (pinned to installed fuse.js)', () => {
	it('never prunes a real Fuse match across an adversarial fuzz sweep', () => {
		const random = createRandom(0x5eed_1234);
		const randInt = (n: number): number => Math.floor(random() * n);
		const randString = (length: number): string => {
			let result = '';

			for (let i = 0; i < length; i++) {
				result += ALPHABET.charAt(randInt(ALPHABET.length));
			}

			return result;
		};
		const mutate = (source: string, edits: number): string => {
			const chars = source.split('');

			for (let i = 0; i < edits; i++) {
				const op = randInt(3);
				const pos = randInt(chars.length + 1);

				if (op === 0 && chars.length > 0) {
					chars.splice(Math.min(pos, chars.length - 1), 1);
				} else if (op === 1) {
					chars.splice(pos, 0, ALPHABET.charAt(randInt(ALPHABET.length)));
				} else if (chars.length > 0) {
					chars[Math.min(pos, chars.length - 1)] = ALPHABET.charAt(randInt(ALPHABET.length));
				}
			}

			return chars.join('');
		};

		const thresholds = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4];
		const locationModes: readonly Record<string, unknown>[] = [
			{ ignoreLocation: true },
			{ distance: 100, ignoreLocation: false },
			{ distance: 1000, ignoreLocation: false },
		];
		const TRIALS = 15000;

		let fuseMatches = 0;
		let violations = 0;

		for (let trial = 0; trial < TRIALS; trial++) {
			// Mostly indexable lengths (3..32), sometimes the degenerate/chunking regimes.
			let pattern = randString(3 + randInt(30));

			if (random() < 0.1) {
				pattern = randString(33 + randInt(20)); // > 32 chars -> chunking regime
			}
			if (random() < 0.05) {
				pattern = randString(1 + randInt(2)); // < 3 chars -> degenerate
			}

			const threshold = thresholds[randInt(thresholds.length)] ?? 0.2;
			const locationMode = locationModes[randInt(locationModes.length)] ?? {};
			const editBudget = Math.floor(threshold * pattern.length);
			const core = mutate(pattern, randInt(editBudget + 2)); // 0..budget+1 edits, straddling
			const haystack = randString(randInt(10)) + core + randString(randInt(10));

			const fuse = new Fuse([haystack], { includeScore: true, threshold, ...locationMode });
			const isFuseMatch = fuse.search(pattern).length > 0;
			const bound = computeFuzzyTrigramBound(pattern.toLowerCase(), threshold);

			if (isFuseMatch) {
				fuseMatches++;

				// When the bound applies, a real Fuse match must survive the pre-filter.
				if (!bound.shouldBypass && sharedTrigramCount(pattern, haystack) < bound.minSharedTrigrams) {
					violations++;
				}
			}
		}

		// Sanity: the sweep actually exercised Fuse matches (not a degenerate all-miss run).
		expect(fuseMatches).toBeGreaterThan(1000);
		expect(violations).toBe(0);
	});

	it('bypasses the >32-char chunking regime that would otherwise be unsound', () => {
		// Fuse chunk-ORs patterns past 32 chars: this 48-char pattern matches a haystack holding only
		// its first 32 chars, so a whole-pattern trigram bound is invalid — the bound must bypass.
		const pattern = 'a'.repeat(32) + 'z'.repeat(16);
		const haystack = 'a'.repeat(32);
		const isFuseMatch = new Fuse([haystack], { includeScore: true, threshold: 0.3 }).search(pattern).length > 0;

		expect(isFuseMatch).toBe(true); // Fuse matches on the first chunk alone
		expect(computeFuzzyTrigramBound(pattern, 0.3).shouldBypass).toBe(true);
		expect(computeFuzzyTrigramBound(pattern, 0.3).bypassReason).toBe('pattern-too-long');
	});
});
