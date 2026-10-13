/**
 * `fuzzyTrigramBound` — the provably-safe q-gram count-filter bound that lets the inverted trigram
 * index pre-filter `FuzzySearchRule` candidates WITHOUT ever dropping a real Fuse.js match.
 *
 * @remarks
 * A per-pattern necessary condition: if Fuse (v7.x, Bitap) matches a haystack for this pattern within
 * its `threshold`, then the pattern and haystack share at least `minSharedTrigrams` distinct character
 * trigrams. The index can therefore prune any item that shares fewer — those can't be Fuse matches —
 * and confirm the survivors with the real Fuse pass. Postings can only over-count shared trigrams, so
 * this stays sound.
 *
 * **The bound.** For a normalized pattern of length `m` with `D` distinct trigrams, matched within
 * Fuse `threshold` `t`:
 *   - **max accepted errors `e = maxFuseErrors(m, t)`** — the largest integer error count Fuse can
 *     accept, computed in Fuse's own IEEE-754 arithmetic (see {@link maxFuseErrors}). This is exact,
 *     not the real-arithmetic proxy `floor(t·m)`: it agrees with `floor(t·m)` on every realistic
 *     threshold but is provably correct even at the pathological `k/m` thresholds where `floor`
 *     underflows by one — so no floating-point safety margin is needed.
 *   - each edit (insert/delete/substitute) destroys at most 3 (= trigram length) of the pattern's
 *     q-gram windows, so a match preserves at least `D − 3e` distinct trigrams.
 *   - **`minSharedTrigrams = D − 3e`** — sound by construction for every `(m, t)` with `m ≤ 32`.
 *
 * **Bypass regimes** (the bound proves nothing → the index must pass everything to that rule):
 *   - `m < 3` — no trigrams to compare.
 *   - `m > 32` — Fuse chunk-ORs patterns past `MAX_BITS` (32) and matches on ANY 32-char chunk, so a
 *     whole-pattern edit budget is invalid (a 48-char pattern can match a haystack holding only its
 *     first 32 chars). Whole-pattern trigram reasoning is unsound here.
 *   - `minSharedTrigrams <= 0` — the bound permits sharing zero trigrams, so no pruning is possible.
 *     (At Fuse's default `threshold` 0.4 this is ALWAYS the case, so default-threshold fuzzy is never
 *     index-accelerable. That is correct, not a gap. Real pruning appears at `t <= ~0.2`.)
 *
 * **This bound is pinned to Fuse v7's scoring internals** (the additive `errors/m + location/distance`
 * score + the `>32`-char chunk-OR). `fuzzyTrigramBound.pinned.test.ts` fuzzes it against the installed
 * Fuse and fails loudly if a Fuse upgrade ever changes those facts. Re-verify on any Fuse bump.
 *
 * @packageDocumentation
 */

import { distinctTrigrams } from '../lib/textTokens.js';

/** Fuse.js Bitap `MAX_BITS` — patterns longer than this are chunk-OR'd, invalidating the bound. */
const FUSE_MAX_PATTERN_LENGTH = 32;

/** Character-trigram length; the most q-gram windows a single edit can destroy. */
const TRIGRAM_LENGTH = 3;

/** Why the trigram pre-filter cannot be applied to a given fuzzy pattern (or `'none'` if it can). */
export type FuzzyTrigramBypassReason = 'no-reduction' | 'none' | 'pattern-too-long' | 'pattern-too-short';

/**
 * The computed trigram bound for one normalized fuzzy pattern. When `shouldBypass` is `false`,
 * `minSharedTrigrams > 0` and an item may be pruned iff it shares fewer than that many of the
 * pattern's distinct trigrams. When `shouldBypass` is `true`, the numeric fields are diagnostic only.
 */
export interface FuzzyTrigramBound {
	/** Why the pre-filter is skipped, or `'none'` when it applies. */
	readonly bypassReason: FuzzyTrigramBypassReason;
	/** `D` — the count of distinct trigrams in the pattern. */
	readonly distinctTrigramCount: number;
	/** `e` — the exact maximum error count a Fuse match can have (see {@link maxFuseErrors}). */
	readonly maxAcceptedErrors: number;
	/** `D − 3e` — the sound minimum shared-trigram count for any Fuse match (may be ≤ 0). */
	readonly minSharedTrigrams: number;
	/** `true` when the bound proves nothing and the index must pass every item to the exact rule. */
	readonly shouldBypass: boolean;
}

/**
 * The largest integer error count Fuse.js can accept for a pattern of length `patternLength` at
 * `matchThreshold`, computed in the same IEEE-754 arithmetic Fuse uses.
 *
 * @remarks
 * Fuse registers a match only when some alignment scores `errors / patternLength + proximity / distance
 * <= threshold`; the proximity term is non-negative, so acceptance REQUIRES
 * `fl(errors / patternLength) <= fl(threshold)`. Evaluating that exact gate — instead of the
 * real-arithmetic proxy `floor(t·m)` — is provably safe by construction: it matches `floor(t·m)` on
 * every realistic (short-decimal) threshold, and at the pathological `k/m` thresholds where `floor`
 * underflows by one it returns the correctly-larger (safer) count. No FP-boundary margin is required.
 *
 * @param patternLength - Normalized pattern length `m`
 * @param matchThreshold - Fuse `threshold` in `[0, 1]`
 * @returns The maximum error count a Fuse match can have, in `0..patternLength`
 */
export function maxFuseErrors(patternLength: number, matchThreshold: number): number {
	let errors = 0;

	while (errors + 1 <= patternLength && (errors + 1) / patternLength <= matchThreshold) {
		errors++;
	}

	return errors;
}

/**
 * Compute the sound trigram pre-filter bound for a fuzzy pattern.
 *
 * @param normalizedPattern - The query pattern, normalized identically to how the index normalizes
 *   field text (Fuse folds case internally, so callers pass a lowercased pattern)
 * @param matchThreshold - Fuse's `threshold` for this rule (0 = exact, 1 = match anything)
 * @returns The bound; consult {@link FuzzyTrigramBound.shouldBypass} before using `minSharedTrigrams`
 */
export function computeFuzzyTrigramBound(
	normalizedPattern: string,
	matchThreshold: number,
): FuzzyTrigramBound {
	const patternLength = normalizedPattern.length;
	const distinctTrigramCount = distinctTrigrams(normalizedPattern).size;

	if (patternLength < TRIGRAM_LENGTH) {
		return {
			bypassReason: 'pattern-too-short',
			distinctTrigramCount,
			maxAcceptedErrors: 0,
			minSharedTrigrams: 0,
			shouldBypass: true,
		};
	}

	if (patternLength > FUSE_MAX_PATTERN_LENGTH) {
		return {
			bypassReason: 'pattern-too-long',
			distinctTrigramCount,
			maxAcceptedErrors: 0,
			minSharedTrigrams: 0,
			shouldBypass: true,
		};
	}

	const maxAcceptedErrors = maxFuseErrors(patternLength, matchThreshold);
	const minSharedTrigrams = distinctTrigramCount - TRIGRAM_LENGTH * maxAcceptedErrors;

	if (minSharedTrigrams <= 0) {
		return {
			bypassReason: 'no-reduction',
			distinctTrigramCount,
			maxAcceptedErrors,
			minSharedTrigrams,
			shouldBypass: true,
		};
	}

	return {
		bypassReason: 'none',
		distinctTrigramCount,
		maxAcceptedErrors,
		minSharedTrigrams,
		shouldBypass: false,
	};
}
