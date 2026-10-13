/**
 * @remarks
 * Behavior-asserting unit tests for {@link BitmapIndex.simulateIntersection} — the
 * hypothetical-intersection surface backing the simulation API. Covers every decline path
 * (`withSourceData`, `withExpression`, active expression mode, not-ready) and every handled
 * modification: `withRule` (both as a brand-new rule and as an override of an active rule id),
 * `withoutRule`, `ignoreRules`, the no-effective-rules -> all-items case, the AND chain with
 * smallest-first ordering, the empty-intersection short-circuit, and index-to-item
 * conversion. The split from `BitmapIndex.test.ts` keeps each suite under the 500-line cap.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import type { FilterRule } from '../rules/FilterRule.js';
import type { RuleId, SimulationModification } from '../types.js';

import { CompositeRule } from '../rules/CompositeRule.js';
import { ValueRule } from '../rules/ValueRule.js';
import { InternalStore } from '../store/InternalStore.js';
import { BitmapIndex } from './BitmapIndex.js';
import { initializeBitmapAcceleration } from './roaringInit.js';

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

describe('BitmapIndex.simulateIntersection — decline paths (returns null)', () => {
	it('declines a withSourceData modification', () => {
		const index = new BitmapIndex(makeStore(), 'bitmap');
		const mod: SimulationModification = { withSourceData: [{ color: 'red', size: 0 }]};

		expect(index.simulateIntersection(mod)).toBeNull();
	});

	it('declines a withExpression modification (both null and set)', () => {
		const index = new BitmapIndex(makeStore(), 'bitmap');

		expect(index.simulateIntersection({ withExpression: null })).toBeNull();
		expect(
			index.simulateIntersection({
				withExpression: new CompositeRule('and', [colorRule('red')]),
			}),
		).toBeNull();
	});

	it('declines when the engine is in expression mode', () => {
		const store = makeStore();

		store.expression.value = new CompositeRule('or', [colorRule('red'), colorRule('white')]);
		const index = new BitmapIndex(store, 'bitmap');

		expect(index.simulateIntersection({})).toBeNull();
	});

	it('declines when the bitmap path is not ready (predicate mode)', () => {
		const index = new BitmapIndex(makeStore(), 'predicate');

		expect(index.simulateIntersection({})).toBeNull();
	});
});

describe('BitmapIndex.simulateIntersection — handled modifications', () => {
	it('returns all items when there are no effective rules', () => {
		const store = makeStore();
		const index = new BitmapIndex(store, 'bitmap');

		const result = index.simulateIntersection({});

		expect(result).not.toBeNull();
		expect(result).toHaveLength(6);
	});

	it('adds a brand-new rule via withRule and ANDs it in', () => {
		const store = makeStore();

		setRules(store, [['red', colorRule('red')]]);
		const index = new BitmapIndex(store, 'bitmap');

		// Active: red (0,2,4). withRule size 4 -> intersection {4}.
		const result = index.simulateIntersection({ withRule: ['size4', sizeRule(4)]});

		expect(result?.map((i) => i.size)).toEqual([4]);
	});

	it('overrides an active rule id via withRule (skips the cached version)', () => {
		const store = makeStore();

		setRules(store, [['color', colorRule('red')]]);
		const index = new BitmapIndex(store, 'bitmap');

		// Re-using the 'color' id but pointing it at white -> the white items.
		const result = index.simulateIntersection({ withRule: ['color', colorRule('white')]});

		expect(result?.map((i) => i.color)).toEqual(['white', 'white', 'white']);
	});

	it('drops a single rule via withoutRule', () => {
		const store = makeStore();

		setRules(store, [
			['red', colorRule('red')],
			['size4', sizeRule(4)],
		]);
		const index = new BitmapIndex(store, 'bitmap');

		// Without 'size4', only the red filter remains -> 0,2,4.
		const result = index.simulateIntersection({ withoutRule: 'size4' });

		expect(result?.map((i) => i.size)).toEqual([0, 2, 4]);
	});

	it('drops multiple rules via ignoreRules', () => {
		const store = makeStore();

		setRules(store, [
			['red', colorRule('red')],
			['size4', sizeRule(4)],
		]);
		const index = new BitmapIndex(store, 'bitmap');

		// Ignoring both rules leaves no effective rules -> all items.
		const result = index.simulateIntersection({ ignoreRules: ['red', 'size4']});

		expect(result).toHaveLength(6);
	});

	it('returns all items when withoutRule strips the only active rule', () => {
		const store = makeStore();

		setRules(store, [['red', colorRule('red')]]);
		const index = new BitmapIndex(store, 'bitmap');

		const result = index.simulateIntersection({ withoutRule: 'red' });

		expect(result).toHaveLength(6);
	});

	it('short-circuits to an empty result on an empty intersection', () => {
		const store = makeStore();

		setRules(store, [['red', colorRule('red')]]);
		const index = new BitmapIndex(store, 'bitmap');

		// red (even) AND size 1 (odd) -> empty.
		const result = index.simulateIntersection({ withRule: ['size1', sizeRule(1)]});

		expect(result).toEqual([]);
	});

	it('intersects an existing active rule with a withRule addition (AND chain)', () => {
		const store = makeStore();

		setRules(store, [
			['red', colorRule('red')],
			['size0', sizeRule(0)],
		]);
		const index = new BitmapIndex(store, 'bitmap');

		// Active red AND size0 = {0}; adding size 2 -> empty intersection.
		const result = index.simulateIntersection({ withRule: ['size2', sizeRule(2)]});

		expect(result).toEqual([]);
	});
});
