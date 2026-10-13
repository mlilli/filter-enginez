/**
 * `compileTextPlan` — decide how (or whether) the inverted text index can serve a text rule.
 *
 * @remarks
 * Returns one of three DISTINCT plan shapes so a `candidate` (a superset that still needs the
 * exact confirm) can never be mistaken at the call site for an `authoritative` result (already
 * exact). The dispatch is purely a function of rule shape + config:
 *
 *   - **`TextSearchRule`, `'allWords'` mode, case-insensitive, non-empty query** → `authoritative`.
 *     The AND of the query words' postings is bit-for-bit the passing set — no confirm needed.
 *   - **`FuzzySearchRule`, single-field, with a usable trigram bound** → `candidate`. The index
 *     narrows to items sharing ≥ `minSharedTrigrams` distinct trigrams (a provable superset of the
 *     Fuse matches — see `fuzzyTrigramBound`); the caller confirms each with the exact Fuse pass.
 *   - **everything else** → `bypass`. Substring / exact / startsWith / endsWith / `tokenized`
 *     (native `String.includes` already wins), case-sensitive `'allWords'` (the lowercase index
 *     can't serve it), empty-query no-ops, multi-key fuzzy (searches the whole item, not one
 *     field), and default-threshold (0.4) fuzzy where the edit budget dissolves the bound.
 *
 * All normalization is to lowercase — matching the index (which lowercases field text) and Fuse's
 * case-insensitive default — so `authoritative` query words and `candidate` pattern trigrams are
 * already lowercased when they leave here.
 *
 * @packageDocumentation
 */

import type { FilterRule } from '../rules/FilterRule.js';

import { distinctTrigrams, extractWords } from '../lib/textTokens.js';
import { FuzzySearchRule } from '../rules/FuzzySearchRule.js';
import { TextSearchRule } from '../rules/TextSearchRule.js';
import { computeFuzzyTrigramBound } from './fuzzyTrigramBound.js';

/** Fuse.js default `threshold` — mirrors `FuzzySearchRule`'s `?? 0.4`; used when a rule omits it. */
const FUSE_DEFAULT_THRESHOLD = 0.4;

/** The index can't help — evaluate the rule by the per-item predicate scan. */
export interface TextBypassPlan {
	readonly strategy: 'bypass';
}

/** `allWords` — the AND of these words' postings IS the exact passing set; no confirm needed. */
export interface TextAuthoritativePlan {
	readonly queryWords: readonly string[];
	readonly strategy: 'authoritative';
}

/**
 * Fuzzy trigram pre-filter — items sharing ≥ `minSharedTrigrams` of the pattern's distinct trigrams
 * are a superset of the Fuse matches; each survivor still needs the exact per-item Fuse confirm.
 */
export interface TextCandidatePlan {
	readonly minSharedTrigrams: number;
	readonly patternTrigrams: readonly string[];
	readonly strategy: 'candidate';
}

/** The compiled plan for serving (or bypassing) a text rule via the inverted index. */
export type TextPlan = TextAuthoritativePlan | TextBypassPlan | TextCandidatePlan;

/** Shared singleton — the bypass plan carries no data, so one frozen instance is reused. */
const BYPASS_PLAN: TextBypassPlan = { strategy: 'bypass' };

/**
 * Compile the inverted-index plan for a rule. Non-text rules (and text rules the index can't serve
 * soundly) return `bypass`.
 *
 * @param rule - The rule whose bitmap the `BitmapIndex` is about to build
 * @returns The plan the caller applies: `authoritative` (use as-is), `candidate` (confirm), or
 *   `bypass` (fall back to the per-item predicate scan)
 */
export function compileTextPlan(rule: FilterRule): TextPlan {
	if (rule instanceof TextSearchRule) {
		return planTextSearch(rule);
	}
	if (rule instanceof FuzzySearchRule) {
		return planFuzzySearch(rule);
	}

	return BYPASS_PLAN;
}

/** Plan a `TextSearchRule`: only case-insensitive `'allWords'` with a word-bearing query is served. */
function planTextSearch(rule: TextSearchRule): TextPlan {
	const { caseSensitive: isCaseSensitive, mode, query } = rule.config;

	if (mode !== 'allWords' || isCaseSensitive === true || query.length === 0) {
		return BYPASS_PLAN;
	}
	const queryWords = extractWords(query.toLowerCase());

	// A query with no word characters (e.g. punctuation only) is a rule no-op — let the predicate
	// scan handle it rather than intersecting zero postings.
	if (queryWords.length === 0) {
		return BYPASS_PLAN;
	}

	return { queryWords, strategy: 'authoritative' };
}

/** Plan a `FuzzySearchRule`: single-field, non-empty, with a bound that actually prunes. */
function planFuzzySearch(rule: FuzzySearchRule): TextPlan {
	const { keys, query, threshold } = rule.config;

	// Empty query matches everything (the rule short-circuits to `true`); multi-key mode searches
	// the whole item rather than one field — neither is served by a single-field index.
	if (query.length === 0 || (keys !== undefined && keys.length > 0)) {
		return BYPASS_PLAN;
	}
	const normalizedPattern = query.toLowerCase();
	const bound = computeFuzzyTrigramBound(normalizedPattern, threshold ?? FUSE_DEFAULT_THRESHOLD);

	// The bound proves nothing (pattern too short / too long, or the edit budget at this threshold
	// wipes out any guaranteed shared trigram) → the index can't prune this pattern.
	if (bound.shouldBypass) {
		return BYPASS_PLAN;
	}

	return {
		minSharedTrigrams: bound.minSharedTrigrams,
		patternTrigrams: [...distinctTrigrams(normalizedPattern)],
		strategy: 'candidate',
	};
}
