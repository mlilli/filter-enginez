/**
 * Tests for `createAsyncCoreShim` — the sync `FilterEngine<T>` `.core` shim over the async
 * worker engine (getters, fire-and-forget mutations, the `store` Proxy, `subscribe`, and the
 * unsupported advanced facilities).
 *
 * @remarks
 * The devtools surface of the shim is exercised in the sibling `createAsyncCoreShim.devtools.test.ts`
 * to keep both files under the 500-line cap. This file covers everything else: sync getters
 * read the mirror signals; sync mutations serialize (where applicable) and dispatch
 * fire-and-forget to the async engine; `exportConfig`/`simulate` throw the worker-backed
 * error; the five remaining advanced facilities throw via `unsupported(...)`; the suggestion
 * trio is asserted ABSENT rather than throwing, since it lives in an opt-in subpath rather than
 * on `FilterEngine` and `attachSuggestions` works against this shim; the `store` Proxy returns
 * the two last-change mirror signals, passes symbols through, and throws for any other named
 * access; and `subscribe` fans out from the `lastChangeEvent` signal.
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
import { signal } from '@preact/signals-core';
import { describe, expect, it } from 'vitest';

import { type AsyncCoreShimContext, createAsyncCoreShim } from './createAsyncCoreShim.js';
import { type FakeAsyncEngine, makeFakeAsyncEngine } from './fakeAsyncEngine.js';

interface Item {
	readonly price: number;
}

interface Harness {
	readonly core: ReturnType<typeof createAsyncCoreShim<Item>>;
	readonly ctx: AsyncCoreShimContext<Item>;
	readonly fake: FakeAsyncEngine<Item>;
	readonly setDisposed: (flag: boolean) => void;
}

const emptyDevtoolsState: WireDevtoolsState = {
	canRedo: false,
	canUndo: false,
	currentIndex: -1,
	total: 0,
};

function makeHarness(seed: Partial<{
	actionLog: readonly WireActionLogEntry[];
	activeRuleIds: readonly RuleId[];
	activeRules: ReadonlyMap<RuleId, FilterRule>;
	devtoolsState: WireDevtoolsState;
	expression: CompositeRule | null;
	groups: readonly FilterGroup[];
	resultCount: number;
	results: readonly Item[];
	sourceData: readonly Item[];
}> = {}): Harness {
	const fake = makeFakeAsyncEngine<Item>();
	let isDisposed = false;
	const ctx: AsyncCoreShimContext<Item> = {
		actionLogSignal: signal<readonly WireActionLogEntry[]>(seed.actionLog ?? []),
		activeRuleIdsSignal: signal<readonly RuleId[]>(seed.activeRuleIds ?? []),
		activeRulesSignal: signal<ReadonlyMap<RuleId, FilterRule>>(seed.activeRules ?? new Map()),
		asyncEngine: fake.engine,
		devtoolsStateSignal: signal<WireDevtoolsState>(seed.devtoolsState ?? emptyDevtoolsState),
		expressionSignal: signal<CompositeRule | null>(seed.expression ?? null),
		getIsDisposed: () => isDisposed,
		groupsSignal: signal<readonly FilterGroup[]>(seed.groups ?? []),
		lastChangeEventSignal: signal<ChangeEvent | null>(null),
		lastChangeRuleIdSignal: signal<RuleId | null>(null),
		lastChangeTimestampSignal: signal<number | null>(null),
		refreshDevtools: async () => Promise.resolve(),
		refreshEverything: async () => Promise.resolve(),
		resultCountSignal: signal<number>(seed.resultCount ?? 0),
		resultsSignal: signal<readonly Item[]>(seed.results ?? []),
		sourceDataSignal: signal<readonly Item[]>(seed.sourceData ?? []),
	};

	return {
		core: createAsyncCoreShim<Item>(ctx),
		ctx,
		fake,
		setDisposed: (flag: boolean): void => {
			isDisposed = flag;
		},
	};
}

/** Find the most recent recorded call to `method` on the fake. */
function lastCall(fake: FakeAsyncEngine<Item>, method: string): undefined | readonly unknown[] {
	for (let i = fake.calls.length - 1; i >= 0; i--) {
		const call = fake.calls[i];

		if (call !== undefined && call.method === method) {
			return call.args;
		}
	}

	return undefined;
}

describe('createAsyncCoreShim', () => {
	describe('sync getters read the mirror signals', () => {
		it('returns source data / results / count / rules / ids / expression / groups from signals', () => {
			const rules = new Map<RuleId, FilterRule>([['price', range('price', { max: 5, min: 1 })]]);
			const source: readonly Item[] = [{ price: 1 }, { price: 2 }];
			const results: readonly Item[] = [{ price: 1 }];
			const groups: readonly FilterGroup[] = [{ composition: 'or', filterIds: ['price'], id: 'g' }];
			const { core } = makeHarness({
				activeRuleIds: ['price'],
				activeRules: rules,
				groups,
				resultCount: 1,
				results,
				sourceData: source,
			});

			expect(core.getSourceData()).toEqual(source);
			expect(core.getResults()).toEqual(results);
			expect(core.getResultCount()).toBe(1);
			expect(core.getRules()).toBe(rules);
			expect(core.getRule('price')).toBe(rules.get('price'));
			expect(core.getActiveRuleIds()).toEqual(['price']);
			expect(core.getExpression()).toBeNull();
			expect(core.getGroups()).toEqual(groups);
		});
	});

	describe('fire-and-forget mutations dispatch to the async engine', () => {
		it('addRule serializes the rule before crossing the boundary', () => {
			const { core, fake } = makeHarness();
			const rule = range('price', { max: 9, min: 3 });

			core.addRule('price', rule);

			const args = lastCall(fake, 'addRule');

			expect(args?.[0]).toBe('price');
			// The wire payload is the serialized shape, not the live instance.
			expect(args?.[1]).toEqual(rule.serialize());
			expect(args?.[1]).not.toBe(rule);
		});

		it('removeRule / clearRules / addGroup / removeGroup / reset / resetWorkingSet dispatch through', () => {
			const { core, fake } = makeHarness();
			const group: FilterGroup = { composition: 'and', filterIds: ['a'], id: 'g1' };

			core.removeRule('price');
			core.clearRules();
			core.addGroup(group);
			core.removeGroup('g1');
			core.reset();
			core.resetWorkingSet();

			expect(lastCall(fake, 'removeRule')).toEqual(['price']);
			expect(fake.calls.some((c) => c.method === 'clearRules')).toBe(true);
			expect(lastCall(fake, 'addGroup')).toEqual([group]);
			expect(lastCall(fake, 'removeGroup')).toEqual(['g1']);
			expect(fake.calls.some((c) => c.method === 'reset')).toBe(true);
			expect(fake.calls.some((c) => c.method === 'resetWorkingSet')).toBe(true);
		});

		it('setExpression serializes a non-null expression and forwards null untouched', () => {
			const { core, fake } = makeHarness();
			const expr = range('price', { max: 5, min: 1 }) as unknown as CompositeRule;

			core.setExpression(expr);
			const nonNullArgs = lastCall(fake, 'setExpression');

			expect(nonNullArgs?.[0]).toEqual((expr as unknown as FilterRule).serialize());

			core.setExpression(null);
			const nullArgs = lastCall(fake, 'setExpression');

			expect(nullArgs?.[0]).toBeNull();
		});

		it('setSourceData / setWorkingSet / loadConfig / destroy dispatch through', () => {
			const { core, fake } = makeHarness();
			const items: readonly Item[] = [{ price: 7 }];

			const config = { rules: [], version: 1 };

			core.setSourceData(items);
			core.setWorkingSet(items);
			core.loadConfig(config);
			void core.destroy();

			expect(lastCall(fake, 'setSourceData')).toEqual([items]);
			expect(lastCall(fake, 'setWorkingSet')).toEqual([items]);
			expect(lastCall(fake, 'loadConfig')).toEqual([config]);
			expect(fake.calls.some((c) => c.method === 'destroy')).toBe(true);
		});
	});

	describe('unsupported sync surfaces throw', () => {
		it('exportConfig throws the worker-backed error', () => {
			const { core } = makeHarness();

			expect(() => core.exportConfig()).toThrow(/not available on/u);
			expect(() => core.exportConfig()).toThrow(expect.objectContaining({ code: 'MODE_WORKER_UNSUPPORTED', name: 'FilterEngineModeError' }));
		});

		it('simulate throws the worker-backed error pointing at asyncEngine.simulate', () => {
			const { core } = makeHarness();

			expect(() => core.simulate({ withoutRule: 'price' }))
				.toThrow(/engine\.asyncEngine\.simulate/u);
			expect(() => core.simulate({ withoutRule: 'price' })).toThrow(expect.objectContaining({ code: 'MODE_WORKER_UNSUPPORTED', name: 'FilterEngineModeError' }));
		});

		it.each([
			['applyFiltersAndQuery', 'engine.asyncEngine.applyFiltersAndQuery(query)'],
			['computeResults', 'engine.asyncEngine.getResultIndices()'],
			['getFilteredFieldValuesExcept', 'engine.asyncEngine.getFilteredFieldValuesExcept(ruleId, fieldKey)'],
			['getResultIndices', 'engine.asyncEngine.getResultIndices()'],
		] as const)('synchronous %s throws, naming the async call that answers instead', (member, instead) => {
			// Present and throwing, never absent: an absent member reads "is not a function".
			const { core } = makeHarness();
			const call = (core as unknown as Record<string, () => unknown>)[member];

			expect(call).toBeTypeOf('function');
			expect(() => call?.()).toThrow(expect.objectContaining({ code: 'MODE_WORKER_UNSUPPORTED', name: 'FilterEngineModeError' }));
			expect(() => call?.()).toThrow(`await \`${instead}\` instead`);
		});

		it.each(['precomputeExclusions', 'snapshot'] as const)('%s throws: it has no main-thread mirror', (member) => {
			const { core } = makeHarness();

			expect(() => core[member]()).toThrow(/createSignalsEngineFromAsync: `engine\.core\.\w+\(\)` .*no main-thread mirror/u);
		});

		it('reports isDestroyed once destroy() has been called, and returns the async teardown', async () => {
			const { core } = makeHarness();

			expect(core.isDestroyed).toBe(false);
			await expect(core.destroy()).resolves.toBeUndefined();
			expect(core.isDestroyed).toBe(true);
		});

		it.each([
			'bitmapIndex',
			'dispatcher',
			'exclusionGraph',
			'simulationCache',
		] as const)('advanced facility %s throws via unsupported', (facility) => {
			const { core } = makeHarness();

			expect(() => (core as unknown as Record<string, unknown>)[facility]).toThrow(/not available on/u);
		});

		it('still refuses attachSimilarity, via the store guard rather than a bespoke one', () => {
			// The shim has no `similarity` getter: `FilterEngine` has no such property, so no typed
			// caller can reach it. The guard that matters sits one level down — `attachSimilarity`
			// reads `store.sourceData`, and the store Proxy below throws.
			const { core } = makeHarness();

			expect((core as unknown as Record<string, unknown>)['similarity']).toBeUndefined();
			expect(() => core.store.sourceData).toThrow(/not available on/u);
		});

		it.each(['bayesianModel', 'sessionTracker', 'suggestions'] as const)(
			'does not shim %s — the suggestion trio lives in the opt-in core/suggestions subpath',
			(facility) => {
				// No `unsupported` guard is needed. The WORKER's trio would be unreachable across
				// postMessage, but the main thread never wants the worker's trio — it wants A trio, and
				// `attachSuggestions(core)` gives it one. There is no divergence risk either, because
				// the worker-side engine has no trio at all.
				const { core } = makeHarness();

				expect((core as unknown as Record<string, unknown>)[facility]).toBeUndefined();
			},
		);

		it('attachSuggestions works against the shim, which is why the trio is not guarded', () => {
			const { core } = makeHarness();
			const { sessionTracker, suggestions } = attachSuggestions(core);

			for (let index = 0; index < 4; index += 1) {
				sessionTracker.recordSession(['color', 'price']);
			}

			expect(suggestions.getSuggestions(['color'])[0]?.ruleId).toBe('price');
		});
	});

	describe('store Proxy shim', () => {
		it('reads lastChangeRuleId / lastChangeTimestamp as the mirror signals', () => {
			const { core, ctx } = makeHarness();

			ctx.lastChangeRuleIdSignal.value = 'price';
			ctx.lastChangeTimestampSignal.value = 12345;

			const store = core.store as unknown as {
				lastChangeRuleId: { value: RuleId | null };
				lastChangeTimestamp: { value: number | null };
			};

			expect(store.lastChangeRuleId.value).toBe('price');
			expect(store.lastChangeTimestamp.value).toBe(12345);
		});

		it('throws unsupported for any other named property access', () => {
			const { core } = makeHarness();

			expect(() => (core.store as unknown as Record<string, unknown>)['workingSet'])
				.toThrow(/store\.workingSet/u);
		});

		it('passes symbol access straight through (no throw)', () => {
			const { core } = makeHarness();
			const store = core.store as unknown as Record<symbol, unknown>;

			expect(() => store[Symbol.iterator]).not.toThrow();
			expect(store[Symbol.iterator]).toBeUndefined();
		});
	});

	describe('subscribe', () => {
		it('invokes the listener on non-null lastChangeEvent and stops after teardown', () => {
			const { core, ctx } = makeHarness();
			const seen: ChangeEvent[] = [];
			const teardown = core.subscribe((event) => {
				seen.push(event);
			});

			// Null events do not invoke the listener.
			ctx.lastChangeEventSignal.value = null;
			expect(seen).toHaveLength(0);

			ctx.lastChangeEventSignal.value = { type: 'reset' };
			expect(seen).toEqual([{ type: 'reset' }]);

			teardown();
			ctx.lastChangeEventSignal.value = { next: [], previous: [], type: 'results' };
			expect(seen).toEqual([{ type: 'reset' }]);
		});
	});

	describe('value rule getters', () => {
		it('getRule returns undefined for an unregistered id', () => {
			const rules = new Map<RuleId, FilterRule>([['known', value('price', 1)]]);
			const { core } = makeHarness({ activeRules: rules });

			expect(core.getRule('unknown')).toBeUndefined();
		});
	});
});
