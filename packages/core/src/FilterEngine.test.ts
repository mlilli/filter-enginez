/**
 * @remarks
 * Behavior tests for the `FilterEngine` facade — construction, source data + working set, rule
 * mutation (flat-map mode), expression mode, filter groups, results projection, the
 * filtered-except-self field extraction, and the bundled `applyFiltersAndQuery` smoke path.
 * Lifecycle (subscribe / destroy / JSON config / simulate / similarity / snapshot) and the
 * `_invalidateBitmapForAction` action-type sweep live in `FilterEngine.lifecycle.test.ts` to
 * keep both files under the 500-line cap.
 *
 * Each public mutator routes through the private `_dispatchAndEmit` which dispatches to the
 * store, invalidates the bitmap + simulation caches, records into devtools, and emits a change
 * event — so exercising the public surface drives those private helpers too.
 */

import { describe, expect, it } from 'vitest';

import type { FilterGroup } from './composition/FilterGroup.js';

import { and, or } from './composition/factories.js';
import { FilterEngine } from './FilterEngine.js';
import { initializeBitmapAcceleration } from './internals/index.js';
import { inSet, range, value } from './rules/factories.js';
import { ValueRule } from './rules/ValueRule.js';

interface Item {
	readonly color: string;
	readonly price: number;
}

const SAMPLE: readonly Item[] = [
	{ color: 'red', price: 10 },
	{ color: 'red', price: 50 },
	{ color: 'blue', price: 30 },
	{ color: 'green', price: 70 },
];

describe('FilterEngine — construction', () => {
	it('defaults to an empty source data set and no rules', () => {
		const engine = new FilterEngine<Item>();

		expect(engine.getSourceData()).toEqual([]);
		expect(engine.getRules().size).toBe(0);
		expect(engine.getExpression()).toBeNull();
	});

	it('accepts initial source data', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });

		expect(engine.getSourceData()).toBe(SAMPLE);
		// No rules → results mirror the working set (full source).
		expect(engine.getResultCount()).toBe(4);
	});

	it('honors acceleration.bitmap and exposes the bitmap index', () => {
		const engine = new FilterEngine<Item>({ acceleration: { bitmap: 'on' }, sourceData: SAMPLE });

		expect(engine.bitmapIndex).toBeDefined();
	});

	it('exposes the composed sub-objects', () => {
		const engine = new FilterEngine<Item>();

		expect(engine.store).toBeDefined();
		expect(engine.dispatcher).toBeDefined();
		expect(engine.devtools).toBeDefined();
		expect(engine.simulationCache).toBeDefined();
		expect(engine.exclusionGraph).toBeDefined();
		// `similarity` and `suggestions` are NOT here by design — both moved behind opt-in
		// subpaths (`core/similarity`, `core/suggestions`) so unconditional construction stopped
		// making them unshakeable. Asserted as absent in `index.test.ts`.
		expect('suggestions' in engine).toBe(false);
		expect('similarity' in engine).toBe(false);
	});
});

describe('FilterEngine — source data + working set', () => {
	it('setSourceData replaces the source and emits a sourceData event', () => {
		const engine = new FilterEngine<Item>();
		const events: string[] = [];

		engine.subscribe((e) => events.push(e.type));
		engine.setSourceData(SAMPLE);

		expect(engine.getSourceData()).toBe(SAMPLE);
		expect(events).toContain('sourceData');
	});

	it('setWorkingSet narrows the filtered population and emits a workingSet event', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });
		const events: string[] = [];

		engine.subscribe((e) => events.push(e.type));
		engine.setWorkingSet(SAMPLE.slice(0, 2));

		expect(engine.getResultCount()).toBe(2);
		expect(events).toContain('workingSet');
	});

	it('resetWorkingSet restores the working set to mirror the full source', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });

		engine.setWorkingSet(SAMPLE.slice(0, 1));
		expect(engine.getResultCount()).toBe(1);

		const events: string[] = [];

		engine.subscribe((e) => events.push(e.type));
		engine.resetWorkingSet();

		expect(engine.getResultCount()).toBe(4);
		expect(events).toContain('workingSet');
	});
});

describe('FilterEngine — rules (flat-map mode)', () => {
	it('addRule registers a new rule and emits rule:added', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });
		const events: string[] = [];

		engine.subscribe((e) => events.push(e.type));
		engine.addRule('color', value('color', 'red'));

		expect(engine.getRule('color')).toBeInstanceOf(ValueRule);
		expect(engine.getResultCount()).toBe(2);
		expect(events).toContain('rule:added');
	});

	it('addRule with an existing id replaces it and emits rule:changed', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });

		engine.addRule('color', value('color', 'red'));

		const events: string[] = [];

		engine.subscribe((e) => events.push(e.type));
		engine.addRule('color', value('color', 'blue'));

		expect(engine.getResultCount()).toBe(1);
		expect(events).toContain('rule:changed');
	});

	it('removeRule deletes a registered rule and emits rule:removed', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });

		engine.addRule('color', value('color', 'red'));

		const events: string[] = [];

		engine.subscribe((e) => events.push(e.type));
		engine.removeRule('color');

		expect(engine.getRule('color')).toBeUndefined();
		expect(engine.getResultCount()).toBe(4);
		expect(events).toContain('rule:removed');
	});

	it('removeRule is a no-op (no event) when the id is absent', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });
		const events: string[] = [];

		engine.subscribe((e) => events.push(e.type));
		engine.removeRule('nope');

		expect(events).toHaveLength(0);
	});

	it('getRules returns the full rule map and getActiveRuleIds the keys', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });

		engine.addRule('color', value('color', 'red'));
		engine.addRule('price', range('price', { max: 40, min: 0 }));

		expect(engine.getRules().size).toBe(2);
		expect([...engine.getActiveRuleIds()]).toEqual(['color', 'price']);
	});

	it('clearRules drops all rules, groups, and expression', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });

		engine.addRule('color', value('color', 'red'));
		engine.addGroup({ composition: 'or', filterIds: ['color'], id: 'g1' });

		const events: string[] = [];

		engine.subscribe((e) => events.push(e.type));
		engine.clearRules();

		expect(engine.getRules().size).toBe(0);
		expect(engine.getGroups()).toHaveLength(0);
		expect(events).toContain('reset');
	});
});

describe('FilterEngine — expression mode', () => {
	it('setExpression switches to expression mode and getExpression reflects it', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });
		const expr = and(value('color', 'red'), range('price', { max: 40, min: 0 }));
		const events: string[] = [];

		engine.subscribe((e) => events.push(e.type));
		engine.setExpression(expr);

		expect(engine.getExpression()).toBe(expr);
		// red AND price<=40 → only the first item.
		expect(engine.getResultCount()).toBe(1);
		expect(events).toContain('expression');
	});

	it('setExpression(null) returns to flat-map mode', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });

		engine.setExpression(and(value('color', 'red')));
		expect(engine.getResultCount()).toBe(2);

		engine.setExpression(null);
		expect(engine.getExpression()).toBeNull();
		expect(engine.getResultCount()).toBe(4);
	});
});

describe('FilterEngine — filter groups', () => {
	const group: FilterGroup = { composition: 'or', filterIds: ['color'], id: 'g1' };

	it('addGroup registers a group and emits reset', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });
		const events: string[] = [];

		engine.subscribe((e) => events.push(e.type));
		engine.addGroup(group);

		expect(engine.getGroups()).toHaveLength(1);
		expect(events).toContain('reset');
	});

	it('removeGroup deletes a group by id', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });

		engine.addGroup(group);
		engine.removeGroup('g1');

		expect(engine.getGroups()).toHaveLength(0);
	});
});

describe('FilterEngine — results projection', () => {
	it('holds results[i] === workingSet[getResultIndices()[i]]', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });

		engine.addRule('color', value('color', 'red'));

		const results = engine.getResults();
		const indices = engine.getResultIndices();
		const workingSet = engine.getSourceData();

		expect(indices).toBeInstanceOf(Uint32Array);
		expect(results).toHaveLength(indices.length);
		for (let i = 0; i < indices.length; i++) {
			expect(results[i]).toBe(workingSet[indices[i] as number]);
		}
	});

	it('getResultCount matches getResults().length', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });

		engine.addRule('price', range('price', { max: 40, min: 0 }));
		expect(engine.getResultCount()).toBe(engine.getResults().length);
	});

	it('computeResults() matches getResultIndices() membership via the bitmap path', async () => {
		await initializeBitmapAcceleration();

		const engine = new FilterEngine<Item>({ acceleration: { bitmap: 'on' }, sourceData: SAMPLE });

		engine.addRule('color', value('color', 'red'));

		expect([...engine.computeResults()]).toEqual([...engine.getResultIndices()]);
	});

	it('computeResults() returns every index when no rules are active', async () => {
		await initializeBitmapAcceleration();

		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });

		expect([...engine.computeResults()]).toEqual(SAMPLE.map((_item, index) => index));
	});
});

describe('FilterEngine — getFilteredFieldValuesExcept', () => {
	it('fast path: no active rules returns every finite field value', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });
		const values = engine.getFilteredFieldValuesExcept('absent', 'price');

		expect([...values]).toEqual([10, 50, 30, 70]);
	});

	it('fast path skips non-number / non-finite field values', () => {
		const messy = [
			{ color: 'red', price: 10 },
			{ color: 'red', price: Number.POSITIVE_INFINITY },
			{ color: 'red', price: 'nope' },
		] as readonly Item[];
		const engine = new FilterEngine<Item>({ sourceData: messy });

		expect([...engine.getFilteredFieldValuesExcept('absent', 'price')]).toEqual([10]);
	});

	it('slow path excludes the named rule and early-exits on the first failing rule', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });

		engine.addRule('color', value('color', 'red'));
		engine.addRule('price', range('price', { max: 20, min: 0 }));

		// Exclude the price rule: only the color rule constrains → both red prices returned.
		expect([...engine.getFilteredFieldValuesExcept('price', 'price')]).toEqual([10, 50]);
	});

	it('slow path skips surviving items whose field value is non-finite', () => {
		const messy = [
			{ color: 'red', price: 10 },
			{ color: 'red', price: Number.NaN },
			{ color: 'blue', price: 20 },
		] as readonly Item[];
		const engine = new FilterEngine<Item>({ sourceData: messy });

		engine.addRule('color', value('color', 'red'));
		// Color rule active (not excluded); the NaN-priced red survives the rule but is skipped.
		expect([...engine.getFilteredFieldValuesExcept('other', 'price')]).toEqual([10]);
	});
});

describe('FilterEngine — applyFiltersAndQuery', () => {
	it('delegates to runFilterBundleQuery with a field + chip group', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });

		engine.addRule('color', value('color', 'red'));

		const bundle = engine.applyFiltersAndQuery({
			chipGroups: [{ candidates: ['red', 'blue'], field: 'color', kind: 'inSet', ruleId: 'color' }],
			fields: [{ fieldKey: 'price', ruleId: 'price' }],
		});

		expect(bundle.resultCount).toBe(2);
		expect(bundle.fields).toHaveLength(1);
		expect(bundle.chipGroups[0]?.candidates).toHaveLength(2);
	});

	it('defaults to an empty query (results only)', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });
		const bundle = engine.applyFiltersAndQuery();

		expect(bundle.resultCount).toBe(4);
		expect(bundle.fields).toEqual([]);
		expect(bundle.chipGroups).toEqual([]);
	});

	it('honors an explicit expression for results, and returns empty facets', () => {
		// The regression this guards: `runFilterBundleQuery` evaluates the FLAT rule map, which is not the
		// filter while an expression drives the engine. An OR of two colors (red ∪ blue = 3) is a set no
		// flat-rule AND could ever produce, so a stale flat-path would report a different count.
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });

		engine.setExpression(or(value('color', 'red'), value('color', 'blue')));

		const bundle = engine.applyFiltersAndQuery({
			chipGroups: [{ candidates: ['red', 'blue'], field: 'color', kind: 'inSet', ruleId: 'color' }],
			fields: [{ fieldKey: 'price', ruleId: 'price' }],
		});

		expect(bundle.resultCount).toBe(3);
		// Facets are a per-flat-facet projection — not applicable while an expression composes the filter.
		expect(bundle.chipGroups).toEqual([]);
		expect(bundle.fields).toEqual([]);
	});

	it('in expression mode, resultIndices exactly equal getResultIndices()', () => {
		// The two must never disagree — `applyFiltersAndQuery` returns the engine's own results signal.
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });

		engine.setExpression(or(value('color', 'red'), value('color', 'green')));

		const bundle = engine.applyFiltersAndQuery();

		expect([...bundle.resultIndices]).toEqual([...engine.getResultIndices()]);
		expect(bundle.resultCount).toBe(engine.getResultIndices().length);
	});

	it('returns a COPY of the expression-mode result indices (mutating them cannot corrupt the engine)', () => {
		// `resultIndices` is a transferable `Uint32Array` the worker bridge may postMessage-transfer
		// (neuter). Handing out the store's memoized array would corrupt every later results read.
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });

		engine.setExpression(and(value('color', 'red')));

		const bundle = engine.applyFiltersAndQuery();
		const before = engine.getResultIndices()[0];

		bundle.resultIndices[0] = 987_654;

		expect(engine.getResultIndices()[0]).toBe(before);
	});
});

describe('FilterEngine — inSet rule integration', () => {
	it('filters via an inSet rule built from the factory', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });

		engine.addRule('colors', inSet('color', ['red', 'blue']));
		expect(engine.getResultCount()).toBe(3);
	});
});
