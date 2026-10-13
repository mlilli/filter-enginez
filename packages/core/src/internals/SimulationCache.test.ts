/**
 * @remarks
 * Behavior-asserting unit tests for {@link SimulationCache} — LRU-memoized `engine.simulate()`.
 * Covers: the predicate fallback for every modification field (`withRule`, `withoutRule`,
 * `ignoreRules`, `withExpression` set/null, `withSourceData`, baseline expression mode, the
 * single-rule and multi-rule effective-expression branches, and the no-rules identity), the
 * bitmap fast path (attached + ready -> `simulateIntersection`), the exclusion-graph
 * short-circuit (`wouldBeEmpty: true` without evaluation), cache hit/miss + key folding
 * (active-rule fingerprint, source-data + working-set versions, ignore-order normalization,
 * non-serializable rule fallback), the `sampleSize` cap, LRU eviction at `maxEntries`,
 * `invalidate(action)`, `clear()`, the `attach*` post-construction wiring, and the
 * `enabled: false` bypass that recomputes every call without ever populating the cache.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { FilterRule } from '../rules/FilterRule.js';
import type { Action } from '../store/Action.js';
import type { RuleId, SimulationModification } from '../types.js';

import { CompositeRule } from '../rules/CompositeRule.js';
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

function colorRule(value: string): ValueRule {
	return new ValueRule('color', value);
}

function sizeRule(value: number): ValueRule {
	return new ValueRule('size', value);
}

function setRules(
	store: InternalStore<Item>,
	entries: readonly (readonly [RuleId, FilterRule])[],
): void {
	store.rules.value = new Map(entries);
}

/** Six items, even = red, odd = white, size = index. */
function makeStore(): InternalStore<Item> {
	const items: Item[] = [];

	for (let i = 0; i < 6; i++) {
		items.push({ color: i % 2 === 0 ? 'red' : 'white', size: i });
	}

	return new InternalStore<Item>(items);
}

beforeAll(async () => {
	await initializeBitmapAcceleration();
});

describe('SimulationCache — predicate path modifications', () => {
	it('honors a withRule added on top of active rules', () => {
		const store = makeStore();

		setRules(store, [['red', colorRule('red')]]);
		const cache = new SimulationCache(store);

		const result = cache.simulate({ withRule: ['size2', sizeRule(2)]});

		expect(result.resultCount).toBe(1);
		expect(result.sample.map((i) => i.size)).toEqual([2]);
		expect(result.wouldBeEmpty).toBe(false);
	});

	it('honors withoutRule', () => {
		const store = makeStore();

		setRules(store, [
			['red', colorRule('red')],
			['size4', sizeRule(4)],
		]);
		const cache = new SimulationCache(store);

		const result = cache.simulate({ withoutRule: 'size4' });

		expect(result.sample.map((i) => i.size)).toEqual([0, 2, 4]);
	});

	it('honors ignoreRules (no effective rules -> all items, multi-rule path)', () => {
		const store = makeStore();

		setRules(store, [
			['red', colorRule('red')],
			['size4', sizeRule(4)],
		]);
		const cache = new SimulationCache(store);

		const result = cache.simulate({ ignoreRules: ['red', 'size4']});

		expect(result.resultCount).toBe(6);
		expect(result.wouldBeEmpty).toBe(false);
	});

	it('uses the multi-rule AND composite when several rules remain effective', () => {
		const store = makeStore();

		setRules(store, [
			['red', colorRule('red')],
			['size4', sizeRule(4)],
		]);
		const cache = new SimulationCache(store);

		// Both rules remain -> CompositeRule('and') path; only size-4 red item matches.
		const result = cache.simulate({});

		expect(result.sample.map((i) => i.size)).toEqual([4]);
	});

	it('honors a withExpression composite', () => {
		const store = makeStore();
		const cache = new SimulationCache(store);

		const result = cache.simulate({
			withExpression: new CompositeRule('or', [sizeRule(0), sizeRule(2)]),
		});

		expect(result.sample.map((i) => i.size)).toEqual([0, 2]);
	});

	it('treats a null withExpression as "expression mode cleared" — the flat rules apply', () => {
		const store = makeStore();

		setRules(store, [['red', colorRule('red')]]);
		store.expression.value = new CompositeRule('or', [sizeRule(1)]);
		const cache = new SimulationCache(store);

		// The active expression (size 1) is set aside; the flat red rule filters instead.
		expect(cache.simulate({ withExpression: null }).resultCount).toBe(3);
		expect(cache.simulate({}).resultCount).toBe(1);
	});

	it('evaluates against withSourceData when provided', () => {
		const store = makeStore();

		setRules(store, [['red', colorRule('red')]]);
		const cache = new SimulationCache(store);

		const result = cache.simulate({
			withSourceData: [
				{ color: 'red', size: 100 },
				{ color: 'white', size: 101 },
			],
		});

		expect(result.sample.map((i) => (i).size)).toEqual([100]);
	});

	it('uses the baseline expression when one is set and no override is given', () => {
		const store = makeStore();

		store.expression.value = new CompositeRule('or', [sizeRule(0), sizeRule(1)]);
		const cache = new SimulationCache(store);

		const result = cache.simulate({ ignoreRules: []});

		expect(result.sample.map((i) => i.size)).toEqual([0, 1]);
	});

	it('reports wouldBeEmpty for an empty projection', () => {
		const store = makeStore();

		setRules(store, [['red', colorRule('red')]]);
		const cache = new SimulationCache(store);

		const result = cache.simulate({ withRule: ['size1', sizeRule(1)]});

		expect(result.resultCount).toBe(0);
		expect(result.wouldBeEmpty).toBe(true);
		expect(result.sample).toEqual([]);
	});
});

describe('SimulationCache — bitmap fast path + exclusion short-circuit', () => {
	it('uses the bitmap fast path when attached + ready and the index can answer', () => {
		const store = makeStore();

		setRules(store, [['red', colorRule('red')]]);
		const bitmapIndex = new BitmapIndex(store, 'bitmap');
		const spy = vi.spyOn(bitmapIndex, 'simulateIntersection');
		const cache = new SimulationCache(store, { bitmapIndex });

		const result = cache.simulate({ withRule: ['size4', sizeRule(4)]});

		expect(spy).toHaveBeenCalledTimes(1);
		expect(result.resultCount).toBe(1);
		expect(result.sample.map((i) => i.size)).toEqual([4]);
	});

	it('falls back to predicate when the attached bitmap index declines', () => {
		const store = makeStore();

		setRules(store, [['red', colorRule('red')]]);
		const bitmapIndex = new BitmapIndex(store, 'bitmap');
		const cache = new SimulationCache(store, { bitmapIndex });

		// withSourceData makes simulateIntersection decline (null) -> predicate path.
		const result = cache.simulate({
			withSourceData: [
				{ color: 'red', size: 0 },
				{ color: 'white', size: 1 },
			],
		});

		expect(result.sample.map((i) => (i).size)).toEqual([0]);
	});

	it('short-circuits to wouldBeEmpty via the exclusion graph', () => {
		const store = makeStore();
		const white = colorRule('white');

		setRules(store, [['red', colorRule('red')]]);
		const bitmapIndex = new BitmapIndex(store, 'bitmap');
		const exclusionGraph = new ExclusionGraph(store, bitmapIndex);

		exclusionGraph.precompute();
		const cache = new SimulationCache(store, { bitmapIndex, exclusionGraph });
		const simSpy = vi.spyOn(bitmapIndex, 'simulateIntersection');

		// white {2} is disjoint from active red {0,2,4}? No — share index nothing. red is 0,2,4;
		// white is 1,3,5 -> disjoint -> would exclude all.
		const result = cache.simulate({ withRule: ['white', white]});

		expect(result.wouldBeEmpty).toBe(true);
		expect(result.resultCount).toBe(0);
		// The short-circuit returns before reaching the bitmap intersection path.
		expect(simSpy).not.toHaveBeenCalled();
	});
});

describe('SimulationCache — memoization + cache key', () => {
	it('computes once then serves the same cached instance for an identical modification', () => {
		const store = makeStore();

		setRules(store, [['red', colorRule('red')]]);
		const cache = new SimulationCache(store);
		const mod: SimulationModification = { withRule: ['size4', sizeRule(4)]};

		const first = cache.simulate(mod);
		const second = cache.simulate(mod);

		expect(second).toBe(first);
		expect(cache.size).toBe(1);
	});

	it('normalizes ignoreRules ordering into the same cache key', () => {
		const store = makeStore();

		setRules(store, [
			['red', colorRule('red')],
			['size4', sizeRule(4)],
		]);
		const cache = new SimulationCache(store);

		const a = cache.simulate({ ignoreRules: ['red', 'size4']});
		const b = cache.simulate({ ignoreRules: ['size4', 'red']});

		expect(b).toBe(a);
		expect(cache.size).toBe(1);
	});

	it('keys distinct modifications separately', () => {
		const store = makeStore();

		setRules(store, [['red', colorRule('red')]]);
		const cache = new SimulationCache(store);

		cache.simulate({ withoutRule: 'red' });
		cache.simulate({ withSourceData: [{ color: 'red', size: 0 }]});
		cache.simulate({ withExpression: null });
		cache.simulate({ withRule: ['size2', sizeRule(2)]});
		cache.simulate({});

		expect(cache.size).toBe(5);
	});

	it('changes the key when the source-data version advances', () => {
		const store = makeStore();

		setRules(store, [['red', colorRule('red')]]);
		const cache = new SimulationCache(store);
		const mod: SimulationModification = { withoutRule: 'red' };

		cache.simulate(mod);
		expect(cache.size).toBe(1);

		store.sourceData.value = [{ color: 'red', size: 0 }];
		store.sourceDataVersion.value = store.sourceDataVersion.value + 1;
		store.workingSet.value = store.sourceData.value;
		cache.simulate(mod);

		expect(cache.size).toBe(2);
	});

	it('folds a non-serializable rule into the key via the catch fallback', () => {
		const store = makeStore();

		// PredicateRule carries a function -> serialize() throws, exercising both try/catch
		// fallbacks in the fingerprint paths (active rule set + withRule modification).
		const predicate = new PredicateRule<Item>('size', (item) => item.size > 3);

		setRules(store, [['pred', predicate]]);
		const cache = new SimulationCache(store);

		const result = cache.simulate({
			withRule: ['pred2', new PredicateRule<Item>('size', (item) => item.size < 2)],
		});

		// size>3 AND size<2 -> empty.
		expect(result.resultCount).toBe(0);
		expect(cache.size).toBe(1);
	});
});

describe('SimulationCache — lifecycle', () => {
	it('respects the configured sampleSize cap', () => {
		const store = makeStore();
		const cache = new SimulationCache(store, { sampleSize: 2 });

		const result = cache.simulate({});

		expect(result.resultCount).toBe(6);
		expect(result.sample).toHaveLength(2);
	});

	it('evicts least-recently-used entries beyond maxEntries', () => {
		const store = makeStore();
		const cache = new SimulationCache(store, { maxEntries: 2 });

		cache.simulate({ withoutRule: 'a' });
		cache.simulate({ withoutRule: 'b' });
		cache.simulate({ withoutRule: 'c' });

		expect(cache.size).toBe(2);
	});

	it('invalidate() clears the cache for every cache-busting action type', () => {
		const store = makeStore();
		const cache = new SimulationCache(store);

		// Every action type the invalidate() switch lists must blow the whole cache.
		const bustingTypes = [
			'EXPRESSION_SET',
			'GROUP_ADDED',
			'GROUP_REMOVED',
			'RESET',
			'RULE_ADDED',
			'RULE_CHANGED',
			'RULE_REMOVED',
			'RULES_CLEARED',
			'SOURCE_DATA_SET',
			'WORKING_SET_RESET',
			'WORKING_SET_SET',
		] as const;

		for (const type of bustingTypes) {
			cache.simulate({ withoutRule: 'red' });
			expect(cache.size).toBe(1);

			cache.invalidate({ type } as unknown as Action);

			expect(cache.size).toBe(0);
		}
	});

	it('invalidate() leaves the cache intact for an unrelated action type', () => {
		const store = makeStore();
		const cache = new SimulationCache(store);

		cache.simulate({ withoutRule: 'red' });
		expect(cache.size).toBe(1);

		// A type not in the switch falls through without clearing (default no-op arm).
		cache.invalidate({ type: 'SOME_OTHER_ACTION' } as unknown as Action);

		expect(cache.size).toBe(1);
	});

	it('clear() empties the cache', () => {
		const store = makeStore();
		const cache = new SimulationCache(store);

		cache.simulate({ withoutRule: 'red' });
		expect(cache.size).toBe(1);

		cache.clear();

		expect(cache.size).toBe(0);
	});

	it('attaches a bitmap index + exclusion graph post-construction', () => {
		const store = makeStore();

		setRules(store, [['red', colorRule('red')]]);
		const bitmapIndex = new BitmapIndex(store, 'bitmap');
		const exclusionGraph = new ExclusionGraph(store, bitmapIndex);
		const cache = new SimulationCache(store);

		cache.attachBitmapIndex(bitmapIndex);
		cache.attachExclusionGraph(exclusionGraph);
		const spy = vi.spyOn(bitmapIndex, 'simulateIntersection');

		cache.simulate({ withRule: ['size4', sizeRule(4)]});

		expect(spy).toHaveBeenCalledTimes(1);
	});
});

describe('SimulationCache — disabled memoization (enabled: false)', () => {
	it('recomputes every call and never populates the cache', () => {
		const store = makeStore();

		setRules(store, [['red', colorRule('red')]]);
		const cache = new SimulationCache(store, { enabled: false });
		const mod: SimulationModification = { withRule: ['size4', sizeRule(4)]};

		const first = cache.simulate(mod);
		const second = cache.simulate(mod);

		// Same correct answer both times...
		expect(first.resultCount).toBe(1);
		expect(second.sample.map((i) => i.size)).toEqual([4]);
		// ...but recomputed — distinct instances, and the cache stays empty.
		expect(second).not.toBe(first);
		expect(cache.size).toBe(0);
	});

	it('still short-circuits via the exclusion graph without caching the result', () => {
		const store = makeStore();
		const white = colorRule('white');

		setRules(store, [['red', colorRule('red')]]);
		const bitmapIndex = new BitmapIndex(store, 'bitmap');
		const exclusionGraph = new ExclusionGraph(store, bitmapIndex);

		exclusionGraph.precompute();
		const cache = new SimulationCache(store, { bitmapIndex, enabled: false, exclusionGraph });

		// red {0,2,4} and white {1,3,5} are disjoint -> wouldBeEmpty, but the disabled cache
		// must not retain it.
		const result = cache.simulate({ withRule: ['white', white]});

		expect(result.wouldBeEmpty).toBe(true);
		expect(cache.size).toBe(0);
	});
});
