/**
 * Tests for `createSignalsEngineFromAsync` — the async factory that wraps a controllable fake
 * `FilterEngineAsync<T>` in a `SignalsEngine<T>` reactive facade.
 *
 * @remarks
 * Covers the initial-state pull + seeding, the eager/lazy per-rule-signal branches, the full
 * `handleEvent` switch (every event type routed to the right refresher, with lastChange* bumped
 * post-refresh and rule-id captured for rule events), both `getIsDisposed` guards in
 * `handleEvent` (entry + post-`Promise.all`), per-rule-signal memoization, idempotent disposal
 * (including the throwing-unsubscribe tolerance), the accepted-but-ignored options, and the
 * `asyncEngine` + `.core` escape hatches.
 *
 * Events are driven through the captured listener on the fake (the real one is Comlink-proxied
 * over a worker; under test the listener is invoked directly). After each event, microtasks are
 * flushed so the `Promise.all([refresh, refreshDevtools()]).then(...)` chain settles.
 */

import type { WireActionLogEntry, WireDevtoolsState } from '@filter-enginez/worker-bridge';

import {
	type CompositeRule,
	type FilterGroup,
	type FilterRule,
	or,
	range,
	type RuleId,
	value,
} from '@filter-enginez/core';
import { afterEach, describe, expect, it } from 'vitest';

import { createSignalsEngineFromAsync } from './createSignalsEngineFromAsync.js';
import { type FakeAsyncEngine, makeFakeAsyncEngine } from './fakeAsyncEngine.js';

interface Item {
	readonly price: number;
}

const SOURCE: readonly Item[] = [{ price: 10 }, { price: 20 }, { price: 30 }];

/** Serialize a real rule into the wire shape the fake's `getRules` returns. */
function serializedRule(rule: FilterRule): FilterRule {
	return rule.serialize() as unknown as FilterRule;
}

function serializedRuleMap(entries: readonly (readonly [RuleId, FilterRule])[]): ReadonlyMap<RuleId, FilterRule> {
	const out = new Map<RuleId, FilterRule>();

	for (const [id, rule] of entries) {
		out.set(id, serializedRule(rule));
	}

	return out;
}

/**
 * Flush the parallel refresh chain. A macrotask boundary drains all queued microtasks (the
 * `Promise.all([...]).then(...)` chain plus the async getters' extra unwrap ticks), then a few
 * microtask ticks settle any continuation enqueued during the macrotask turn.
 */
async function flush(): Promise<void> {
	await new Promise((resolve) => {
		setTimeout(resolve, 0);
	});
	await Promise.resolve();
	await Promise.resolve();
}

const disposers: (() => void)[] = [];

afterEach(() => {
	while (disposers.length > 0) {
		disposers.pop()?.();
	}
});

const initialDevtoolsState: WireDevtoolsState = {
	canRedo: false,
	canUndo: false,
	currentIndex: -1,
	total: 0,
};

describe('createSignalsEngineFromAsync', () => {
	describe('initial seeding', () => {
		it('seeds every signal from the fake initial state once resolved', async () => {
			const initialLog: readonly WireActionLogEntry[] = [
				{ summary: 's', timestamp: 1, type: 'RULE_ADDED' },
			];
			const groups: readonly FilterGroup[] = [{ composition: 'or', filterIds: ['price'], id: 'g' }];
			const fake = makeFakeAsyncEngine<Item>({
				actionLog: initialLog,
				activeRuleIds: ['price'],
				devtoolsState: initialDevtoolsState,
				groups,
				resultCount: 3,
				results: SOURCE,
				rules: serializedRuleMap([['price', range('price', { max: 100, min: 0 })]]),
				sourceData: SOURCE,
			});
			const engine = await createSignalsEngineFromAsync<Item>(fake.engine);

			disposers.push(() => {
				engine.dispose();
			});

			expect(engine.results.value).toEqual(SOURCE);
			expect(engine.resultCount.value).toBe(3);
			expect(engine.sourceData.value).toEqual(SOURCE);
			expect(engine.workingSet.value).toEqual(SOURCE);
			expect(engine.activeRuleIds.value).toEqual(['price']);
			expect(engine.activeRules.value.size).toBe(1);
			// Reconstructed instance, not the bare serialized wire object.
			expect(typeof engine.activeRules.value.get('price')?.serialize).toBe('function');
			expect(engine.expression.value).toBeNull();
			expect(engine.groups.value).toEqual(groups);
			expect(engine.mode.value).toBe('flat-map');
			expect(engine.lastChangeEvent.value).toBeNull();
			expect(engine.lastChangeRuleId.value).toBeNull();
			expect(engine.lastChangeTimestamp.value).toBeNull();
			expect(engine.isDisposed).toBe(false);
		});

		it('seeds expression mode when the worker has an active expression', async () => {
			const fake = makeFakeAsyncEngine<Item>({
				devtoolsState: initialDevtoolsState,
				expression: range('price', { max: 5, min: 1 }) as unknown as CompositeRule,
				sourceData: SOURCE,
			});
			const engine = await createSignalsEngineFromAsync<Item>(fake.engine);

			disposers.push(() => {
				engine.dispose();
			});

			expect(engine.mode.value).toBe('expression');
			expect(engine.expression.value).not.toBeNull();
		});
	});

	describe('per-rule signals', () => {
		it('lazily builds per-rule signals by default and memoizes the instance', async () => {
			const fake = makeFakeAsyncEngine<Item>({
				activeRuleIds: ['price'],
				devtoolsState: initialDevtoolsState,
				rules: serializedRuleMap([['price', range('price', { max: 5, min: 1 })]]),
				sourceData: SOURCE,
			});
			const engine = await createSignalsEngineFromAsync<Item>(fake.engine);

			disposers.push(() => {
				engine.dispose();
			});

			const first = engine.rule('price');
			const second = engine.rule('price');

			expect(first).toBe(second);
			expect(typeof first.value?.serialize).toBe('function');
		});

		it('eagerly builds per-rule signals for initial rules and on rule:added', async () => {
			const fake = makeFakeAsyncEngine<Item>({
				activeRuleIds: ['price'],
				devtoolsState: initialDevtoolsState,
				rules: serializedRuleMap([['price', range('price', { max: 5, min: 1 })]]),
				sourceData: SOURCE,
			});
			const engine = await createSignalsEngineFromAsync<Item>(fake.engine, {
				eagerPerRuleSignals: true,
			});

			disposers.push(() => {
				engine.dispose();
			});

			// Initial eager build means the same memoized instance comes back.
			const initial = engine.rule('price');

			expect(engine.rule('price')).toBe(initial);

			// rule:added with eager option pre-builds the signal for the new rule.
			fake.state.activeRuleIds = ['price', 'origin'];
			fake.state.rules = serializedRuleMap([
				['price', range('price', { max: 5, min: 1 })],
				['origin', value('origin', 'a')],
			]);
			fake.emit({ rule: value('origin', 'a'), ruleId: 'origin', type: 'rule:added' });
			await flush();

			expect(engine.activeRules.value.has('origin')).toBe(true);
		});
	});

	describe('handleEvent switch', () => {
		async function setup(seed: Parameters<typeof makeFakeAsyncEngine<Item>>[0] = {}): Promise<{
			engine: Awaited<ReturnType<typeof createSignalsEngineFromAsync<Item>>>;
			fake: FakeAsyncEngine<Item>;
		}> {
			const fake = makeFakeAsyncEngine<Item>({
				devtoolsState: initialDevtoolsState,
				sourceData: SOURCE,
				...seed,
			});
			const engine = await createSignalsEngineFromAsync<Item>(fake.engine);

			disposers.push(() => {
				engine.dispose();
			});

			return { engine, fake };
		}

		it('expression event refreshes expression + results and bumps lastChange', async () => {
			const { engine, fake } = await setup();

			fake.state.expression = range('price', { max: 15, min: 5 }) as unknown as CompositeRule;
			fake.state.resultIndices = new Uint32Array([0]);
			fake.emit({
				next: fake.state.expression,
				previous: null,
				type: 'expression',
			});
			await flush();

			expect(engine.mode.value).toBe('expression');
			expect(engine.resultCount.value).toBe(1);
			expect(engine.lastChangeEvent.value?.type).toBe('expression');
			expect(engine.lastChangeTimestamp.value).not.toBeNull();
		});

		it('rehydrates the expression into a LIVE rule, not the wire object it arrives as', async () => {
			// The expression crosses the same structured-clone / JSON boundary as the rules, so what
			// arrives is a plain object with the right `.config` and no prototype. Property reads work,
			// so an un-rehydrated expression passes any test that only reads properties — and fails
			// the first consumer that calls a METHOD (e.g. keying presets by `rule.serialize()` throws
			// `rule.serialize is not a function` on the worker or server tier). The fake must therefore
			// seed a WIRE-shaped expression, exactly as it seeds wire-shaped rules two tests below;
			// `serializedRule` is what makes this test see what production sees.
			const { engine, fake } = await setup();
			const authored = or(value<number>('price', 10), value<number>('price', 20));

			fake.state.expression = serializedRule(authored) as unknown as CompositeRule;
			fake.state.resultIndices = new Uint32Array([0, 1]);
			fake.emit({ next: fake.state.expression, previous: null, type: 'expression' });
			await flush();

			const live = engine.expression.value;

			expect(live).not.toBeNull();
			expect(typeof live?.serialize, 'the expression must be a live rule instance').toBe('function');
			// Children too: a composite rebuilt only at the root leaves `config.rules` as plain objects,
			// which is the same failure one level down and the reason the registry recurses.
			expect(typeof live?.config.rules[0]?.serialize).toBe('function');
			// And it must round-trip to the SAME structure — a live instance carrying different content
			// would satisfy every assertion above and still light the wrong preset chip.
			expect(JSON.stringify(live?.serialize())).toBe(JSON.stringify(authored.serialize()));
		});

		it('falls back to the raw expression when it cannot be deserialized, and stays in expression mode', async () => {
			// `null` is the flat-map sentinel, so reporting it on a rehydration failure would tell every
			// consumer no expression is active while the engine is filtering by one. Mode is read off the
			// RAW value's presence for exactly that reason.
			const { engine, fake } = await setup();

			fake.state.expression = { config: { op: 'or', rules: []}, type: 'NoSuchRuleType' } as unknown as CompositeRule;
			fake.emit({ next: fake.state.expression, previous: null, type: 'expression' });
			await flush();

			expect(engine.expression.value).not.toBeNull();
			expect(engine.mode.value).toBe('expression');
		});

		it('results event refreshes results + count', async () => {
			const { engine, fake } = await setup();

			fake.state.resultIndices = new Uint32Array([0, 2]);
			fake.emit({ next: [], previous: [], type: 'results' });
			await flush();

			expect(engine.resultCount.value).toBe(2);
			expect(engine.lastChangeEvent.value?.type).toBe('results');
		});

		it.each(['rule:added', 'rule:changed', 'rule:removed'] as const)(
			'%s event refreshes rules + results and captures the rule id',
			async (type) => {
				const { engine, fake } = await setup();

				fake.state.activeRuleIds = ['price'];
				fake.state.rules = serializedRuleMap([['price', range('price', { max: 5, min: 1 })]]);
				fake.state.resultIndices = new Uint32Array([1]);
				const event = type === 'rule:changed'
					? {
						next: range('price', { max: 5, min: 1 }),
						previous: range('price', { max: 9, min: 1 }),
						ruleId: 'price' as RuleId,
						type,
					}
					: { rule: range('price', { max: 5, min: 1 }), ruleId: 'price' as RuleId, type };

				fake.emit(event);
				await flush();

				expect(engine.activeRuleIds.value).toEqual(['price']);
				expect(engine.lastChangeEvent.value?.type).toBe(type);
				expect(engine.lastChangeRuleId.value).toBe('price');
			},
		);

		it.each(['sourceData', 'workingSet'] as const)(
			'%s event refreshes source + derived',
			async (type) => {
				const next: readonly Item[] = [{ price: 99 }];
				const { engine, fake } = await setup();

				fake.state.sourceData = next;
				fake.state.resultIndices = new Uint32Array([0]);
				fake.emit({ next, previous: SOURCE, type });
				await flush();

				expect(engine.sourceData.value).toEqual(next);
				expect(engine.workingSet.value).toEqual(next);
				expect(engine.lastChangeEvent.value?.type).toBe(type);
			},
		);

		it('reset event refreshes everything', async () => {
			const next: readonly Item[] = [{ price: 1 }];
			const { engine, fake } = await setup();

			fake.state.sourceData = next;
			fake.state.resultIndices = new Uint32Array([0]);
			fake.emit({ type: 'reset' });
			await flush();

			expect(engine.sourceData.value).toEqual(next);
			expect(engine.lastChangeEvent.value?.type).toBe('reset');
		});

		it('ignores events at the entry guard once disposed', async () => {
			const { engine, fake } = await setup();

			engine.dispose();
			fake.state.resultIndices = new Uint32Array([0, 1, 2]);
			fake.emit({ next: [], previous: [], type: 'results' });
			await flush();

			// No lastChange bump — handleEvent returned at the entry guard.
			expect(engine.lastChangeEvent.value).toBeNull();
		});

		it('skips the lastChange bump when disposed during the parallel refresh', async () => {
			const { engine, fake } = await setup();
			let resolveIndices: ((value: Uint32Array) => void) | undefined;

			fake.engine.getResultIndices = async () =>
				new Promise<Uint32Array>((res) => {
					resolveIndices = res;
				});

			fake.emit({ next: [], previous: [], type: 'results' });
			// Dispose mid-flight, then let the awaited getter resolve.
			engine.dispose();
			resolveIndices?.(new Uint32Array([0]));
			await flush();

			expect(engine.lastChangeEvent.value).toBeNull();
		});
	});

	describe('dispose', () => {
		it('is idempotent, flips isDisposed, and calls the resolved unsubscribe', async () => {
			const fake = makeFakeAsyncEngine<Item>({
				devtoolsState: initialDevtoolsState,
				sourceData: SOURCE,
			});
			const engine = await createSignalsEngineFromAsync<Item>(fake.engine);

			// Let the subscribe promise resolve so the unsub reference is live.
			await flush();
			engine.dispose();
			engine.dispose();
			await flush();

			expect(engine.isDisposed).toBe(true);
			expect(fake.unsubscribe.callCount).toBe(1);
		});

		it('tolerates a throwing unsubscribe', async () => {
			const fake = makeFakeAsyncEngine<Item>({
				devtoolsState: initialDevtoolsState,
				sourceData: SOURCE,
			});
			const engine = await createSignalsEngineFromAsync<Item>(fake.engine);

			await flush();
			fake.makeUnsubscribeThrow();

			expect(() => {
				engine.dispose();
			}).not.toThrow();
			await flush();
			expect(fake.unsubscribe.callCount).toBe(1);
		});
	});

	describe('options + escape hatches', () => {
		it('accepts and ignores simulateCacheMax without throwing', async () => {
			const fake = makeFakeAsyncEngine<Item>({
				devtoolsState: initialDevtoolsState,
				sourceData: SOURCE,
			});
			const engine = await createSignalsEngineFromAsync<Item>(fake.engine, {
				simulateCacheMax: 999,
			});

			disposers.push(() => {
				engine.dispose();
			});

			expect(engine.resultCount.value).toBe(0);
		});

		it('exposes the underlying asyncEngine and a working .core shim', async () => {
			const fake = makeFakeAsyncEngine<Item>({
				devtoolsState: initialDevtoolsState,
				resultCount: 3,
				results: SOURCE,
				sourceData: SOURCE,
			});
			const engine = await createSignalsEngineFromAsync<Item>(fake.engine);

			disposers.push(() => {
				engine.dispose();
			});

			expect(engine.asyncEngine).toBe(fake.engine);
			// Smoke: a sync getter on the shim reads through the mirror.
			expect(engine.core.getResultCount()).toBe(3);
			expect(engine.core.getSourceData()).toEqual(SOURCE);
		});
	});
});
