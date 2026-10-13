/**
 * Tests for `attachEngineToStore` — the orchestrator that subscribes an engine and dispatches the
 * mirror slice's `stateUpdated` on every change event.
 *
 * @remarks
 * The headline coverage target is the **event-derived last-change** logic: the orchestrator no
 * longer reads `engine.store` (which throws on worker-backed cores), instead tracking
 * `lastChangeRuleId` / `lastChangeTimestamp` from the `ChangeEvent` stream. Tests assert: the
 * initial full-snapshot, `syncOnAttach: false`, `includeResults` behavior, every `partialFor`
 * branch, that rule events populate last-change from `event.ruleId`, that `reset` clears it, and
 * that the returned unsubscribe detaches.
 *
 * A fake engine exposes only the sync surface the orchestrator touches (`getActiveRuleIds`,
 * `getResultCount`, `getResults`, `getExpression`, `subscribe`) plus an `emit` test hook. A real
 * slice supplies the `_includeResults` flag + `stateUpdated` action; the store is a `dispatch` spy.
 */

import type {
	ChangeEvent,
	ChangeListener,
	CompositeRule,
	FilterEngine,
	FilterRule,
	RuleId,
} from '@filter-enginez/core';

import { describe, expect, it, vi } from 'vitest';

import { attachEngineToStore } from './attachEngineToStore.js';
import { createFilterEngineSlice } from './createFilterEngineSlice.js';

interface FakeEngineInit {
	readonly activeRuleIds?: RuleId[];
	readonly expression?: CompositeRule | null;
	readonly resultCount?: number;
	readonly results?: unknown[];
}

function makeFakeEngine(init: FakeEngineInit = {}) {
	const state = {
		activeRuleIds: init.activeRuleIds ?? ([] as RuleId[]),
		expression: init.expression ?? (null as CompositeRule | null),
		resultCount: init.resultCount ?? 0,
		results: init.results ?? ([] as unknown[]),
	};
	const listeners = new Set<ChangeListener>();
	const engine = {
		getActiveRuleIds: () => state.activeRuleIds,
		getExpression: () => state.expression,
		getResultCount: () => state.resultCount,
		getResults: () => state.results,
		subscribe: (listener: ChangeListener) => {
			listeners.add(listener);

			return () => {
				listeners.delete(listener);
			};
		},
	} as unknown as FilterEngine<unknown>;
	const emit = (event: ChangeEvent): void => {
		for (const listener of [...listeners]) {
			listener(event);
		}
	};

	return { emit, engine, listenerCount: () => listeners.size, state };
}

function makeStore() {
	const dispatch = vi.fn((action: { payload: Record<string, unknown>; type: string; }) => action);
	const lastPayload = (): Record<string, unknown> => {
		const call = dispatch.mock.calls.at(-1);

		if (call === undefined) {
			throw new Error('no dispatch recorded');
		}

		return call[0].payload;
	};

	return { dispatch, lastPayload, store: { dispatch }};
}

type RuleEventType = 'rule:added' | 'rule:changed' | 'rule:removed';

const ruleEvent = (type: RuleEventType, ruleId: RuleId): ChangeEvent =>
	// `rule:changed` carries `previous`/`next` in the ChangeEvent union; `rule:added` /
	// `rule:removed` carry a single `rule`. The orchestrator only reads `ruleId` + `type`,
	// but the payload must satisfy the correct discriminated shape.
	type === 'rule:changed'
		? { next: {} as FilterRule, previous: {} as FilterRule, ruleId, type }
		: { rule: {} as FilterRule, ruleId, type };

const ruleAdded = (ruleId: RuleId): ChangeEvent => ruleEvent('rule:added', ruleId);

describe('attachEngineToStore', () => {
	it('dispatches a full snapshot on attach (syncOnAttach default true)', () => {
		const slice = createFilterEngineSlice('filters');
		const { engine } = makeFakeEngine({ activeRuleIds: ['price'], resultCount: 7, results: [{ id: 1 }]});
		const { dispatch, lastPayload, store } = makeStore();

		attachEngineToStore(store, engine, { slice });

		expect(dispatch).toHaveBeenCalledTimes(1);
		const payload = lastPayload();

		expect(payload).toMatchObject({
			activeRuleIds: ['price'],
			lastChangeRuleId: null,
			lastChangeTimestamp: null,
			mode: 'flat-map',
			resultCount: 7,
			version: 1,
		});
		// includeResults defaults true → results mirrored.
		expect(payload['results']).toEqual([{ id: 1 }]);
	});

	it('skips the initial dispatch when syncOnAttach is false', () => {
		const slice = createFilterEngineSlice('filters');
		const { engine } = makeFakeEngine();
		const { dispatch, store } = makeStore();

		attachEngineToStore(store, engine, { slice, syncOnAttach: false });

		expect(dispatch).not.toHaveBeenCalled();
	});

	it('omits the results array when the slice was created with includeResults: false', () => {
		const slice = createFilterEngineSlice('filters', { includeResults: false });
		const { engine } = makeFakeEngine({ resultCount: 3, results: [{ id: 1 }, { id: 2 }, { id: 3 }]});
		const { lastPayload, store } = makeStore();

		attachEngineToStore(store, engine, { slice });

		// fullSnapshot still carries a (deliberately empty) results array when excluded.
		expect(lastPayload()['results']).toEqual([]);
	});

	it('omits results from every partial payload when includeResults is false', () => {
		const slice = createFilterEngineSlice('filters', { includeResults: false });
		const fake = makeFakeEngine();
		const { lastPayload, store } = makeStore();

		attachEngineToStore(store, fake.engine, { slice });

		// Each partial branch takes the results-excluded false-side of its spread — the key is
		// absent entirely (distinct from fullSnapshot, which emits an empty results array).
		fake.state.expression = { kind: 'and' } as unknown as CompositeRule;
		fake.emit({ next: fake.state.expression, previous: null, type: 'expression' });
		expect(lastPayload()).not.toHaveProperty('results');

		fake.emit({ next: [], previous: [], type: 'results' });
		expect(lastPayload()).not.toHaveProperty('results');

		fake.emit(ruleAdded('price'));
		expect(lastPayload()).not.toHaveProperty('results');
	});

	it('reports expression mode from getExpression()', () => {
		const slice = createFilterEngineSlice('filters');
		const { engine } = makeFakeEngine({ expression: { kind: 'and' } as unknown as CompositeRule });
		const { lastPayload, store } = makeStore();

		attachEngineToStore(store, engine, { slice });

		expect(lastPayload()['mode']).toBe('expression');
	});

	it('emits a results-only partial for results / sourceData / workingSet events', () => {
		const slice = createFilterEngineSlice('filters');
		const fake = makeFakeEngine();
		const { lastPayload, store } = makeStore();

		attachEngineToStore(store, fake.engine, { slice });

		fake.state.resultCount = 5;
		fake.emit({ next: [], previous: [], type: 'results' });
		expect(lastPayload()).toMatchObject({ resultCount: 5, version: 2 });
		// No rule / mode fields in a results partial.
		expect(lastPayload()['activeRuleIds']).toBeUndefined();
		expect(lastPayload()['mode']).toBeUndefined();

		fake.state.resultCount = 9;
		fake.emit({ next: [], previous: [], type: 'sourceData' });
		expect(lastPayload()).toMatchObject({ resultCount: 9, version: 3 });

		fake.state.resultCount = 11;
		fake.emit({ next: [], previous: [], type: 'workingSet' });
		expect(lastPayload()).toMatchObject({ resultCount: 11, version: 4 });
	});

	it('derives lastChangeRuleId + timestamp from the event on rule mutations', () => {
		const slice = createFilterEngineSlice('filters');
		const fake = makeFakeEngine();
		const { lastPayload, store } = makeStore();

		attachEngineToStore(store, fake.engine, { slice });

		fake.state.activeRuleIds = ['price'];
		fake.state.resultCount = 42;
		fake.emit(ruleAdded('price'));

		const payload = lastPayload();

		expect(payload['activeRuleIds']).toEqual(['price']);
		expect(payload['resultCount']).toBe(42);
		expect(payload['lastChangeRuleId']).toBe('price');
		expect(typeof payload['lastChangeTimestamp']).toBe('number');
	});

	it('handles rule:changed and rule:removed identically to rule:added', () => {
		const slice = createFilterEngineSlice('filters');
		const fake = makeFakeEngine();
		const { lastPayload, store } = makeStore();

		attachEngineToStore(store, fake.engine, { slice });

		// Both remaining rule-mutation event types derive last-change from the event's own
		// `ruleId` and emit the same activeRuleIds-bearing partial shape as rule:added.
		for (const type of ['rule:changed', 'rule:removed'] as const) {
			fake.state.activeRuleIds = ['color'];
			fake.emit(ruleEvent(type, 'color'));

			const payload = lastPayload();

			expect(payload['activeRuleIds']).toEqual(['color']);
			expect(payload['lastChangeRuleId']).toBe('color');
			expect(typeof payload['lastChangeTimestamp']).toBe('number');
		}
	});

	it('emits a mode partial for expression events', () => {
		const slice = createFilterEngineSlice('filters');
		const fake = makeFakeEngine();
		const { lastPayload, store } = makeStore();

		attachEngineToStore(store, fake.engine, { slice });

		fake.state.expression = { kind: 'or' } as unknown as CompositeRule;
		fake.emit({ next: fake.state.expression, previous: null, type: 'expression' });
		expect(lastPayload()['mode']).toBe('expression');
	});

	it('reports flat-map mode for an expression event that cleared the expression', () => {
		const slice = createFilterEngineSlice('filters');
		const fake = makeFakeEngine({ expression: { kind: 'and' } as unknown as CompositeRule });
		const { lastPayload, store } = makeStore();

		attachEngineToStore(store, fake.engine, { slice });

		// setExpression(null) returns to flat-map mode — the expression partial must reflect it.
		const previousExpression = fake.state.expression;

		fake.state.expression = null;
		fake.emit({ next: null, previous: previousExpression, type: 'expression' });
		expect(lastPayload()['mode']).toBe('flat-map');
	});

	it('clears last-change on reset (full snapshot with cleared tracking)', () => {
		const slice = createFilterEngineSlice('filters');
		const fake = makeFakeEngine();
		const { lastPayload, store } = makeStore();

		attachEngineToStore(store, fake.engine, { slice });

		// First a rule change populates last-change …
		fake.emit(ruleAdded('color'));
		expect(lastPayload()['lastChangeRuleId']).toBe('color');

		// … then reset clears it back to null.
		fake.state.activeRuleIds = [];
		fake.emit({ type: 'reset' });
		expect(lastPayload()['lastChangeRuleId']).toBeNull();
		expect(lastPayload()['lastChangeTimestamp']).toBeNull();
		expect(lastPayload()['activeRuleIds']).toEqual([]);
	});

	it('returns an unsubscribe that detaches the engine listener', () => {
		const slice = createFilterEngineSlice('filters');
		const fake = makeFakeEngine();
		const { dispatch, store } = makeStore();

		const detach = attachEngineToStore(store, fake.engine, { slice });

		expect(fake.listenerCount()).toBe(1);
		const callsAfterAttach = dispatch.mock.calls.length;

		detach();
		expect(fake.listenerCount()).toBe(0);

		// Further events no longer dispatch.
		fake.emit({ next: [], previous: [], type: 'results' });
		expect(dispatch.mock.calls.length).toBe(callsAfterAttach);
	});

	it('never reads engine.store (works against a core whose store getter throws)', () => {
		const slice = createFilterEngineSlice('filters');
		const fake = makeFakeEngine();

		// Simulate a worker-backed core: accessing `.store` throws. The orchestrator must not touch it.
		Object.defineProperty(fake.engine, 'store', {
			get() {
				throw new Error('store is not available on worker-backed engines');
			},
		});
		const { store } = makeStore();

		expect(() => {
			const detach = attachEngineToStore(store, fake.engine, { slice });

			fake.emit(ruleAdded('price'));
			fake.emit({ type: 'reset' });
			detach();
		}).not.toThrow();
	});
});
