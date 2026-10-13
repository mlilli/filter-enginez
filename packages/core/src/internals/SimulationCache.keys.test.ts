/**
 * @remarks
 * Tests for the `SimulationCache` key and fallback semantics: hypothetical rules and expressions
 * that cannot serialize are keyed by identity (two different predicates never share a slot),
 * expressions are keyed by their serialized tree, `withSourceData` arrays by identity, filter
 * groups apply on the predicate path, and the exclusion-graph short-circuit is consulted only
 * for a plain `withRule` question.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { FilterRule } from '../rules/FilterRule.js';

import { and } from '../composition/factories.js';
import { PredicateRule } from '../rules/PredicateRule.js';
import { ValueRule } from '../rules/ValueRule.js';
import { InternalStore } from '../store/InternalStore.js';
import { BitmapIndex } from './BitmapIndex.js';
import { ExclusionGraph } from './ExclusionGraph.js';
import { initializeBitmapAcceleration } from './roaringInit.js';
import { SimulationCache } from './SimulationCache.js';

interface Item {
	readonly color: string;
	readonly size: number;
}

const ITEMS: readonly Item[] = [
	{ color: 'red', size: 1 },
	{ color: 'red', size: 2 },
	{ color: 'white', size: 3 },
];

beforeAll(async () => {
	await initializeBitmapAcceleration();
});

describe('SimulationCache keys', () => {
	it('keeps two different non-serializable hypothetical rules apart', () => {
		const cache = new SimulationCache(new InternalStore<Item>(ITEMS));
		const small = new PredicateRule<Item>(undefined, (item) => item.size < 2);
		const large = new PredicateRule<Item>(undefined, (item) => item.size > 1);

		expect(cache.simulate({ withRule: ['p', small]}).resultCount).toBe(1);
		expect(cache.simulate({ withRule: ['p', large]}).resultCount).toBe(2);
		// The same instance hits its own slot.
		expect(cache.simulate({ withRule: ['p', small]}).cacheKey).toBe(cache.simulate({ withRule: ['p', small]}).cacheKey);
	});

	it('keys expressions by their serialized tree and non-serializable ones by identity', () => {
		const cache = new SimulationCache(new InternalStore<Item>(ITEMS));
		const red = and(new ValueRule('color', 'red'));
		const white = and(new ValueRule('color', 'white'));

		expect(cache.simulate({ withExpression: red }).resultCount).toBe(2);
		expect(cache.simulate({ withExpression: white }).resultCount).toBe(1);
		expect(cache.simulate({ withExpression: and(new ValueRule('color', 'red')) }).cacheKey)
			.toBe(cache.simulate({ withExpression: red }).cacheKey);
		const opaque = and(new PredicateRule<Item>(undefined, () => false));

		expect(cache.simulate({ withExpression: opaque }).resultCount).toBe(0);
	});

	it('keys withSourceData by array identity', () => {
		const cache = new SimulationCache(new InternalStore<Item>(ITEMS));
		const reds = ITEMS.filter((item) => item.color === 'red');
		const whites = [...ITEMS.filter((item) => item.color === 'white'), ITEMS[0] as Item];
		const rule = new ValueRule('color', 'white');

		expect(cache.simulate({ withRule: ['c', rule], withSourceData: reds }).resultCount).toBe(0);
		expect(cache.simulate({ withRule: ['c', rule], withSourceData: whites }).resultCount).toBe(1);
	});

	it('applies filter groups on the predicate path', () => {
		const store = new InternalStore<Item>(ITEMS);

		store.rules.value = new Map<string, FilterRule>([['small', new ValueRule('size', 1)]]);
		store.groups.value = [{ composition: 'or', filterIds: ['small', 'white'], id: 'g' }];

		expect(new SimulationCache(store).simulate({ withRule: ['white', new ValueRule('color', 'white')]}).resultCount).toBe(2);
	});
});

describe('SimulationCache exclusion short-circuit', () => {
	it('is consulted only for a plain withRule question', () => {
		const store = new InternalStore<Item>(ITEMS);
		const bitmapIndex = new BitmapIndex(store, 'bitmap');
		const exclusionGraph = new ExclusionGraph(store, bitmapIndex);
		const cache = new SimulationCache(store, { bitmapIndex, enabled: false, exclusionGraph });

		store.rules.value = new Map<string, FilterRule>([['red', new ValueRule('color', 'red')]]);
		exclusionGraph.precompute();
		const spy = vi.spyOn(exclusionGraph, 'wouldExcludeAll');
		const white = new ValueRule('color', 'white');

		expect(cache.simulate({ withRule: ['white', white]}).wouldBeEmpty).toBe(true);
		expect(spy).toHaveBeenCalledTimes(1);

		// Dropping the red rule while adding white is not a pairwise question — evaluated instead.
		expect(cache.simulate({ ignoreRules: ['red'], withRule: ['white', white]}).resultCount).toBe(1);
		expect(cache.simulate({ withoutRule: 'red', withRule: ['white', white]}).resultCount).toBe(1);
		expect(cache.simulate({ withExpression: null, withRule: ['white', white]}).resultCount).toBe(0);
		expect(cache.simulate({ withRule: ['white', white], withSourceData: ITEMS }).resultCount).toBe(0);
		expect(spy).toHaveBeenCalledTimes(1);

		store.expression.value = and(new ValueRule('size', 3));
		cache.simulate({ withRule: ['white', white]});
		expect(spy).toHaveBeenCalledTimes(1);
	});
});
