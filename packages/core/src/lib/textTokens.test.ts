/**
 * Tests for the shared text tokenizers (`extractWords`, `extractTrigrams`, `distinctTrigrams`).
 *
 * @remarks
 * Covers word splitting (whitespace + punctuation, hyphens, Unicode retention, the no-word `?? []`
 * fallback, case preservation) and the trigram helpers (the sliding window with no padding, the
 * short-string boundary that yields no trigrams, cross-word trigrams spanning spaces, and the
 * distinct-set form).
 */

import { describe, expect, it } from 'vitest';

import { coerceStringField, distinctTrigrams, extractTrigrams, extractWords } from './textTokens.js';

describe('extractWords', () => {
	it('splits on whitespace and punctuation into maximal alphanumeric runs', () => {
		expect(extractWords('aged oak, with a leather finish')).toEqual([
			'aged',
			'oak',
			'with',
			'a',
			'leather',
			'finish',
		]);
	});

	it('splits hyphenated compounds on the hyphen', () => {
		expect(extractWords('oak-aged')).toEqual(['oak', 'aged']);
	});

	it('keeps Unicode letters and numbers intact', () => {
		expect(extractWords('Vulkà 2013 Château')).toEqual(['Vulkà', '2013', 'Château']);
	});

	it('returns an empty array when the string has no word characters', () => {
		expect(extractWords('   ,.!  ')).toEqual([]);
	});

	it('preserves case — the caller is responsible for normalization', () => {
		expect(extractWords('Oak OAK oak')).toEqual(['Oak', 'OAK', 'oak']);
	});
});

describe('extractTrigrams', () => {
	it('produces the overlapping sliding-window trigrams with no padding', () => {
		expect(extractTrigrams('oaken')).toEqual(['oak', 'ake', 'ken']);
	});

	it('includes cross-word trigrams spanning the separating space', () => {
		// The space is part of the window — 'k l' and ' le' are legitimate spanning trigrams.
		expect(extractTrigrams('oak leather')).toContain('k l');
		expect(extractTrigrams('oak leather')).toContain(' le');
	});

	it('returns an empty array for strings shorter than 3 characters', () => {
		expect(extractTrigrams('ok')).toEqual([]);
		expect(extractTrigrams('')).toEqual([]);
	});

	it('keeps duplicate trigrams (order preserved)', () => {
		expect(extractTrigrams('aaaa')).toEqual(['aaa', 'aaa']);
	});
});

describe('distinctTrigrams', () => {
	it('returns the unique trigrams as a set', () => {
		expect(distinctTrigrams('aaaa')).toEqual(new Set(['aaa']));
		expect(distinctTrigrams('oaken')).toEqual(new Set(['oak', 'ake', 'ken']));
	});

	it('is empty for strings shorter than 3 characters', () => {
		expect(distinctTrigrams('ok').size).toBe(0);
	});
});

describe('coerceStringField', () => {
	it('returns the value unchanged when it is a string', () => {
		expect(coerceStringField('oak')).toBe('oak');
		expect(coerceStringField('')).toBe('');
	});

	it('returns undefined for non-string values', () => {
		expect(coerceStringField(42)).toBeUndefined();
		expect(coerceStringField(null)).toBeUndefined();
		expect(coerceStringField(undefined)).toBeUndefined();
		expect(coerceStringField({ text: 'x' })).toBeUndefined();
	});
});
