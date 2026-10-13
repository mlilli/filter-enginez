/**
 * Tests for `buildCoreShim` — the sync `FilterEngine<T>` shim that `createRxJsEngineFromAsync`
 * exposes as `engine.core`.
 *
 * @remarks
 * Exercised in isolation by constructing the `CoreShimDeps` bag directly with real
 * `BehaviorSubject`s and a controllable fake `FilterEngineAsync`. Covers: the mirror getters,
 * every fire-and-forget mutation (including the `addRule` / `setExpression` serialization seams),
 * the `unsupported()` throwers (`simulate()` included — chip exclusion ships via the
 * `applyFiltersAndQuery` bundle), the suggestion trio's ABSENCE (it lives in an opt-in subpath,
 * not on `FilterEngine`, so `attachSuggestions` works against the shim instead of being guarded
 * away), and `subscribe` fan-out.
 */

import type { WireActionLogEntry, WireDevtoolsState } from '@filter-enginez/worker-bridge';

import {
	type ChangeEvent,
	type CompositeRule,
	type FilterGroup,
	type FilterRule,
	range,
	type RuleId,
	value,
} from '@filter-enginez/core';
import { attachSuggestions } from '@filter-enginez/core/suggestions';
import { BehaviorSubject, Subject } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';

import { buildCoreShim, type CoreShimDeps } from './buildCoreShim.js';
import { type FakeAsyncEngine, makeFakeAsyncEngine } from './fakeAsyncEngine.js';

interface Item {
	readonly price: number;
}

const SOURCE: readonly Item[] = [{ price: 10 }, { price: 20 }, { price: 30 }];

const INITIAL_DEVTOOLS_STATE: WireDevtoolsState = {
	canRedo: true,
	canUndo: true,
	currentIndex: 1,
	total: 3,
};

interface Harness {
	/** Every `applyOptimisticCursor` call the shim made, in order. */
	readonly cursorWrites: WireDevtoolsState[];
	readonly deps: CoreShimDeps<Item>;
	readonly fake: FakeAsyncEngine<Item>;
	readonly settledCalls: { count: number };
	readonly subjects: {
		actionLog: BehaviorSubject<readonly WireActionLogEntry[]>;
		activeRuleIds: BehaviorSubject<readonly RuleId[]>;
		activeRules: BehaviorSubject<ReadonlyMap<RuleId, FilterRule>>;
		devtoolsState: BehaviorSubject<WireDevtoolsState>;
		events: Subject<ChangeEvent>;
		expression: BehaviorSubject<CompositeRule | null>;
		groups: BehaviorSubject<readonly FilterGroup[]>;
		resultCount: BehaviorSubject<number>;
		results: BehaviorSubject<readonly Item[]>;
		sourceData: BehaviorSubject<readonly Item[]>;
	};
}

function makeHarness(actionLog: readonly WireActionLogEntry[] = []): Harness {
	const fake = makeFakeAsyncEngine<Item>({ results: SOURCE, sourceData: SOURCE });

	const subjects = {
		actionLog: new BehaviorSubject<readonly WireActionLogEntry[]>(actionLog),
		activeRuleIds: new BehaviorSubject<readonly RuleId[]>([]),
		activeRules: new BehaviorSubject<ReadonlyMap<RuleId, FilterRule>>(new Map()),
		devtoolsState: new BehaviorSubject<WireDevtoolsState>(INITIAL_DEVTOOLS_STATE),
		events: new Subject<ChangeEvent>(),
		expression: new BehaviorSubject<CompositeRule | null>(null),
		groups: new BehaviorSubject<readonly FilterGroup[]>([]),
		resultCount: new BehaviorSubject<number>(SOURCE.length),
		results: new BehaviorSubject<readonly Item[]>(SOURCE),
		sourceData: new BehaviorSubject<readonly Item[]>(SOURCE),
	};
	// The adapter owns the atomic cursor+tick write; here we only need to see that the shim asks
	// for it, so the spy records rather than emits.
	const cursorWrites: WireDevtoolsState[] = [];
	const settledCalls = { count: 0 };

	const deps: CoreShimDeps<Item> = {
		activeRuleIdsSubject: subjects.activeRuleIds,
		activeRulesSubject: subjects.activeRules,
		applyOptimisticCursor: (next) => {
			cursorWrites.push(next);
			subjects.devtoolsState.next(next);
		},
		asyncEngine: fake.engine,
		eventsSubject: subjects.events,
		expressionSubject: subjects.expression,
		getActionLog: () => subjects.actionLog.value,
		getDevtoolsState: () => subjects.devtoolsState.value,
		groupsSubject: subjects.groups,
		onTimeTravelSettled: () => {
			settledCalls.count += 1;
		},
		resultCountSubject: subjects.resultCount,
		resultsSubject: subjects.results,
		sourceDataSubject: subjects.sourceData,
	};

	return { cursorWrites, deps, fake, settledCalls, subjects };
}

/** Find the first recorded call to `method`, or `undefined`. */
function callTo(fake: FakeAsyncEngine<Item>, method: string): undefined | readonly unknown[] {
	return fake.calls.find((c) => c.method === method)?.args;
}

const disposers: (() => void)[] = [];

afterEach(() => {
	while (disposers.length > 0) {
		disposers.pop()?.();
	}
});

describe('buildCoreShim', () => {
	describe('mirror getters', () => {
		it('read through to the seeded subjects', () => {
			const h = makeHarness();
			const rule = value('price', 10);

			h.subjects.activeRuleIds.next(['price']);
			h.subjects.activeRules.next(new Map([['price', rule]]));
			h.subjects.groups.next([{ composition: 'or', filterIds: [], id: 'g' }]);
			const shim = buildCoreShim(h.deps);

			expect(shim.getActiveRuleIds()).toEqual(['price']);
			expect(shim.getExpression()).toBeNull();
			expect(shim.getGroups().map((g) => g.id)).toEqual(['g']);
			expect(shim.getResultCount()).toBe(SOURCE.length);
			expect(shim.getResults()).toEqual(SOURCE);
			expect(shim.getRule('price')).toBe(rule);
			expect(shim.getRule('absent')).toBeUndefined();
			expect(shim.getRules().size).toBe(1);
			expect(shim.getSourceData()).toEqual(SOURCE);
		});
	});

	describe('fire-and-forget mutations', () => {
		it('dispatch straight through to the async engine', () => {
			const h = makeHarness();
			const shim = buildCoreShim(h.deps);
			const group: FilterGroup = { composition: 'or', filterIds: [], id: 'g' };

			shim.addGroup(group);
			shim.clearRules();
			void shim.destroy();
			shim.removeGroup('g');
			shim.removeRule('price');
			shim.reset();
			shim.resetWorkingSet();
			shim.setSourceData(SOURCE);
			shim.setWorkingSet(SOURCE);

			expect(callTo(h.fake, 'addGroup')).toEqual([group]);
			expect(callTo(h.fake, 'clearRules')).toEqual([]);
			expect(callTo(h.fake, 'destroy')).toEqual([]);
			expect(callTo(h.fake, 'removeGroup')).toEqual(['g']);
			expect(callTo(h.fake, 'removeRule')).toEqual(['price']);
			expect(callTo(h.fake, 'reset')).toEqual([]);
			expect(callTo(h.fake, 'resetWorkingSet')).toEqual([]);
			expect(callTo(h.fake, 'setSourceData')).toEqual([SOURCE]);
			expect(callTo(h.fake, 'setWorkingSet')).toEqual([SOURCE]);
		});

		it('addRule serializes the rule before crossing the boundary', () => {
			const h = makeHarness();
			const shim = buildCoreShim(h.deps);
			const rule = value('price', 10);

			shim.addRule('price', rule);

			const args = callTo(h.fake, 'addRule');

			expect(args?.[0]).toBe('price');
			expect(args?.[1]).toEqual(rule.serialize());
		});

		it('setExpression serializes a non-null expression', () => {
			const h = makeHarness();
			const shim = buildCoreShim(h.deps);
			const expr = range('price', { max: 25, min: 5 });

			shim.setExpression(expr as never);

			expect(callTo(h.fake, 'setExpression')?.[0]).toEqual(expr.serialize());
		});

		it('setExpression passes null through unchanged', () => {
			const h = makeHarness();
			const shim = buildCoreShim(h.deps);

			shim.setExpression(null);

			expect(callTo(h.fake, 'setExpression')).toEqual([null]);
		});

		it('loadConfig forwards the config object', () => {
			const h = makeHarness();
			const shim = buildCoreShim(h.deps);
			const config = { filters: [], version: '1' } as never;

			shim.loadConfig(config);

			expect(callTo(h.fake, 'loadConfig')).toEqual([config]);
		});
	});

	describe('devtools — served, not refused', () => {
		it('reads the action log + cursor mirrors instead of throwing', () => {
			// The failure this pins is not subtle but it IS invisible from this package: an Angular
			// component may read `engine.core.devtools` in a FIELD INITIALIZER, which has no seam, so
			// a throw here would take the whole view down at construction.
			const entry = { summary: 'RangeRule <price>', timestamp: 1, type: 'RULE_ADDED' };
			const h = makeHarness([entry]);
			const shim = buildCoreShim(h.deps);
			const { devtools } = shim;

			expect(() => devtools.actionLog).not.toThrow();
			expect(devtools.actionLog.size).toBe(1);
			expect(devtools.actionLog.toArray()).toEqual([entry]);
			expect(devtools.currentIndex).toBe(1);
			expect(devtools.canUndo).toBe(true);
			expect(devtools.canRedo).toBe(true);
		});

		it('undo paints the cursor optimistically and dispatches to the worker', () => {
			const h = makeHarness();
			const shim = buildCoreShim(h.deps);

			shim.devtools.undo();

			expect(h.cursorWrites).toEqual([
				{ canRedo: true, canUndo: true, currentIndex: 0, total: 3 },
			]);
			expect(callTo(h.fake, 'undoDevtools')).toEqual([]);
		});

		it('names THIS adapter when a consumer reaches an not-mirrored devtools surface', () => {
			// The shim is shared with `reactive-signals`; an error naming the wrong adapter would
			// send the reader to the wrong package.
			const shim = buildCoreShim(makeHarness().deps);

			// Called with the arity core's `Devtools.diff(fromIndex, toIndex)` declares — the getter
			// is cast to that type, so the shim's own zero-arg `diff` is not what TypeScript sees
			// here. The arguments are never read; the shim refuses before touching them.
			expect(() => shim.devtools.diff(0, 1)).toThrow(/^createRxJsEngineFromAsync: /u);
		});
	});

	describe('unsupported advanced facilities', () => {
		// `devtools` is deliberately ABSENT from this list — it is served by the shared
		// `createAsyncDevtoolsShim`, so time-travel controls and a devtools panel work on a
		// worker-backed engine too.
		const getters = [
			'bitmapIndex',
			'dispatcher',
			'exclusionGraph',
			'simulationCache',
			'store',
		] as const;

		it.each(getters)('accessing %s throws a pointer error', (name) => {
			const shim = buildCoreShim(makeHarness().deps);

			expect(() => (shim as unknown as Record<string, unknown>)[name]).toThrow(
				/not available on/,
			);
		});

		it('still refuses attachSimilarity, via the store guard rather than a bespoke one', () => {
			// The shim has no `similarity` getter: `FilterEngine` has no such property, so no typed
			// caller can reach it. `attachSimilarity` reads `store.sourceData`, and `store` itself
			// throws here — one guard covers both.
			const shim = buildCoreShim(makeHarness().deps);

			expect((shim as unknown as Record<string, unknown>)['similarity']).toBeUndefined();
			expect(() => shim.store).toThrow(/not available on/);
			expect(() => shim.store).toThrow(expect.objectContaining({ code: 'MODE_WORKER_UNSUPPORTED', name: 'FilterEngineModeError' }));
		});

		it.each(['bayesianModel', 'sessionTracker', 'suggestions'] as const)(
			'does not shim %s — the suggestion trio lives in the opt-in core/suggestions subpath',
			(name) => {
				// Mirrors the reactive-signals twin. The WORKER's trio would be unreachable across
				// postMessage — but the main thread wants A trio, not the worker's, and
				// `attachSuggestions(shim)` supplies one. Nothing can diverge: the worker-side engine
				// has no trio at all.
				const shim = buildCoreShim(makeHarness().deps);

				expect((shim as unknown as Record<string, unknown>)[name]).toBeUndefined();
			},
		);

		it('attachSuggestions works against the shim, which is the point of removing the guards', () => {
			const shim = buildCoreShim(makeHarness().deps);
			const { sessionTracker, suggestions } = attachSuggestions(shim);

			for (let index = 0; index < 4; index += 1) {
				sessionTracker.recordSession(['color', 'price']);
			}

			expect(suggestions.getSuggestions(['color'])[0]?.ruleId).toBe('price');
		});

		it.each([
			['applyFiltersAndQuery', 'engine.asyncEngine.applyFiltersAndQuery(query)'],
			['computeResults', 'engine.asyncEngine.getResultIndices()'],
			['getFilteredFieldValuesExcept', 'engine.asyncEngine.getFilteredFieldValuesExcept(ruleId, fieldKey)'],
			['getResultIndices', 'engine.asyncEngine.getResultIndices()'],
		] as const)('synchronous %s throws, naming the async call that answers instead', (member, instead) => {
			// Present and throwing, never absent: an absent member reads "is not a function".
			const shim = buildCoreShim(makeHarness().deps);
			const call = (shim as unknown as Record<string, () => unknown>)[member];

			expect(call).toBeTypeOf('function');
			expect(() => call?.()).toThrow(expect.objectContaining({ code: 'MODE_WORKER_UNSUPPORTED', name: 'FilterEngineModeError' }));
			expect(() => call?.()).toThrow(`await \`${instead}\` instead`);
		});

		it.each(['precomputeExclusions', 'snapshot'] as const)('%s throws: it has no main-thread mirror', (member) => {
			const shim = buildCoreShim(makeHarness().deps);

			expect(() => shim[member]()).toThrow(/createRxJsEngineFromAsync: `engine\.core\.\w+\(\)` .*no main-thread mirror/u);
		});

		it('reports isDestroyed once destroy() has been called, and returns the async teardown', async () => {
			const shim = buildCoreShim(makeHarness().deps);

			expect(shim.isDestroyed).toBe(false);
			await expect(shim.destroy()).resolves.toBeUndefined();
			expect(shim.isDestroyed).toBe(true);
		});

		it('exportConfig() throws a pointer error', () => {
			const shim = buildCoreShim(makeHarness().deps);

			expect(() => shim.exportConfig()).toThrow(/not available on/);
		});

		it('simulate() throws pointing at the async surface + bundle', () => {
			const shim = buildCoreShim(makeHarness().deps);

			expect(() => shim.simulate({})).toThrow(/not available on worker-backed engines/);
			expect(() => shim.simulate({})).toThrow(/applyFiltersAndQuery/);
			expect(() => shim.simulate({})).toThrow(expect.objectContaining({ code: 'MODE_WORKER_UNSUPPORTED', name: 'FilterEngineModeError' }));
		});
	});

	describe('subscribe', () => {
		it('forwards events until unsubscribed', () => {
			const h = makeHarness();
			const shim = buildCoreShim(h.deps);
			const seen: string[] = [];
			const unsub = shim.subscribe((e) => seen.push(e.type));

			h.subjects.events.next({ type: 'reset' });
			unsub();
			h.subjects.events.next({ type: 'reset' });

			expect(seen).toEqual(['reset']);
		});
	});
});
