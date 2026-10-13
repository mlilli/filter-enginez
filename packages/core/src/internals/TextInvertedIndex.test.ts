/**
 * Unit tests for {@link TextInvertedIndex} — the word + trigram posting maps directly (the
 * bitmap-index integration + rule-equivalence property tests live in `BitmapIndex.text.test.ts`).
 *
 * @remarks
 * Covers `queryAllWords` (exact AND, absent word → empty, disjoint short-circuit, empty query),
 * `queryFuzzyCandidates` (superset counting, absent-trigram skip, the min-shared threshold),
 * `isReady` (fresh / words-only / trigrams-only), `clear`, source-data-version rebuild, and the
 * build-time skips of hole items + non-string fields. Drives a real WASM-initialized Roaring
 * backend, so `beforeAll` awaits `initializeBitmapAcceleration()`.
 */

// cspell:ignore leatherx
import { beforeAll, describe, expect, it } from 'vitest';

import { distinctTrigrams } from '../lib/textTokens.js';
import { InternalStore } from '../store/InternalStore.js';
import { initializeBitmapAcceleration } from './roaringInit.js';
import { TextInvertedIndex } from './TextInvertedIndex.js';

interface Doc {
	readonly text?: unknown;
}

/** doc0 has oak+leather+blackberry, doc1 oak+vanilla, doc2 plum+leather. */
const DOCS: readonly Doc[] = [
	{ text: 'Oak leather blackberry' },
	{ text: 'oak vanilla' },
	{ text: 'plum leather' },
];

function getText(item: Doc): string | undefined {
	return typeof item.text === 'string' ? item.text : undefined;
}

function makeIndex(items: readonly Doc[] = DOCS): TextInvertedIndex<Doc> {
	return new TextInvertedIndex<Doc>(new InternalStore<Doc>(items), getText);
}

function sorted(indices: readonly number[]): number[] {
	return [...indices].sort((a, b) => a - b);
}

beforeAll(async () => {
	await initializeBitmapAcceleration();
});

describe('TextInvertedIndex.queryAllWords', () => {
	it('returns the indices whose field contains the single word (case-folded)', () => {
		expect(sorted(makeIndex().queryAllWords(['oak']).toArray())).toEqual([0, 1]);
		expect(sorted(makeIndex().queryAllWords(['leather']).toArray())).toEqual([0, 2]);
	});

	it('ANDs multiple words — only items with all of them', () => {
		expect(sorted(makeIndex().queryAllWords(['oak', 'leather']).toArray())).toEqual([0]);
		expect(sorted(makeIndex().queryAllWords(['oak', 'vanilla']).toArray())).toEqual([1]);
	});

	it('returns empty when a required word is absent from the index', () => {
		expect(makeIndex().queryAllWords(['oak', 'notpresent']).toArray()).toEqual([]);
		expect(makeIndex().queryAllWords(['notpresent']).toArray()).toEqual([]);
	});

	it('short-circuits to empty on a disjoint word pair', () => {
		// vanilla → {1}, plum → {2}; the AND empties (and returns early on size 0).
		expect(makeIndex().queryAllWords(['vanilla', 'plum']).toArray()).toEqual([]);
	});

	it('returns empty for an empty word list', () => {
		expect(makeIndex().queryAllWords([]).toArray()).toEqual([]);
	});
});

describe('TextInvertedIndex.queryFuzzyCandidates', () => {
	it('keeps items sharing at least the minimum distinct trigrams (a superset of exact matches)', () => {
		const trigrams = [...distinctTrigrams('blackberry')];

		// Only doc0 contains "blackberry", so at minShared 1 it is the sole candidate.
		expect(sorted(makeIndex().queryFuzzyCandidates(trigrams, 1))).toEqual([0]);
	});

	it('returns empty when no pattern trigram is present (absent-posting skip)', () => {
		expect(makeIndex().queryFuzzyCandidates(['zzz', 'qxq'], 1)).toEqual([]);
	});

	it('raising the minimum shared count prunes weak overlaps', () => {
		// 'leatherx' shares many trigrams with the two "leather" docs; a very high bar drops them.
		const trigrams = [...distinctTrigrams('leather')];

		expect(makeIndex().queryFuzzyCandidates(trigrams, trigrams.length + 1)).toEqual([]);
	});
});

describe('TextInvertedIndex.isReady / clear', () => {
	it('is not ready before any query and ready after a word query', () => {
		const index = makeIndex();

		expect(index.isReady).toBe(false);
		index.queryAllWords(['oak']);
		expect(index.isReady).toBe(true);
	});

	it('is ready after only a trigram query (trigram branch)', () => {
		const index = makeIndex();

		index.queryFuzzyCandidates([...distinctTrigrams('oak')], 1);
		expect(index.isReady).toBe(true);
	});

	it('clear() drops both posting maps', () => {
		const index = makeIndex();

		index.queryAllWords(['oak']);
		index.queryFuzzyCandidates([...distinctTrigrams('oak')], 1);
		index.clear();
		expect(index.isReady).toBe(false);
	});
});

describe('TextInvertedIndex — build behavior', () => {
	it('rebuilds against new source data when the version advances', () => {
		const store = new InternalStore<Doc>(DOCS);
		const index = new TextInvertedIndex<Doc>(store, getText);

		expect(sorted(index.queryAllWords(['oak']).toArray())).toEqual([0, 1]);

		store.sourceData.value = [{ text: 'oak only here' }];
		store.sourceDataVersion.value = store.sourceDataVersion.value + 1;

		expect(sorted(index.queryAllWords(['oak']).toArray())).toEqual([0]);
		expect(index.queryAllWords(['leather']).toArray()).toEqual([]);
	});

	it('caches within a version (a second query reuses the built postings)', () => {
		const index = makeIndex();

		expect(sorted(index.queryAllWords(['oak']).toArray())).toEqual([0, 1]);
		// Second call hits the cached word map (same result, no rebuild).
		expect(sorted(index.queryAllWords(['oak']).toArray())).toEqual([0, 1]);
		// And the trigram map caches independently.
		const trigrams = [...distinctTrigrams('oak')];

		expect(sorted(index.queryFuzzyCandidates(trigrams, 1))).toEqual(sorted(index.queryFuzzyCandidates(trigrams, 1)));
	});

	it('skips hole items and non-string / missing fields during the build', () => {
		const items: readonly Doc[] = [
			{ text: 'oak' },
			undefined as unknown as Doc,
			{ text: 42 },
			{},
			{ text: 'oak leather' },
		];
		const index = new TextInvertedIndex<Doc>(new InternalStore<Doc>(items), getText);

		// Only indices 0 and 4 carry a string field with 'oak'.
		expect(sorted(index.queryAllWords(['oak']).toArray())).toEqual([0, 4]);
	});
});
