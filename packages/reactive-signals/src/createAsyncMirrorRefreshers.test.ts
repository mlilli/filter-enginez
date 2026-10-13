/**
 * Tests for `createAsyncMirrorRefreshers` — the event-type-aware mirror-refresh helpers for the
 * worker-backed signals adapter.
 *
 * @remarks
 * The purest of the worker-path modules. Covers the two pure transforms (`deserializeRules`
 * happy + catch path; `projectResults` identity fast-path + projection path) and every
 * refresher, including BOTH disposal guards on each refresher — the entry guard (disposed
 * before the call) and the mid-await guard (disposed after the awaited getter resolves but
 * before the continuation writes signals). The mid-await flip uses a controllable deferred
 * promise injected into the fake's getter so the test can flip `isDisposed` between resolution
 * and continuation.
 */

import type { WireActionLogEntry, WireDevtoolsState } from '@filter-enginez/worker-bridge';

import {
	and,
	type CompositeRule,
	type FilterGroup,
	type FilterRule,
	inSet,
	range,
	type RuleId,
	value,
} from '@filter-enginez/core';
import { signal } from '@preact/signals-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	type AsyncMirrorRefresherContext,
	createAsyncMirrorRefreshers,
} from './createAsyncMirrorRefreshers.js';
import { type FakeAsyncEngine, makeFakeAsyncEngine } from './fakeAsyncEngine.js';

interface Item {
	readonly price: number;
}

/** Serialize a real rule into the wire shape the fake's `getRules` returns. */
function serializedRule(rule: FilterRule): FilterRule {
	return rule.serialize() as unknown as FilterRule;
}

/** A serialized-rules map for the wire boundary, keyed by id. */
function serializedRuleMap(entries: readonly (readonly [RuleId, FilterRule])[]): ReadonlyMap<RuleId, FilterRule> {
	const out = new Map<RuleId, FilterRule>();

	for (const [id, rule] of entries) {
		out.set(id, serializedRule(rule));
	}

	return out;
}

interface Harness<T> {
	readonly ctx: AsyncMirrorRefresherContext<T>;
	readonly fake: FakeAsyncEngine<T>;
	readonly refreshers: ReturnType<typeof createAsyncMirrorRefreshers<T>>;
	readonly setDisposed: (flag: boolean) => void;
}

/** Build a refresher context backed by real signals + the controllable fake engine. */
function makeHarness<T>(seed: Partial<Parameters<typeof makeFakeAsyncEngine<T>>[0]> = {}): Harness<T> {
	const fake = makeFakeAsyncEngine<T>(seed);
	let isDisposed = false;
	const ctx: AsyncMirrorRefresherContext<T> = {
		actionLogSignal: signal<readonly WireActionLogEntry[]>([]),
		activeRuleIdsSignal: signal<readonly RuleId[]>([]),
		activeRulesSignal: signal<ReadonlyMap<RuleId, FilterRule>>(new Map()),
		asyncEngine: fake.engine,
		devtoolsStateSignal: signal<WireDevtoolsState>({
			canRedo: false,
			canUndo: false,
			currentIndex: -1,
			total: 0,
		}),
		expressionSignal: signal<CompositeRule | null>(null),
		getIsDisposed: () => isDisposed,
		groupsSignal: signal<readonly FilterGroup[]>([]),
		modeSignal: signal<'expression' | 'flat-map'>('flat-map'),
		resultCountSignal: signal<number>(0),
		resultsSignal: signal<readonly T[]>([]),
		sourceDataSignal: signal<readonly T[]>([]),
		workingSetSignal: signal<readonly T[]>([]),
	};

	return {
		ctx,
		fake,
		refreshers: createAsyncMirrorRefreshers<T>(ctx),
		setDisposed: (flag: boolean): void => {
			isDisposed = flag;
		},
	};
}

const restoreFns: (() => void)[] = [];

afterEach(() => {
	while (restoreFns.length > 0) {
		restoreFns.pop()?.();
	}
	vi.restoreAllMocks();
});

describe('createAsyncMirrorRefreshers', () => {
	describe('deserializeRules', () => {
		it('reconstructs real rule instances from the serialized wire map', () => {
			const { refreshers } = makeHarness<Item>();
			const raw = serializedRuleMap([
				['price', range('price', { max: 50, min: 10 })],
				['origin', inSet('origin', ['a', 'b'])],
			]);

			const out = refreshers.deserializeRules(raw);

			expect(out.size).toBe(2);
			// A reconstructed instance carries prototype methods (serialize/action) the bare
			// serialized wire object lacks; round-tripping serialize confirms a real instance.
			expect(typeof out.get('price')?.serialize).toBe('function');
			expect(typeof out.get('origin')?.serialize).toBe('function');
			expect(out.get('price')?.serialize().type).toBe('RangeRule');
			expect(out.get('origin')?.serialize().type).toBe('InSetRule');
		});

		it('skips a rule that throws on deserialize and WARNS, keeping the good ones', () => {
			// **The level is `warn`, not `info`.** The repo's logging standard puts "something
			// unexpected happened but was handled" at `warn`, and a rule the registry cannot rebuild
			// is that: a rule type whose name a minifier rewrote, for instance, surfaces here as a
			// skipped rule, and at `info` a whole class of silent failure would read as normal
			// operation.
			const { refreshers } = makeHarness<Item>();
			const warnSpy = vi.fn();

			vi.stubGlobal('console', { warn: warnSpy });
			restoreFns.push(() => {
				vi.unstubAllGlobals();
			});

			const raw = new Map<RuleId, FilterRule>([
				['good', serializedRule(value('price', 10))],
				// Unknown rule type → registry throws → caught + skipped.
				['bad', { config: {}, type: 'TotallyNotARealRule' } as unknown as FilterRule],
			]);

			const out = refreshers.deserializeRules(raw);

			expect(out.has('good')).toBe(true);
			expect(out.has('bad')).toBe(false);
			expect(warnSpy).toHaveBeenCalledTimes(1);
			expect(String(warnSpy.mock.calls[0]?.[0])).toContain("rule 'bad' could not be rehydrated");
			// The adapter names itself, so a console reader knows which of the two produced it.
			expect(String(warnSpy.mock.calls[0]?.[0])).toContain('createSignalsEngineFromAsync');
		});

		it('warns ONCE per rule id, however many times the mirror refreshes', () => {
			// The reason the level can be `warn` at all. `PredicateRule` is unserializable BY DESIGN,
			// so a config using one would warn on every settle — hundreds over a session, for a
			// documented and expected condition. That is how a log level stops meaning anything.
			const { refreshers } = makeHarness<Item>();
			const warnSpy = vi.fn();

			vi.stubGlobal('console', { warn: warnSpy });
			restoreFns.push(() => {
				vi.unstubAllGlobals();
			});

			const raw = new Map<RuleId, FilterRule>([
				['bad', { config: {}, type: 'TotallyNotARealRule' } as unknown as FilterRule],
			]);

			refreshers.deserializeRules(raw);
			refreshers.deserializeRules(raw);
			refreshers.deserializeRules(raw);

			expect(warnSpy).toHaveBeenCalledTimes(1);
		});
	});

	describe('projectResults', () => {
		it('returns the SAME workingSet array reference on the identity fast-path', () => {
			const { refreshers } = makeHarness<Item>();
			const workingSet: readonly Item[] = [{ price: 1 }, { price: 2 }, { price: 3 }];
			const indices = new Uint32Array([0, 1, 2]);

			const out = refreshers.projectResults(indices, workingSet);

			expect(out).toBe(workingSet);
		});

		it('projects a subset by joining indices against the workingSet', () => {
			const { refreshers } = makeHarness<Item>();
			const workingSet: readonly Item[] = [{ price: 1 }, { price: 2 }, { price: 3 }];
			const indices = new Uint32Array([2, 0]);

			const out = refreshers.projectResults(indices, workingSet);

			expect(out).not.toBe(workingSet);
			expect(out).toEqual([{ price: 3 }, { price: 1 }]);
		});
	});

	describe('refreshResultsAndCount', () => {
		it('projects indices against the workingSet mirror and writes results + count under batch', async () => {
			const ws: readonly Item[] = [{ price: 1 }, { price: 2 }, { price: 3 }];
			const { ctx, refreshers } = makeHarness<Item>({ resultIndices: new Uint32Array([2, 1]) });

			ctx.workingSetSignal.value = ws;

			await refreshers.refreshResultsAndCount();

			expect(ctx.resultsSignal.value).toEqual([{ price: 3 }, { price: 2 }]);
			expect(ctx.resultCountSignal.value).toBe(2);
		});

		it('no-ops at the entry guard when already disposed', async () => {
			const { ctx, refreshers, setDisposed } = makeHarness<Item>({
				resultIndices: new Uint32Array([0]),
			});

			setDisposed(true);
			await refreshers.refreshResultsAndCount();

			expect(ctx.resultCountSignal.value).toBe(0);
			expect(ctx.resultsSignal.value).toEqual([]);
		});

		it('no-ops at the post-await guard when disposed mid-flight', async () => {
			const { ctx, fake, refreshers, setDisposed } = makeHarness<Item>();
			let resolveIndices: ((value: Uint32Array) => void) | undefined;

			fake.engine.getResultIndices = async () =>
				new Promise<Uint32Array>((res) => {
					resolveIndices = res;
				});

			const pending = refreshers.refreshResultsAndCount();

			setDisposed(true);
			resolveIndices?.(new Uint32Array([0, 1]));
			await pending;

			expect(ctx.resultCountSignal.value).toBe(0);
			expect(ctx.resultsSignal.value).toEqual([]);
		});
	});

	describe('refreshRulesAndResults', () => {
		it('pulls rules + ids + indices in parallel and writes all four mirrors', async () => {
			const ws: readonly Item[] = [{ price: 1 }, { price: 2 }];
			const { ctx, refreshers } = makeHarness<Item>({
				activeRuleIds: ['price'],
				resultIndices: new Uint32Array([1]),
				rules: serializedRuleMap([['price', range('price', { max: 5, min: 2 })]]),
			});

			ctx.workingSetSignal.value = ws;

			await refreshers.refreshRulesAndResults();

			expect(ctx.activeRuleIdsSignal.value).toEqual(['price']);
			expect(ctx.activeRulesSignal.value.size).toBe(1);
			expect(ctx.resultsSignal.value).toEqual([{ price: 2 }]);
			expect(ctx.resultCountSignal.value).toBe(1);
		});

		it('no-ops at the entry guard when already disposed', async () => {
			const { ctx, refreshers, setDisposed } = makeHarness<Item>({
				activeRuleIds: ['price'],
			});

			setDisposed(true);
			await refreshers.refreshRulesAndResults();

			expect(ctx.activeRuleIdsSignal.value).toEqual([]);
		});

		it('no-ops at the post-await guard when disposed mid-flight', async () => {
			const { ctx, fake, refreshers, setDisposed } = makeHarness<Item>({
				activeRuleIds: ['price'],
				resultIndices: new Uint32Array([0]),
			});
			let resolveIds: ((value: readonly RuleId[]) => void) | undefined;

			fake.engine.getActiveRuleIds = async () =>
				new Promise<readonly RuleId[]>((res) => {
					resolveIds = res;
				});

			const pending = refreshers.refreshRulesAndResults();

			setDisposed(true);
			resolveIds?.(['price']);
			await pending;

			expect(ctx.activeRuleIdsSignal.value).toEqual([]);
		});
	});

	describe('refreshExpressionAndResults', () => {
		it('flips mode to expression when the worker returns a non-null expression', async () => {
			const expr = and(range('price', { max: 5, min: 1 }));
			const { ctx, refreshers } = makeHarness<Item>({
				expression: expr,
				resultIndices: new Uint32Array([0]),
			});

			ctx.workingSetSignal.value = [{ price: 1 }];

			await refreshers.refreshExpressionAndResults();

			expect(ctx.expressionSignal.value).not.toBeNull();
			expect(ctx.modeSignal.value).toBe('expression');
			expect(ctx.resultCountSignal.value).toBe(1);
		});

		it('flips mode to flat-map when the worker returns a null expression', async () => {
			const { ctx, refreshers } = makeHarness<Item>({
				expression: null,
				resultIndices: new Uint32Array([0]),
			});

			ctx.modeSignal.value = 'expression';
			ctx.workingSetSignal.value = [{ price: 1 }];

			await refreshers.refreshExpressionAndResults();

			expect(ctx.expressionSignal.value).toBeNull();
			expect(ctx.modeSignal.value).toBe('flat-map');
		});

		it('no-ops at the entry guard when already disposed', async () => {
			const { ctx, refreshers, setDisposed } = makeHarness<Item>();

			ctx.modeSignal.value = 'flat-map';
			setDisposed(true);
			await refreshers.refreshExpressionAndResults();

			expect(ctx.resultCountSignal.value).toBe(0);
		});

		it('no-ops at the post-await guard when disposed mid-flight', async () => {
			const { ctx, fake, refreshers, setDisposed } = makeHarness<Item>({
				resultIndices: new Uint32Array([0]),
			});
			let resolveExpr: ((value: CompositeRule | null) => void) | undefined;

			fake.engine.getExpression = async () =>
				new Promise<CompositeRule | null>((res) => {
					resolveExpr = res;
				});

			const pending = refreshers.refreshExpressionAndResults();

			setDisposed(true);
			resolveExpr?.(null);
			await pending;

			expect(ctx.resultCountSignal.value).toBe(0);
		});
	});

	describe('refreshSourceAndDerived', () => {
		it('re-pulls sourceData, mirrors it into workingSet, and projects results from it', async () => {
			const source: readonly Item[] = [{ price: 10 }, { price: 20 }, { price: 30 }];
			const { ctx, refreshers } = makeHarness<Item>({
				resultIndices: new Uint32Array([2]),
				sourceData: source,
			});

			await refreshers.refreshSourceAndDerived();

			expect(ctx.sourceDataSignal.value).toEqual(source);
			expect(ctx.workingSetSignal.value).toEqual(source);
			expect(ctx.resultsSignal.value).toEqual([{ price: 30 }]);
			expect(ctx.resultCountSignal.value).toBe(1);
		});

		it('no-ops at the entry guard when already disposed', async () => {
			const { ctx, refreshers, setDisposed } = makeHarness<Item>({
				sourceData: [{ price: 1 }],
			});

			setDisposed(true);
			await refreshers.refreshSourceAndDerived();

			expect(ctx.sourceDataSignal.value).toEqual([]);
		});

		it('no-ops at the post-await guard when disposed mid-flight', async () => {
			const { ctx, fake, refreshers, setDisposed } = makeHarness<Item>({
				resultIndices: new Uint32Array([0]),
			});
			let resolveSource: ((value: readonly Item[]) => void) | undefined;

			fake.engine.getSourceData = async () =>
				new Promise<readonly Item[]>((res) => {
					resolveSource = res;
				});

			const pending = refreshers.refreshSourceAndDerived();

			setDisposed(true);
			resolveSource?.([{ price: 1 }]);
			await pending;

			expect(ctx.sourceDataSignal.value).toEqual([]);
		});
	});

	describe('refreshDevtools', () => {
		it('writes the action log + devtools cursor mirrors under batch', async () => {
			const log: readonly WireActionLogEntry[] = [
				{ summary: 'price: 10 — 50', timestamp: 1, type: 'RULE_ADDED' },
			];
			const devtoolsState: WireDevtoolsState = {
				canRedo: false,
				canUndo: true,
				currentIndex: 0,
				total: 1,
			};
			const { ctx, refreshers } = makeHarness<Item>({ actionLog: log, devtoolsState });

			await refreshers.refreshDevtools();

			expect(ctx.actionLogSignal.value).toEqual(log);
			expect(ctx.devtoolsStateSignal.value).toEqual(devtoolsState);
		});

		it('no-ops at the entry guard when already disposed', async () => {
			const { ctx, refreshers, setDisposed } = makeHarness<Item>({
				actionLog: [{ summary: 's', timestamp: 1, type: 'X' }],
			});

			setDisposed(true);
			await refreshers.refreshDevtools();

			expect(ctx.actionLogSignal.value).toEqual([]);
		});

		it('no-ops at the post-await guard when disposed mid-flight', async () => {
			const { ctx, fake, refreshers, setDisposed } = makeHarness<Item>();
			let resolveLog: ((value: readonly WireActionLogEntry[]) => void) | undefined;

			fake.engine.getActionLogSnapshot = async () =>
				new Promise<readonly WireActionLogEntry[]>((res) => {
					resolveLog = res;
				});

			const pending = refreshers.refreshDevtools();

			setDisposed(true);
			resolveLog?.([{ summary: 's', timestamp: 1, type: 'X' }]);
			await pending;

			expect(ctx.actionLogSignal.value).toEqual([]);
		});
	});

	describe('refreshEverything', () => {
		it('re-pulls the full corpus + all derived state and seeds every mirror', async () => {
			const source: readonly Item[] = [{ price: 1 }, { price: 2 }];
			const groups: readonly FilterGroup[] = [
				{ composition: 'and', filterIds: ['price'], id: 'g1' },
			];
			const { ctx, refreshers } = makeHarness<Item>({
				activeRuleIds: ['price'],
				groups,
				resultIndices: new Uint32Array([1]),
				rules: serializedRuleMap([['price', range('price', { max: 5, min: 2 })]]),
				sourceData: source,
			});

			await refreshers.refreshEverything();

			expect(ctx.sourceDataSignal.value).toEqual(source);
			expect(ctx.workingSetSignal.value).toEqual(source);
			expect(ctx.resultsSignal.value).toEqual([{ price: 2 }]);
			expect(ctx.resultCountSignal.value).toBe(1);
			expect(ctx.activeRulesSignal.value.size).toBe(1);
			expect(ctx.activeRuleIdsSignal.value).toEqual(['price']);
			expect(ctx.expressionSignal.value).toBeNull();
			expect(ctx.modeSignal.value).toBe('flat-map');
			expect(ctx.groupsSignal.value).toEqual(groups);
		});

		it('flips mode to expression when refreshing everything with an active expression', async () => {
			const expr = and(range('price', { max: 5, min: 1 }));
			const { ctx, refreshers } = makeHarness<Item>({
				expression: expr,
				resultIndices: new Uint32Array(0),
				sourceData: [],
			});

			await refreshers.refreshEverything();

			expect(ctx.modeSignal.value).toBe('expression');
		});

		it('no-ops at the entry guard when already disposed', async () => {
			const { ctx, refreshers, setDisposed } = makeHarness<Item>({
				sourceData: [{ price: 1 }],
			});

			setDisposed(true);
			await refreshers.refreshEverything();

			expect(ctx.sourceDataSignal.value).toEqual([]);
		});

		it('no-ops at the post-await guard when disposed mid-flight', async () => {
			const { ctx, fake, refreshers, setDisposed } = makeHarness<Item>({
				resultIndices: new Uint32Array(0),
				sourceData: [{ price: 1 }],
			});
			let resolveGroups: ((value: readonly FilterGroup[]) => void) | undefined;

			fake.engine.getGroups = async () =>
				new Promise<readonly FilterGroup[]>((res) => {
					resolveGroups = res;
				});

			const pending = refreshers.refreshEverything();

			setDisposed(true);
			resolveGroups?.([]);
			await pending;

			expect(ctx.sourceDataSignal.value).toEqual([]);
		});
	});
});
