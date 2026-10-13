/**
 * @remarks
 * Inverted-text-index integration tests for {@link BitmapIndex} — the path where a
 * `TextSearchRule` (`'allWords'`) or `FuzzySearchRule` bitmap is built from a shared
 * {@link TextInvertedIndex} instead of the per-item predicate scan. The load-bearing assertion is
 * exact PARITY between the index path (`textIndex: 'auto'`) and the predicate fallback (`'off'`):
 * `allWords` is authoritative, fuzzy is a trigram candidate set confirmed by the exact Fuse pass —
 * both must reproduce the scalar rule bit-for-bit, including a trigram candidate that Fuse then
 * REJECTS ('blackboard' vs 'blackberry'). Also covers bypass fall-through (default-threshold /
 * substring), field-keyed index sharing, distinct-field separation, multi-rule `computeResults`,
 * and `clear()`. Drives a real WASM Roaring backend, so `beforeAll` awaits init.
 */

// cspell:ignore blackbery
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { FilterRule } from '../rules/FilterRule.js';
import type { RuleId } from '../types.js';

import { FuzzySearchRule } from '../rules/FuzzySearchRule.js';
import { TextSearchRule } from '../rules/TextSearchRule.js';
import { ValueRule } from '../rules/ValueRule.js';
import { InternalStore } from '../store/InternalStore.js';
import { TEXT_INDEX_AUTO_THRESHOLD, type TextIndexMode } from './accelerationModes.js';
import { BitmapIndex } from './BitmapIndex.js';
import { initializeBitmapAcceleration } from './roaringInit.js';

interface Wine {
	readonly text?: unknown;
}

/**
 * doc0 blackberry+oak+leather, doc1 oak+vanilla, doc2 plum+leather, doc3 'blackboard' (a fuzzy
 * trigram candidate for 'blackberry' that Fuse rejects at a strict threshold), doc4 non-string.
 */
const WINES: readonly Wine[] = [
	{ text: 'Oak leather blackberry finish' },
	{ text: 'oak vanilla plum' },
	{ text: 'plum leather tobacco' },
	{ text: 'blackboard notes and chalk' },
	{ text: 42 },
];

function sorted(indices: readonly number[]): number[] {
	return [...indices].sort((a, b) => a - b);
}

/** Passing source-data indices for a single rule, built under the given text-index mode. */
function indicesFor(textMode: TextIndexMode, rule: FilterRule, corpus: readonly Wine[] = WINES): number[] {
	const store = new InternalStore<Wine>(corpus);

	store.rules.value = new Map<RuleId, FilterRule>([['r', rule]]);
	const index = new BitmapIndex<Wine>(store, 'bitmap', 'auto', textMode);

	return sorted(index.getBitmap('r').toArray());
}

function allWords(query: string): TextSearchRule {
	return new TextSearchRule('text', { mode: 'allWords', query });
}

beforeAll(async () => {
	await initializeBitmapAcceleration();
});

describe('BitmapIndex — allWords authoritative parity', () => {
	it.each(['oak', 'oak leather', 'leather', 'blackberry', 'plum leather', 'notpresent'])(
		'index path matches the predicate scan for allWords %j',
		(query) => {
			expect(indicesFor('on', allWords(query))).toEqual(indicesFor('off', allWords(query)));
		},
	);

	it('resolves the expected set (spot check)', () => {
		expect(indicesFor('on', allWords('oak leather'))).toEqual([0]);
		expect(indicesFor('on', allWords('leather'))).toEqual([0, 2]);
	});
});

describe('BitmapIndex — fuzzy candidate→confirm parity', () => {
	it('matches the predicate scan at a strict threshold, excluding a Fuse-rejected trigram candidate', () => {
		// Short fields so Fuse's location penalty doesn't mask the match. 'blackbery' (typo, t=0.2)
		// matches 'blackberry' (0); 'blackboard' (1) is a trigram candidate Fuse then REJECTS — the
		// confirm pass must drop it in the index path exactly as the predicate scan does.
		const fuzzyCorpus: readonly Wine[] = [{ text: 'blackberry' }, { text: 'blackboard' }, { text: 'vanilla oak' }];
		const rule = new FuzzySearchRule('text', { query: 'blackbery', threshold: 0.2 });

		expect(indicesFor('on', rule, fuzzyCorpus)).toEqual(indicesFor('off', rule, fuzzyCorpus));
		expect(indicesFor('on', rule, fuzzyCorpus)).toEqual([0]);
	});

	it('bypasses (falls through to predicate) at the default 0.4 threshold', () => {
		const rule = new FuzzySearchRule('text', { query: 'cabernet' });

		expect(indicesFor('on', rule)).toEqual(indicesFor('off', rule));
	});
});

describe('BitmapIndex — bypass + off', () => {
	it('substring TextSearch bypasses the index (parity with predicate)', () => {
		const rule = new TextSearchRule('text', { mode: 'substring', query: 'oak' });

		expect(indicesFor('on', rule)).toEqual(indicesFor('off', rule));
	});

	it('textIndex "off" never engages the index yet stays correct', () => {
		expect(indicesFor('off', allWords('oak'))).toEqual([0, 1]);
	});
});

describe('BitmapIndex — field-keyed text-index sharing', () => {
	it('shares one index across text rules on the same field', () => {
		const store = new InternalStore<Wine>(WINES);
		const first = allWords('oak');
		const second = allWords('leather');

		store.rules.value = new Map<RuleId, FilterRule>([['first', first], ['second', second]]);
		const firstSpy = vi.spyOn(first, 'extractText');
		const secondSpy = vi.spyOn(second, 'extractText');
		const index = new BitmapIndex<Wine>(store, 'bitmap', 'auto', 'on');

		index.getBitmap('first');
		index.getBitmap('second');

		// Same 'text' field → one shared index built via the first rule; the second reuses its
		// postings and never re-extracts.
		expect(firstSpy).toHaveBeenCalled();
		expect(secondSpy).not.toHaveBeenCalled();
		firstSpy.mockRestore();
		secondSpy.mockRestore();
	});

	it('builds a separate index per distinct field', () => {
		interface TwoField {
			readonly nose: string;
			readonly palate: string;
		}
		const store = new InternalStore<TwoField>([
			{ nose: 'oak', palate: 'leather' },
			{ nose: 'plum', palate: 'oak' },
		]);
		const noseRule = new TextSearchRule('nose', { mode: 'allWords', query: 'oak' });
		const palateRule = new TextSearchRule('palate', { mode: 'allWords', query: 'oak' });

		store.rules.value = new Map<RuleId, FilterRule>([['nose', noseRule], ['palate', palateRule]]);
		const noseSpy = vi.spyOn(noseRule, 'extractText');
		const palateSpy = vi.spyOn(palateRule, 'extractText');
		const index = new BitmapIndex<TwoField>(store, 'bitmap', 'auto', 'on');

		expect(sorted(index.getBitmap('nose').toArray())).toEqual([0]);
		expect(sorted(index.getBitmap('palate').toArray())).toEqual([1]);
		// Distinct fields → two indexes → both rules extract.
		expect(noseSpy).toHaveBeenCalled();
		expect(palateSpy).toHaveBeenCalled();
		noseSpy.mockRestore();
		palateSpy.mockRestore();
	});
});

describe('BitmapIndex — computeResults + clear with a text rule', () => {
	it('intersects a text rule with another rule (parity across modes)', () => {
		function results(textMode: TextIndexMode): number[] {
			const store = new InternalStore<Wine>(WINES);

			store.rules.value = new Map<RuleId, FilterRule>([
				['words', allWords('leather')],
				['notchalk', new ValueRule('text', 'plum leather tobacco')],
			]);

			return sorted([...new BitmapIndex<Wine>(store, 'bitmap', 'auto', textMode).computeResults()]);
		}

		expect(results('on')).toEqual(results('off'));
		expect(results('on')).toEqual([2]);
	});

	it('clear() drops the text index; the next build reflects fresh data', () => {
		const store = new InternalStore<Wine>(WINES);

		store.rules.value = new Map<RuleId, FilterRule>([['r', allWords('oak')]]);
		const index = new BitmapIndex<Wine>(store, 'bitmap', 'auto', 'on');

		expect(sorted(index.getBitmap('r').toArray())).toEqual([0, 1]);

		index.clear();
		store.sourceData.value = [{ text: 'oak solo' }];
		store.sourceDataVersion.value = store.sourceDataVersion.value + 1;

		expect(sorted(index.getBitmap('r').toArray())).toEqual([0]);
	});
});

describe('BitmapIndex — text-index auto floor (S3)', () => {
	function manyWines(count: number, text: string): Wine[] {
		return Array.from({ length: count }, () => ({ text }));
	}

	it('auto bypasses the index below the floor (predicate scan; extractText untouched)', () => {
		const store = new InternalStore<Wine>(manyWines(TEXT_INDEX_AUTO_THRESHOLD - 1, 'oak leather'));
		const rule = allWords('oak');

		store.rules.value = new Map<RuleId, FilterRule>([['r', rule]]);
		const spy = vi.spyOn(rule, 'extractText');
		const index = new BitmapIndex<Wine>(store, 'bitmap', 'auto', 'auto');

		// Correct result via the predicate scan — every item matches 'oak'.
		expect(index.getBitmap('r').size).toBe(TEXT_INDEX_AUTO_THRESHOLD - 1);
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it('auto engages the index at the floor', () => {
		const store = new InternalStore<Wine>(manyWines(TEXT_INDEX_AUTO_THRESHOLD, 'oak leather'));
		const rule = allWords('oak');

		store.rules.value = new Map<RuleId, FilterRule>([['r', rule]]);
		const spy = vi.spyOn(rule, 'extractText');
		const index = new BitmapIndex<Wine>(store, 'bitmap', 'auto', 'auto');

		index.getBitmap('r');
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});

	it('on forces the index below the floor', () => {
		const store = new InternalStore<Wine>(manyWines(3, 'oak leather'));
		const rule = allWords('oak');

		store.rules.value = new Map<RuleId, FilterRule>([['r', rule]]);
		const spy = vi.spyOn(rule, 'extractText');
		const index = new BitmapIndex<Wine>(store, 'bitmap', 'auto', 'on');

		index.getBitmap('r');
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});
});
