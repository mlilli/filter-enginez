/**
 * Tests for `textFold` — the case and accent normalization `TextSearchRule` and the word index share.
 *
 * @remarks
 * Covers the default fold (lowercase only), accent stripping on composed and decomposed input,
 * Turkish case folding with and without stripping (where folding case before stripping is what keeps
 * `'İ'` a dotted `'i'`), case-sensitive folds, and the cache key that tells folds apart.
 */

// cspell:ignore ISPARTA ısparta İstanbul ıspa
import { describe, expect, it } from 'vitest';

import { DEFAULT_TEXT_FOLD, foldText, type TextFold, textFoldKey } from './textFold.js';

const IGNORE: TextFold = { caseSensitive: false, diacritics: 'ignore', locale: undefined };
const TURKISH: TextFold = { caseSensitive: false, diacritics: 'match', locale: 'tr' };

describe('foldText', () => {
	it('lowercases and keeps accents by default', () => {
		expect(foldText('Café ZOË', DEFAULT_TEXT_FOLD)).toBe('café zoë');
	});

	it.each([
		['Café', 'cafe'],
		['Café', 'cafe'],
		['Zoë', 'zoe'],
		['Crème Brûlée', 'creme brulee'],
		['ÅNGSTRÖM', 'angstrom'],
	])('strips accents from %j with diacritics ignore', (text, expected) => {
		expect(foldText(text, IGNORE)).toBe(expected);
	});

	it('folds Turkish dotted and dotless I by the tr locale', () => {
		expect(foldText('I', TURKISH)).toBe('ı');
		expect(foldText('İ', TURKISH)).toBe('i');
		expect(foldText('I', DEFAULT_TEXT_FOLD)).toBe('i');
		expect(foldText('İ', DEFAULT_TEXT_FOLD)).toBe('i̇');
	});

	it('folds case before stripping accents, so a Turkish İ stays a dotted i', () => {
		expect(foldText('İstanbul', { ...TURKISH, diacritics: 'ignore' })).toBe('istanbul');
		expect(foldText('İstanbul', IGNORE)).toBe('istanbul');
	});

	it('leaves case alone when case-sensitive, and still strips accents', () => {
		expect(foldText('Café', { caseSensitive: true, diacritics: 'ignore', locale: 'tr' })).toBe('Cafe');
		expect(foldText('Café', { caseSensitive: true, diacritics: 'match', locale: undefined })).toBe('Café');
	});
});

describe('textFoldKey', () => {
	it('names the default fold', () => {
		expect(textFoldKey(DEFAULT_TEXT_FOLD)).toBe('i|match|');
	});

	it('tells every option apart', () => {
		const keys = [
			DEFAULT_TEXT_FOLD,
			IGNORE,
			TURKISH,
			{ ...TURKISH, diacritics: 'ignore' },
			{ ...DEFAULT_TEXT_FOLD, caseSensitive: true },
		].map((fold) => textFoldKey(fold as TextFold));

		expect(new Set(keys).size).toBe(keys.length);
	});
});
