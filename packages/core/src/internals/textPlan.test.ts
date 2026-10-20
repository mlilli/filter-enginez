/**
 * Unit tests for `compileTextPlan` — the dispatch from rule shape to `authoritative` / `candidate` /
 * `bypass`. The end-to-end correctness (that each plan produces the exact rule result through the
 * bitmap index) is covered in `BitmapIndex.text.test.ts`; this file pins the branch decisions.
 */

import { describe, expect, it } from 'vitest';

import { FuzzySearchRule } from '../rules/FuzzySearchRule.js';
import { TextSearchRule } from '../rules/TextSearchRule.js';
import { ValueRule } from '../rules/ValueRule.js';
import { computeFuzzyTrigramBound } from './fuzzyTrigramBound.js';
import { compileTextPlan } from './textPlan.js';

describe('compileTextPlan — TextSearchRule', () => {
	it('plans allWords (case-insensitive) authoritatively with lowercased query words', () => {
		const plan = compileTextPlan(new TextSearchRule('desc', { mode: 'allWords', query: 'Oak Leather' }));

		expect(plan.strategy).toBe('authoritative');
		if (plan.strategy === 'authoritative') {
			expect(plan.queryWords).toEqual(['oak', 'leather']);
		}
	});

	it('bypasses case-sensitive allWords (the lowercase index cannot serve it)', () => {
		const plan = compileTextPlan(
			new TextSearchRule('desc', { caseSensitive: true, mode: 'allWords', query: 'Oak' }),
		);

		expect(plan.strategy).toBe('bypass');
	});

	it('bypasses an empty allWords query', () => {
		expect(compileTextPlan(new TextSearchRule('desc', { mode: 'allWords', query: '' })).strategy).toBe('bypass');
	});

	it('bypasses an allWords query with no word characters', () => {
		expect(compileTextPlan(new TextSearchRule('desc', { mode: 'allWords', query: '!!! ,.' })).strategy).toBe(
			'bypass',
		);
	});

	it('bypasses non-allWords modes (substring is faster via String.includes)', () => {
		expect(compileTextPlan(new TextSearchRule('desc', { mode: 'substring', query: 'oak' })).strategy).toBe(
			'bypass',
		);
	});
});

describe('compileTextPlan — FuzzySearchRule', () => {
	it('plans a candidate at a strict threshold, echoing the sound bound', () => {
		const rule = new FuzzySearchRule('desc', { query: 'Blackberry', threshold: 0.2 });
		const plan = compileTextPlan(rule);
		const bound = computeFuzzyTrigramBound('blackberry', 0.2);

		expect(plan.strategy).toBe('candidate');
		if (plan.strategy === 'candidate') {
			expect(plan.minSharedTrigrams).toBe(bound.minSharedTrigrams);
			expect(new Set(plan.patternTrigrams)).toEqual(new Set(plan.patternTrigrams)); // distinct
			expect(plan.patternTrigrams).toContain('bla');
		}
	});

	it('bypasses default-threshold (0.4) fuzzy where the bound proves nothing', () => {
		expect(compileTextPlan(new FuzzySearchRule('desc', { query: 'cabernet' })).strategy).toBe('bypass');
	});

	it('bypasses an empty fuzzy query (the rule matches everything)', () => {
		expect(compileTextPlan(new FuzzySearchRule('desc', { query: '', threshold: 0.2 })).strategy).toBe('bypass');
	});

	it('bypasses multi-key fuzzy (searches the whole item, not one field)', () => {
		const plan = compileTextPlan(
			new FuzzySearchRule('desc', { keys: ['title', 'desc'], query: 'blackberry', threshold: 0.2 }),
		);

		expect(plan.strategy).toBe('bypass');
	});

	it.each([
		['ignoreDiacritics', { ignoreDiacritics: true }],
		['useExtendedSearch', { useExtendedSearch: true }],
		['useTokenSearch', { useTokenSearch: true }],
	] as const)('bypasses fuzzy with %s, which changes what the query means', (_name, options) => {
		expect(compileTextPlan(new FuzzySearchRule('desc', { ...options, query: 'blackberry', threshold: 0.2 })).strategy).toBe('bypass');
	});

	it('keeps the candidate plan for the options that leave the bound sound', () => {
		const options = { findAllMatches: true, ignoreDiacritics: false, ignoreLocation: true, isCaseSensitive: true, minMatchCharLength: 2 };

		expect(compileTextPlan(new FuzzySearchRule('desc', { ...options, query: 'blackberry', threshold: 0.2 })).strategy).toBe('candidate');
	});

	it('bypasses a pattern shorter than a trigram', () => {
		expect(compileTextPlan(new FuzzySearchRule('desc', { query: 'ab', threshold: 0.1 })).strategy).toBe('bypass');
	});
});

describe('compileTextPlan — other rules', () => {
	it('bypasses non-text rules', () => {
		expect(compileTextPlan(new ValueRule('color', 'red')).strategy).toBe('bypass');
	});
});
