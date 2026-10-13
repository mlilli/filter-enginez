/**
 * @remarks
 * Engine-level tests that the acceleration caches never disagree with the store: results served
 * from the bitmap path equal the predicate evaluator's; `computeResults()` falls back when the
 * bitmap path declines; a time-travel restore or replay drops stale bitmaps and simulation
 * results; signal effects observe a consistent post-action state; `destroy()` releases the
 * caches; `precomputeExclusions()` warms the graph; `devtools.enabled: false` captures no
 * snapshots; and the Redux DevTools extension receives the initial state before the config's
 * actions.
 */

import { effect } from '@preact/signals-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { and } from './composition/factories.js';
import { FilterEngine } from './FilterEngine.js';
import { initializeBitmapAcceleration } from './internals/roaringInit.js';
import { range, value } from './rules/factories.js';

interface Wine {
	readonly color: string;
	readonly price: number;
}

/** 600 wines — above the 500-item auto threshold, so `bitmap: 'auto'` engages. */
const WINES: readonly Wine[] = Array.from({ length: 600 }, (_unused, i) => ({
	color: ['red', 'white', 'rose'][i % 3] as string,
	price: i % 100,
}));

beforeAll(async () => {
	await initializeBitmapAcceleration();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('FilterEngine bitmap-backed results', () => {
	it('serves getResults from the bitmap path with the predicate answer', () => {
		const accelerated = new FilterEngine<Wine>({ sourceData: WINES });
		const predicate = new FilterEngine<Wine>({ acceleration: { bitmap: 'off' }, sourceData: WINES });

		for (const engine of [accelerated, predicate]) {
			engine.addRule('red', value('color', 'red'));
			engine.addRule('cheap', range('price', { max: 30, min: 0 }));
		}

		expect(accelerated.bitmapIndex.tryComputeResults()).not.toBeNull();
		expect([...accelerated.getResultIndices()]).toEqual([...predicate.getResultIndices()]);
		expect(accelerated.getResults()).toEqual(predicate.getResults());
		expect(accelerated.bitmapIndex.cachedBitmapCount).toBe(2);
	});

	it('falls back from computeResults to the predicate indices when the bitmap path declines', () => {
		const engine = new FilterEngine<Wine>({ sourceData: WINES });

		engine.addRule('red', value('color', 'red'));
		engine.setWorkingSet(WINES.slice(0, 6));

		expect([...engine.computeResults()]).toEqual([0, 3]);
		expect(engine.computeResults()).not.toBe(engine.getResultIndices());

		engine.setExpression(and(value('color', 'white')));
		expect([...engine.computeResults()]).toEqual([1, 4]);
	});
});

describe('FilterEngine cache coherence', () => {
	it('drops stale bitmaps when undo restores a different rule under the same id', () => {
		const engine = new FilterEngine<Wine>({ sourceData: WINES });

		engine.addRule('color', value('color', 'red'));
		const redCount = engine.getResultCount();

		engine.addRule('color', value('color', 'white'));
		expect(engine.simulate({}).resultCount).toBe(200);
		engine.devtools.undo();

		expect(engine.getResultCount()).toBe(redCount);
		expect(engine.computeResults()).toHaveLength(redCount);
		expect(engine.simulate({}).resultCount).toBe(redCount);
		expect(engine.getResults().every((wine) => wine.color === 'red')).toBe(true);
	});

	it('re-reads state and emits reset after a replay', () => {
		const engine = new FilterEngine<Wine>({ sourceData: WINES });
		const events: string[] = [];

		engine.addRule('color', value('color', 'red'));
		engine.addRule('cheap', range('price', { max: 9, min: 0 }));
		engine.devtools.jumpTo(-1);
		engine.subscribe((event) => events.push(event.type));
		engine.devtools.replay(0);

		expect(events).toEqual(['reset']);
		expect(engine.getResults().every((wine) => wine.color === 'red' && wine.price <= 9)).toBe(true);
	});

	it('lets a signal effect read results that match the state it was notified about', () => {
		const engine = new FilterEngine<Wine>({ sourceData: WINES });
		const seen: (string | undefined)[] = [];

		engine.addRule('color', value('color', 'red'));
		const dispose = effect(() => {
			seen.push(engine.store.results.value[1]?.color);
		});

		// Replaces the rule under the same id: the effect must not see the red rule's bitmap.
		engine.addRule('color', value('color', 'rose'));
		engine.reset();
		dispose();

		expect(seen).toEqual(['red', 'rose', 'white']);
		expect(engine.getResults().length).toBe(600);
	});

	it('releases the caches on destroy', async () => {
		const engine = new FilterEngine<Wine>({ sourceData: WINES });

		engine.addRule('color', value('color', 'red'));
		engine.simulate({});
		engine.precomputeExclusions();
		expect(engine.bitmapIndex.cachedBitmapCount).toBe(1);

		await engine.destroy();

		expect(engine.bitmapIndex.cachedBitmapCount).toBe(0);
		expect(engine.simulationCache.size).toBe(0);
	});

	it('warms the exclusion graph on precomputeExclusions', () => {
		const engine = new FilterEngine<Wine>({ sourceData: WINES });

		engine.addRule('red', value('color', 'red'));
		engine.addRule('white', value('color', 'white'));
		expect(engine.exclusionGraph.isReady).toBe(false);

		engine.precomputeExclusions();

		expect(engine.exclusionGraph.isReady).toBe(true);
		expect(engine.exclusionGraph.areExclusive('red', 'white')).toBe(true);
	});

	it('re-warms an eager exclusion graph after a time-travel restore', () => {
		const engine = new FilterEngine<Wine>({ acceleration: { exclusionGraph: 'eager' }, sourceData: WINES });

		engine.addRule('red', value('color', 'red'));
		engine.addRule('white', value('color', 'white'));
		engine.devtools.undo();

		expect(engine.exclusionGraph.isReady).toBe(true);
	});
});

describe('FilterEngine devtools wiring', () => {
	it('records nothing when devtools are disabled', () => {
		const engine = new FilterEngine<Wine>({ devtools: { enabled: false }, sourceData: WINES });
		const record = vi.spyOn(engine.devtools, 'recordAction');

		engine.addRule('red', value('color', 'red'));

		expect(record).not.toHaveBeenCalled();
		expect(engine.devtools.actionLog.size).toBe(0);
		expect(engine.getResultCount()).toBe(200);
	});

	it('sends the initial state to the extension before the config actions', async () => {
		const calls: string[] = [];
		const connection = {
			init: vi.fn(() => calls.push('init')),
			send: vi.fn((action: { type: string }) => calls.push(action.type)),
			subscribe: vi.fn(),
		};

		vi.stubGlobal('__REDUX_DEVTOOLS_EXTENSION__', { connect: vi.fn(() => connection) });
		const engine = new FilterEngine<Wine>({
			config: { rules: [{ id: 'red', rule: { config: 'red', field: 'color', type: 'ValueRule' }}], version: 1 },
			sourceData: WINES,
		});

		await engine.devtools.ready;

		expect(calls[0]).toBe('init');
		expect(calls).toContain('RULE_ADDED');
		expect(connection.subscribe).toHaveBeenCalledTimes(1);
	});
});
