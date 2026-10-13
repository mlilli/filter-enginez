/**
 * @remarks
 * Engine-level tests for filter groups: `addGroup` defaults `composition` to `'or'`, groups change
 * `getResults()` (OR within, AND between), `removeGroup` restores plain AND, and every flat-map
 * path agrees — `simulate()`, `getFilteredFieldValuesExcept()`, and `applyFiltersAndQuery()`,
 * which reports results without facets while a disjunctive group is active. Run with bitmaps both
 * engaged and off, since the bitmap paths must defer to the evaluator for a disjunction.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { FilterEngine } from './FilterEngine.js';
import { initializeBitmapAcceleration } from './internals/roaringInit.js';
import { range, value } from './rules/factories.js';

interface Wine {
	readonly color: string;
	readonly price: number;
}

const WINES: readonly Wine[] = [
	{ color: 'red', price: 10 },
	{ color: 'white', price: 20 },
	{ color: 'rose', price: 30 },
	{ color: 'red', price: 40 },
];

beforeAll(async () => {
	await initializeBitmapAcceleration();
});

describe.each(['on', 'off'] as const)('FilterEngine filter groups (bitmap %s)', (bitmap) => {
	function engineWithColors(): FilterEngine<Wine> {
		const engine = new FilterEngine<Wine>({ acceleration: { bitmap }, sourceData: WINES });

		engine.addRule('red', value('color', 'red'));
		engine.addRule('white', value('color', 'white'));
		engine.addGroup({ filterIds: ['red', 'white'], id: 'colors' });

		return engine;
	}

	it('defaults composition to "or" and ORs the group\'s rules', () => {
		const engine = engineWithColors();

		expect(engine.getGroups()).toEqual([{ composition: 'or', filterIds: ['red', 'white'], id: 'colors' }]);
		expect(engine.getResults().map((wine) => wine.price)).toEqual([10, 20, 40]);
		expect([...engine.computeResults()]).toEqual([0, 1, 3]);
	});

	it('ANDs the group with standalone rules, and removeGroup restores plain AND', () => {
		const engine = engineWithColors();

		engine.addRule('cheap', range('price', { max: 25, min: 0 }));
		expect(engine.getResultCount()).toBe(2);

		engine.removeGroup('colors');
		expect(engine.getResultCount()).toBe(0);
	});

	it('simulates with the groups applied', () => {
		const engine = engineWithColors();

		expect(engine.simulate({ withRule: ['white', value('color', 'rose')]}).resultCount).toBe(3);
		expect(engine.simulate({ withoutRule: 'red' }).resultCount).toBe(1);
	});

	it('applies groups to the filtered-except-self projection', () => {
		const engine = engineWithColors();

		engine.addRule('cheap', range('price', { max: 25, min: 0 }));

		expect(engine.getFilteredFieldValuesExcept('cheap', 'price')).toEqual([10, 20, 40]);
		expect(engine.getFilteredFieldValuesExcept('white', 'price')).toEqual([10]);
	});

	it('reports results without facets from applyFiltersAndQuery while the group is disjunctive', () => {
		const engine = engineWithColors();
		const bundle = engine.applyFiltersAndQuery({ fields: [{ fieldKey: 'price', ruleId: 'cheap' }]});

		expect([...bundle.resultIndices]).toEqual([0, 1, 3]);
		expect(bundle.fields).toEqual([]);

		engine.removeRule('white');
		expect(engine.applyFiltersAndQuery({ fields: [{ fieldKey: 'price', ruleId: 'cheap' }]}).fields).toHaveLength(1);
	});

	it('keeps an "and" group equivalent to plain AND on every path', () => {
		const engine = new FilterEngine<Wine>({ acceleration: { bitmap }, sourceData: WINES });

		engine.addRule('red', value('color', 'red'));
		engine.addRule('cheap', range('price', { max: 25, min: 0 }));
		engine.addGroup({ composition: 'and', filterIds: ['red', 'cheap'], id: 'g' });

		expect(engine.getResultCount()).toBe(1);
		expect(engine.applyFiltersAndQuery().resultCount).toBe(1);
	});
});
