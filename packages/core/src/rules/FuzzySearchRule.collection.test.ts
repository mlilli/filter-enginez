/**
 * Tests for `FuzzySearchRule`'s collection search: one Fuse.js index per collection, searched once
 * per query, answering `action` for that collection's items.
 *
 * @remarks
 * **The answer never changes.** For every Fuse option the rule passes through, in single-field and
 * multi-key mode, the prepared answers equal both the per-item answers (one Fuse search per item,
 * which is what `action` falls back to) and a direct `new Fuse(collection, options).search(query)`.
 * Fuse decides each record's match from that record alone; the collection only feeds scoring
 * (field-length norm, token-search IDF), which a filter never reads.
 *
 * **The index is reused and replaced when it should be**, observed through a counting `field`
 * extractor: a new query, or a pass over a collection prepared before, reads no field; a new Fuse
 * option, a new collection, or a new extractor builds a new index. Items outside the prepared
 * collection, a rule passed in as another rule's `rule` argument, and items the index leaves out
 * all get the per-item answer. An engine over the same data agrees with and without bitmaps, keeps
 * a diacritic-folded match with the trigram index on, and follows `setSourceData`.
 */

// cspell:ignore cabernay chardonay pinnot nior Kabinett cremant crémant -- typo fixtures and wine names, the accented ones exercising ignoreDiacritics

import Fuse from 'fuse.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { createFilterEngine } from '../createFilterEngine.js';
import { initializeBitmapAcceleration } from '../internals/roaringInit.js';
import { buildFuseOptions } from './fuseOptions.js';
import { FuzzySearchRule, type FuzzySearchRuleConfig } from './FuzzySearchRule.js';

/** One fixture item: two strings, a string array, and fields that are sometimes not strings. */
interface Wine {
	readonly name: unknown;
	readonly notes?: readonly string[];
	readonly winery?: string;
}

const NAMES: readonly string[] = [
	'Cabernet Sauvignon',
	'cabernet franc',
	'Château Margaux Cabernet',
	'Pinot Noir',
	'pinot grigio',
	'Chardonnay Reserve',
	'Riesling Kabinett',
	'Grüner Veltliner',
	'Crémant de Loire',
	'a very long description of a wine that only mentions cabernet near the very end of it all',
	'Merlot',
	'',
	'   ',
	'Syrah / Shiraz',
	'CABERNET',
];

/** Items covering every field shape the rule reads. */
const WINES: readonly Wine[] = [
	...NAMES.map((name, i) => ({ name, notes: i % 2 === 0 ? ['oak', 'cherry'] : ['pinot', 'earth'], winery: `Domaine ${String(i)}` })),
	{ name: 42, winery: 'Cabernet Cellars' },
	{ name: null },
	{ name: ['cabernet'], winery: 'Pinot House' },
];

/** The option sets the equivalence runs under, each on top of a query. */
const OPTION_SETS: readonly Omit<FuzzySearchRuleConfig, 'query'>[] = [
	{},
	{ threshold: 0.2 },
	{ threshold: 0.6 },
	{ distance: 10 },
	{ distance: Number.POSITIVE_INFINITY },
	{ ignoreLocation: true },
	{ ignoreLocation: true, minMatchCharLength: 2 },
	{ location: 40, threshold: 0.3 },
	{ minMatchCharLength: 5 },
	{ isCaseSensitive: true },
	{ ignoreDiacritics: true },
	{ findAllMatches: true },
	{ fieldNormWeight: 2, ignoreFieldNorm: false },
	{ ignoreFieldNorm: true },
	{ useExtendedSearch: true },
	{ useTokenSearch: true },
	{ tokenMatch: 'all', useTokenSearch: true },
];

const QUERIES: readonly string[] = ['cabernay', 'pinnot nior', 'chardonay', 'chateau', 'Cabernet', 'gruner', '\'cab', '!pinot', 'cab | merlot', 'x', '  '];

/**
 * Indices of the items a rule passes, one way or another.
 *
 * @param items - The collection
 * @param pass - Whether one item passes
 * @returns The passing indices
 */
function passing(items: readonly unknown[], pass: (item: unknown) => boolean): number[] {
	return items.flatMap((item, i) => (pass(item) ? [i] : []));
}

/**
 * What a direct Fuse.js search over the collection returns, as item indices.
 *
 * @param config - The rule config
 * @param isMultiKey - Whether the rule searches `keys` (else the `name` field)
 * @returns The matching indices, ascending
 */
function directFuse(config: FuzzySearchRuleConfig, isMultiKey: boolean): number[] {
	const owners: number[] = [];
	const documents: unknown[] = [];

	WINES.forEach((wine, i) => {
		if (isMultiKey || typeof wine.name === 'string') {
			owners.push(i);
			documents.push(isMultiKey ? wine : wine.name);
		}
	});

	return new Fuse(documents, buildFuseOptions(config)).search(config.query)
		.map((result) => owners[result.refIndex] as number)
		.toSorted((a, b) => a - b);
}

beforeAll(async () => {
	await initializeBitmapAcceleration();
});

describe('FuzzySearchRule — collection search matches the per-item search', () => {
	for (const mode of ['single-field', 'multi-key'] as const) {
		it(`agrees for every option set and query — ${mode}`, () => {
			let compared = 0;
			let matchedSomething = 0;

			for (const options of OPTION_SETS) {
				for (const query of QUERIES) {
					const config: FuzzySearchRuleConfig = mode === 'multi-key'
						? { ...options, keys: ['name', 'winery', 'notes'], query }
						: { ...options, query };
					const perItem = new FuzzySearchRule('name', config);
					const prepared = new FuzzySearchRule('name', config);

					prepared.prepareForCollection(WINES);

					const expected = passing(WINES, (item) => perItem.action(item, perItem));
					const label = `${mode} ${JSON.stringify(options)} '${query}'`;

					expect(passing(WINES, (item) => prepared.action(item, prepared)), label).toEqual(expected);
					expect(directFuse(config, mode === 'multi-key'), label).toEqual(expected.filter((i) => {
						const { name } = WINES[i] as Wine;

						return mode === 'multi-key' || typeof name === 'string';
					}));
					compared++;
					matchedSomething += expected.length > 0 ? 1 : 0;
				}
			}
			expect(compared).toBe(OPTION_SETS.length * QUERIES.length);
			expect(matchedSomething).toBeGreaterThan(compared / 2);
		});
	}
});

describe('FuzzySearchRule — the collection index', () => {
	/**
	 * A rule over `name` that counts how often its extractor runs.
	 *
	 * @param config - The rule config
	 * @returns The rule and a reader for the count
	 */
	function countingRule(config: FuzzySearchRuleConfig): { reads: () => number; rule: FuzzySearchRule } {
		let count = 0;
		const rule = new FuzzySearchRule((item) => {
			count++;

			return (item as Wine).name;
		}, config);

		return { reads: () => count, rule };
	}

	it('searches the existing index for a new query, and builds a new one for a new option', () => {
		const { reads, rule } = countingRule({ query: 'cabernay' });

		rule.prepareForCollection(WINES);
		expect(reads()).toBe(WINES.length);

		rule.config = { query: 'pinnot nior' };
		rule.prepareForCollection(WINES);
		expect(reads()).toBe(WINES.length);
		expect(rule.action(WINES[3], rule)).toBe(true);
		// Answered from the index: no further field read.
		expect(reads()).toBe(WINES.length);

		rule.config = { ignoreLocation: true, query: 'pinnot nior' };
		rule.prepareForCollection(WINES);
		expect(reads()).toBe(WINES.length * 2);
	});

	it('reuses a collection\'s answers when a pass returns to it, and builds for a new collection', () => {
		const { reads, rule } = countingRule({ query: 'cabernay' });
		const other = WINES.slice(0, 3);

		rule.prepareForCollection(WINES);
		rule.prepareForCollection(other);
		expect(reads()).toBe(WINES.length + other.length);
		rule.prepareForCollection(WINES);
		rule.prepareForCollection(WINES);
		expect(reads()).toBe(WINES.length + other.length);
	});

	it('builds a new index and new answers for a new field extractor', () => {
		const rule = new FuzzySearchRule('name', { query: 'domaine 1' });

		rule.prepareForCollection(WINES);
		expect(rule.action(WINES[0], rule)).toBe(false);

		rule.field = 'winery';
		expect(rule.action(WINES[0], rule)).toBe(true);
		rule.prepareForCollection(WINES);
		expect(passing(WINES, (item) => rule.action(item, rule))).toContain(0);
	});

	it('answers an item outside the prepared collection the per-item way', () => {
		const rule = new FuzzySearchRule('name', { query: 'cabernay' });

		rule.prepareForCollection(WINES.slice(0, 2));
		expect(rule.action({ name: 'Cabernet' }, rule)).toBe(true);
		expect(rule.action({ name: 'Merlot' }, rule)).toBe(false);
	});

	it('answers for the config it is handed, not its own prepared one', () => {
		const prepared = new FuzzySearchRule('name', { query: 'cabernay' });
		const other = new FuzzySearchRule('name', { query: 'merlot' });

		prepared.prepareForCollection(WINES);
		expect(prepared.action(WINES[10], other)).toBe(true);
		expect(prepared.action(WINES[10], prepared)).toBe(false);
	});

	it('leaves out what the per-item search cannot read, and answers it the per-item way', () => {
		const multiKey = new FuzzySearchRule(undefined, { keys: ['name'], query: 'cabernay' });
		const mixed = ['cabernet', 'merlot', null, { name: 'Cabernet' }];

		multiKey.prepareForCollection(mixed);
		// A string item with `keys` is searched as a string by the one-item Fuse; the object from the index.
		expect(['cabernet', 'merlot', { name: 'Cabernet' }].map((item) => multiKey.action(item, multiKey))).toEqual([true, false, true]);
		expect(multiKey.action(mixed[3], multiKey)).toBe(true);

		const singleField = new FuzzySearchRule('name', { query: 'cabernay' });

		singleField.prepareForCollection(WINES);
		expect(singleField.action({ name: 42 }, singleField)).toBe(false);
	});

	it('prepares nothing for an empty query, which passes every item', () => {
		const { reads, rule } = countingRule({ query: '' });

		rule.prepareForCollection(WINES);
		expect(reads()).toBe(0);
		expect(passing(WINES, (item) => rule.action(item, rule))).toHaveLength(WINES.length);
	});
});

describe('FuzzySearchRule — inside an engine', () => {
	const config: FuzzySearchRuleConfig = { ignoreLocation: true, keys: ['name', 'winery'], minMatchCharLength: 2, query: 'cabernay' };

	it('matches a direct Fuse search over the source data, with and without bitmaps', () => {
		const expected = directFuse(config, true);

		for (const bitmap of ['off', 'on'] as const) {
			const engine = createFilterEngine<Wine>({ acceleration: { bitmap }, sourceData: WINES });

			engine.addRule('fuzzy', new FuzzySearchRule(undefined, config));

			expect([...engine.getResultIndices()], bitmap).toEqual(expected);
			expect([...engine.applyFiltersAndQuery().resultIndices], bitmap).toEqual(expected);
		}
		expect(expected.length).toBeGreaterThan(3);
	});

	it('keeps a diacritic-folded match the trigram index would have pruned', () => {
		const engine = createFilterEngine<Wine>({ acceleration: { bitmap: 'on', textIndex: 'on' }, sourceData: WINES });

		// 'cremant' shares two of its five trigrams with 'crémant de loire'; an exact match needs all five.
		engine.addRule('fuzzy', new FuzzySearchRule('name', { ignoreDiacritics: true, query: 'cremant', threshold: 0 }));

		expect([...engine.getResultIndices()]).toEqual([8]);
	});

	it('follows new source data', () => {
		const engine = createFilterEngine<Wine>({ acceleration: { bitmap: 'on' }, sourceData: WINES });

		engine.addRule('fuzzy', new FuzzySearchRule(undefined, config));
		engine.setSourceData([{ name: 'Merlot' }, { name: 'Cabernet', winery: 'x' }]);

		expect([...engine.getResultIndices()]).toEqual([1]);
	});
});
