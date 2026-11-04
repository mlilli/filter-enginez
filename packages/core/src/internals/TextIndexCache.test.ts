/**
 * Tests for `TextIndexCache` — one `TextInvertedIndex` per text field and fold.
 *
 * @remarks
 * Rules on one field with the same fold share an index (whatever their query or mode); a different
 * fold or a different field gets its own; `clear()` drops them all, so the next ask builds anew.
 * Querying postings needs the WASM Roaring backend, so `beforeAll` awaits init.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_TEXT_FOLD, type TextFold } from '../lib/textFold.js';
import { FuzzySearchRule } from '../rules/FuzzySearchRule.js';
import { TextSearchRule } from '../rules/TextSearchRule.js';
import { InternalStore } from '../store/InternalStore.js';
import { initializeBitmapAcceleration } from './roaringInit.js';
import { TextIndexCache } from './TextIndexCache.js';

interface Note {
	readonly body: string;
	readonly title: string;
}

const IGNORE: TextFold = { caseSensitive: false, diacritics: 'ignore', locale: undefined };

beforeAll(async () => {
	await initializeBitmapAcceleration();
});

describe('TextIndexCache', () => {
	const store = new InternalStore<Note>([{ body: 'Café', title: 'Zoë' }]);

	it('shares one index across rules on a field with the same fold', () => {
		const cache = new TextIndexCache<Note>();
		const words = new TextSearchRule('body', { mode: 'allWords', query: 'cafe' });
		const fuzzy = new FuzzySearchRule('body', { query: 'cafe' });

		expect(cache.get(store, words, DEFAULT_TEXT_FOLD)).toBe(cache.get(store, fuzzy, DEFAULT_TEXT_FOLD));
	});

	it('keeps a separate index for another fold or another field', () => {
		const cache = new TextIndexCache<Note>();
		const body = new TextSearchRule('body', { mode: 'allWords', query: 'cafe' });
		const title = new TextSearchRule('title', { mode: 'allWords', query: 'zoe' });
		const plain = cache.get(store, body, DEFAULT_TEXT_FOLD);

		expect(cache.get(store, body, IGNORE)).not.toBe(plain);
		expect(cache.get(store, title, DEFAULT_TEXT_FOLD)).not.toBe(plain);
		expect(cache.get(store, body, IGNORE).queryAllWords(['cafe']).toArray()).toEqual([0]);
		expect(plain.queryAllWords(['cafe']).toArray()).toEqual([]);
	});

	it('builds anew after clear', () => {
		const cache = new TextIndexCache<Note>();
		const rule = new TextSearchRule('body', { mode: 'allWords', query: 'cafe' });
		const before = cache.get(store, rule, DEFAULT_TEXT_FOLD);

		cache.clear();
		expect(cache.get(store, rule, DEFAULT_TEXT_FOLD)).not.toBe(before);
	});
});
