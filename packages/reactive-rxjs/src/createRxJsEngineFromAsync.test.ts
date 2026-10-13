/**
 * Tests for `createRxJsEngineFromAsync` — the async factory that wraps a controllable fake
 * `FilterEngineAsync<T>` in an `RxJsEngine<T>` reactive facade.
 *
 * @remarks
 * The RxJS twin of `createSignalsEngineFromAsync`. Covers the initial-state pull + stream
 * seeding, `deserializeRules` (reconstruct + the skip-on-failure branch), the eager/lazy
 * per-rule-stream branches, the full `handleEvent` switch (every event type routed to the right
 * refresher, `projectResults` identity-vs-mapped), the post-await `checkDisposed()` guard on every
 * refresher (dispose mid-flight), idempotent disposal (subject completion + throwing-unsubscribe
 * tolerance + post-dispose emission guard), the `asyncEngine` escape hatch, and the `simulate()`
 * throw (chip exclusion rides the `applyFiltersAndQuery` bundle).
 *
 * Events are driven through the captured listener on the fake (the real one is Comlink-proxied
 * over a worker; under test it is invoked directly). After each event, microtasks are flushed so
 * the `void refresh.then(...)` chain settles.
 */

import {
	type ChangeEvent,
	type CompositeRule,
	type FilterGroup,
	type FilterRule,
	or,
	range,
	type RuleId,
	value,
} from '@filter-enginez/core';
import { type Observable } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';

import { createRxJsEngineFromAsync } from './createRxJsEngineFromAsync.js';
import { type FakeAsyncEngine, makeFakeAsyncEngine } from './fakeAsyncEngine.js';

interface Item {
	readonly price: number;
}

const SOURCE: readonly Item[] = [{ price: 10 }, { price: 20 }, { price: 30 }];

const NO_VALUE = Symbol('no-value');

/** Synchronously capture the latest value a shareReplay(1) stream replays on subscribe. */
function latest<V>(stream: Observable<V>): V {
	let captured: V | typeof NO_VALUE = NO_VALUE;
	const sub = stream.subscribe((v) => {
		captured = v;
	});

	sub.unsubscribe();
	if (captured === NO_VALUE) {
		throw new Error('stream did not replay a value synchronously');
	}

	return captured;
}

/**
 * Flush the fire-and-forget refresh chain: a macrotask boundary drains queued microtasks (the
 * async getters + the `void refresh.then(...)` continuation), then a few microtask ticks settle
 * any continuation enqueued during the macrotask turn.
 */
async function flush(): Promise<void> {
	await new Promise((resolve) => {
		setTimeout(resolve, 0);
	});
	await Promise.resolve();
	await Promise.resolve();
}

/** Serialize a real rule into the wire shape the fake's `getRules` returns. */
function serializedRuleMap(
	entries: readonly (readonly [RuleId, FilterRule])[],
): ReadonlyMap<RuleId, FilterRule> {
	const out = new Map<RuleId, FilterRule>();

	for (const [id, rule] of entries) {
		out.set(id, rule.serialize() as unknown as FilterRule);
	}

	return out;
}

const disposers: (() => void)[] = [];

afterEach(() => {
	while (disposers.length > 0) {
		disposers.pop()?.();
	}
});

describe('createRxJsEngineFromAsync', () => {
	describe('initial seeding', () => {
		it('seeds every stream from the fake initial state once resolved', async () => {
			const groups: readonly FilterGroup[] = [{ composition: 'or', filterIds: ['price'], id: 'g' }];
			const fake = makeFakeAsyncEngine<Item>({
				activeRuleIds: ['price'],
				groups,
				resultCount: 3,
				results: SOURCE,
				rules: serializedRuleMap([['price', range('price', { max: 100, min: 0 })]]),
				sourceData: SOURCE,
			});
			const engine = await createRxJsEngineFromAsync<Item>(fake.engine);

			disposers.push(() => {
				engine.dispose();
			});

			expect(latest(engine.results$)).toEqual(SOURCE);
			expect(latest(engine.resultCount$)).toBe(3);
			expect(latest(engine.sourceData$)).toEqual(SOURCE);
			expect(latest(engine.workingSet$)).toEqual(SOURCE);
			expect(latest(engine.activeRuleIds$)).toEqual(['price']);
			expect(latest(engine.activeRules$).size).toBe(1);
			// Reconstructed instance, not the bare serialized wire object.
			expect(typeof latest(engine.activeRules$).get('price')?.serialize).toBe('function');
			expect(latest(engine.expression$)).toBeNull();
			expect(latest(engine.groups$)).toEqual(groups);
			expect(latest(engine.mode$)).toBe('flat-map');
			expect(latest(engine.lastChangeEvent$)).toBeNull();
			expect(latest(engine.lastChangeRuleId$)).toBeNull();
			expect(latest(engine.lastChangeTimestamp$)).toBeNull();
			expect(engine.isDisposed).toBe(false);
		});

		it('exposes the wrapped async engine via the asyncEngine escape hatch', async () => {
			const fake = makeFakeAsyncEngine<Item>({ sourceData: SOURCE });
			const engine = await createRxJsEngineFromAsync<Item>(fake.engine);

			disposers.push(() => {
				engine.dispose();
			});

			// The escape hatch points at the wrapped worker engine — consumers reach for
			// `applyFiltersAndQuery` / other async-only methods through it.
			expect(engine.asyncEngine).toBe(fake.engine);
		});

		it('throws from core.simulate() pointing at the async surface + bundle', async () => {
			const fake = makeFakeAsyncEngine<Item>({ sourceData: SOURCE });
			const engine = await createRxJsEngineFromAsync<Item>(fake.engine);

			disposers.push(() => {
				engine.dispose();
			});

			// No synchronous simulate on a worker-backed engine: the shim throws with a pointer.
			expect(() => engine.core.simulate({})).toThrow(/not available on worker-backed engines/);
			expect(() => engine.core.simulate({})).toThrow(/applyFiltersAndQuery/);
		});

		it('seeds expression mode when the worker has an active expression', async () => {
			const fake = makeFakeAsyncEngine<Item>({
				expression: range('price', { max: 5, min: 1 }) as unknown as CompositeRule,
				sourceData: SOURCE,
			});
			const engine = await createRxJsEngineFromAsync<Item>(fake.engine);

			disposers.push(() => {
				engine.dispose();
			});

			expect(latest(engine.mode$)).toBe('expression');
			expect(latest(engine.expression$)).not.toBeNull();
		});

		it('skips rules that fail to deserialize, keeping the good ones', async () => {
			const rules = new Map<RuleId, FilterRule>([
				['price', range('price', { max: 5, min: 1 }).serialize() as unknown as FilterRule],
				['bad', { config: {}, field: 'x', type: 'NopeRule' } as unknown as FilterRule],
			]);
			const fake = makeFakeAsyncEngine<Item>({
				activeRuleIds: ['price', 'bad'],
				rules,
				sourceData: SOURCE,
			});
			const engine = await createRxJsEngineFromAsync<Item>(fake.engine);

			disposers.push(() => {
				engine.dispose();
			});

			const active = latest(engine.activeRules$);

			expect(active.has('price')).toBe(true);
			expect(active.has('bad')).toBe(false);
			expect(active.size).toBe(1);
		});
	});

	describe('expression rehydration', () => {
		/**
		 * A live preset expression, and the wire form the worker actually returns.
		 *
		 * @returns Both shapes.
		 */
		function presetShapes(): { live: CompositeRule; wire: CompositeRule } {
			const live = or(range('price', { max: 100, min: 0 }), range('price', { max: 500, min: 400 }));

			return { live, wire: JSON.parse(JSON.stringify(live.serialize())) as CompositeRule };
		}

		it('rebuilds a WIRE-SHAPED expression into a rule with serialize()', async () => {
			// Why this exists: a plain `{ type, config }` satisfies `CompositeRule` structurally for
			// every read a consumer is likely to make — but it has no `serialize()`, and any consumer
			// identifying an expression by its serialized shape (preset chips, for instance) would
			// silently see nothing.
			const { wire } = presetShapes();
			const fake = makeFakeAsyncEngine<Item>({ expression: wire, results: SOURCE, sourceData: SOURCE });
			const engine = await createRxJsEngineFromAsync<Item>(fake.engine);

			disposers.push(() => {
				engine.dispose();
			});

			const seeded = latest(engine.expression$);

			expect(typeof seeded?.serialize).toBe('function');
			expect(seeded?.serialize()).toEqual(wire);
		});

		it('passes an already-live expression through untouched', async () => {
			const { live } = presetShapes();
			const fake = makeFakeAsyncEngine<Item>({ expression: live, results: SOURCE, sourceData: SOURCE });
			const engine = await createRxJsEngineFromAsync<Item>(fake.engine);

			disposers.push(() => {
				engine.dispose();
			});

			expect(latest(engine.expression$)).toBe(live);
		});

		it('falls back to the RAW expression when the registry cannot rebuild it', async () => {
			// **Raw, not `null` — deliberately.** Publishing `null` might seem safer, since every
			// consumer handles the absent case and none handles a rule that cannot answer
			// `serialize()`. But `null` is the FLAT-MAP SENTINEL, so reporting it tells every
			// consumer that no expression is active while the engine is filtering by one — and
			// nothing downstream can tell that apart from a genuinely empty expression.
			//
			// The raw wire object still reads correctly for property access, which is what every
			// consumer but `serialize()` actually does. The signals adapter shares this behavior
			// through the same rehydrator.
			const unknownType = { config: {}, type: '__not-registered__' } as unknown as CompositeRule;
			const fake = makeFakeAsyncEngine<Item>({
				expression: unknownType,
				results: SOURCE,
				sourceData: SOURCE,
			});
			const engine = await createRxJsEngineFromAsync<Item>(fake.engine);

			disposers.push(() => {
				engine.dispose();
			});

			// Identity, not shape: the mirror must publish the value it was handed, un-mangled.
			expect(latest(engine.expression$)).toBe(unknownType);
			// And emphatically NOT null, which would silently misreport the engine's mode.
			expect(latest(engine.expression$)).not.toBeNull();
		});

		it('seeds a null expression as null', async () => {
			const fake = makeFakeAsyncEngine<Item>({ expression: null, results: SOURCE, sourceData: SOURCE });
			const engine = await createRxJsEngineFromAsync<Item>(fake.engine);

			disposers.push(() => {
				engine.dispose();
			});

			expect(latest(engine.expression$)).toBeNull();
		});
	});

	describe('per-rule streams', () => {
		it('lazily builds and memoizes the same Observable per id', async () => {
			const fake = makeFakeAsyncEngine<Item>({ sourceData: SOURCE });
			const engine = await createRxJsEngineFromAsync<Item>(fake.engine);

			disposers.push(() => {
				engine.dispose();
			});

			expect(engine.rule$('price')).toBe(engine.rule$('price'));
		});

		it('eagerly builds per-rule streams for initial rules and on rule:added', async () => {
			const fake = makeFakeAsyncEngine<Item>({
				activeRuleIds: ['price'],
				rules: serializedRuleMap([['price', range('price', { max: 5, min: 1 })]]),
				sourceData: SOURCE,
			});
			const engine = await createRxJsEngineFromAsync<Item>(fake.engine, {
				eagerPerRuleStreams: true,
			});

			disposers.push(() => {
				engine.dispose();
			});

			const initial = engine.rule$('price');

			expect(engine.rule$('price')).toBe(initial);

			fake.state.activeRuleIds = ['price', 'origin'];
			fake.state.rules = serializedRuleMap([
				['price', range('price', { max: 5, min: 1 })],
				['origin', value('origin', 'a')],
			]);
			fake.emit({ rule: value('origin', 'a'), ruleId: 'origin', type: 'rule:added' });
			await flush();

			expect(latest(engine.activeRules$).has('origin')).toBe(true);
			expect(typeof latest(engine.rule$('origin'))?.serialize).toBe('function');
		});
	});

	describe('handleEvent switch', () => {
		async function setup(seed: Parameters<typeof makeFakeAsyncEngine<Item>>[0] = {}): Promise<{
			engine: Awaited<ReturnType<typeof createRxJsEngineFromAsync<Item>>>;
			fake: FakeAsyncEngine<Item>;
		}> {
			const fake = makeFakeAsyncEngine<Item>({ sourceData: SOURCE, ...seed });
			const engine = await createRxJsEngineFromAsync<Item>(fake.engine);

			disposers.push(() => {
				engine.dispose();
			});

			return { engine, fake };
		}

		it('expression event refreshes expression + mode + results', async () => {
			const { engine, fake } = await setup();

			fake.state.expression = range('price', { max: 15, min: 5 }) as unknown as CompositeRule;
			fake.state.resultIndices = new Uint32Array([0]);
			fake.emit({ next: fake.state.expression, previous: null, type: 'expression' });
			await flush();

			expect(latest(engine.mode$)).toBe('expression');
			expect(latest(engine.expression$)).not.toBeNull();
			expect(latest(engine.resultCount$)).toBe(1);
			expect(latest(engine.lastChangeEvent$)?.type).toBe('expression');
			expect(latest(engine.lastChangeTimestamp$)).not.toBeNull();
		});

		it('expression event that clears the expression refreshes mode back to flat-map', async () => {
			const { engine, fake } = await setup({
				expression: range('price', { max: 5, min: 1 }) as unknown as CompositeRule,
			});

			expect(latest(engine.mode$)).toBe('expression');

			// The worker cleared the expression -> getExpression() now returns null -> flat-map arm.
			fake.state.expression = null;
			fake.state.resultIndices = new Uint32Array([0]);
			fake.emit({ next: null, previous: null, type: 'expression' });
			await flush();

			expect(latest(engine.mode$)).toBe('flat-map');
			expect(latest(engine.expression$)).toBeNull();
		});

		it('results event with a subset refreshes results via the mapped projection', async () => {
			const { engine, fake } = await setup();

			fake.state.resultIndices = new Uint32Array([0, 2]);
			fake.emit({ next: [], previous: [], type: 'results' });
			await flush();

			expect(latest(engine.results$)).toEqual([SOURCE[0], SOURCE[2]]);
			expect(latest(engine.resultCount$)).toBe(2);
			expect(latest(engine.lastChangeEvent$)?.type).toBe('results');
		});

		it('results event with full-length indices takes the identity fast-path', async () => {
			const { engine, fake } = await setup();

			fake.state.resultIndices = new Uint32Array([0, 1, 2]);
			fake.emit({ next: [], previous: [], type: 'results' });
			await flush();

			expect(latest(engine.results$)).toEqual(SOURCE);
			expect(latest(engine.resultCount$)).toBe(3);
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

				expect(latest(engine.activeRuleIds$)).toEqual(['price']);
				expect(latest(engine.lastChangeEvent$)?.type).toBe(type);
				expect(latest(engine.lastChangeRuleId$)).toBe('price');
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

				expect(latest(engine.sourceData$)).toEqual(next);
				expect(latest(engine.workingSet$)).toEqual(next);
				expect(latest(engine.lastChangeEvent$)?.type).toBe(type);
			},
		);

		it('reset event refreshes everything', async () => {
			const next: readonly Item[] = [{ price: 1 }];
			const { engine, fake } = await setup();

			fake.state.sourceData = next;
			fake.state.groups = [{ composition: 'or', filterIds: [], id: 'g' }];
			fake.state.resultIndices = new Uint32Array([0]);
			fake.emit({ type: 'reset' });
			await flush();

			expect(latest(engine.sourceData$)).toEqual(next);
			expect(latest(engine.groups$).map((g) => g.id)).toEqual(['g']);
			expect(latest(engine.lastChangeEvent$)?.type).toBe('reset');
		});

		it('reset event with an active expression refreshes mode to expression', async () => {
			const { engine, fake } = await setup();

			// A reset where the worker now has an expression -> refreshEverything hits the
			// `ex !== null` arm of the mode ternary (the flat-map reset above covers the other side).
			fake.state.expression = range('price', { max: 5, min: 1 }) as unknown as CompositeRule;
			fake.state.resultIndices = new Uint32Array([0]);
			fake.emit({ type: 'reset' });
			await flush();

			expect(latest(engine.mode$)).toBe('expression');
			expect(latest(engine.expression$)).not.toBeNull();
		});

		it('ignores events at the entry guard once disposed', async () => {
			const { engine, fake } = await setup();
			// Subscribe before disposal — a late subscriber to the completed subject gets no replay.
			const seen: unknown[] = [];
			const sub = engine.lastChangeEvent$.subscribe((e) => seen.push(e));

			engine.dispose();
			fake.state.resultIndices = new Uint32Array([0, 1, 2]);
			fake.emit({ next: [], previous: [], type: 'results' });
			await flush();

			sub.unsubscribe();
			// Only the seeded null ever emitted — handleEvent returned at the entry guard.
			expect(seen).toEqual([null]);
		});

		const disposeMidFlightCases: { event: ChangeEvent; label: string }[] = [
			{ event: { next: null, previous: null, type: 'expression' }, label: 'expression' },
			{ event: { next: [], previous: [], type: 'results' }, label: 'results' },
			{ event: { rule: value('price', 1), ruleId: 'price', type: 'rule:added' }, label: 'rule:added' },
			{ event: { next: [], previous: [], type: 'sourceData' }, label: 'sourceData' },
			{ event: { type: 'reset' }, label: 'reset' },
		];

		it.each(disposeMidFlightCases)(
			'short-circuits the $label refresh when disposed mid-flight (post-await guard)',
			async ({ event }) => {
				const { engine, fake } = await setup();
				const seen: unknown[] = [];
				const sub = engine.lastChangeEvent$.subscribe((e) => seen.push(e));
				let resolveIndices: ((value: Uint32Array) => void) | undefined;

				// Every refresher awaits getResultIndices (alone or inside a Promise.all), so hanging
				// it lets us flip isDisposed while the refresh is in flight -> the post-await
				// checkDisposed() short-circuits before any mirror .next() (or lastChange bump).
				fake.engine.getResultIndices = async () =>
					new Promise<Uint32Array>((res) => {
						resolveIndices = res;
					});

				fake.emit(event);
				engine.dispose();
				resolveIndices?.(new Uint32Array([0]));
				await flush();

				sub.unsubscribe();
				// Only the seeded null — the refresh short-circuited, so no lastChange bump.
				expect(seen).toEqual([null]);
			},
		);
	});

	describe('dispose', () => {
		it('is idempotent, flips isDisposed, and calls the resolved unsubscribe', async () => {
			const fake = makeFakeAsyncEngine<Item>({ sourceData: SOURCE });
			const engine = await createRxJsEngineFromAsync<Item>(fake.engine);

			await flush();
			engine.dispose();
			engine.dispose();
			await flush();

			expect(engine.isDisposed).toBe(true);
			expect(fake.unsubscribe.callCount).toBe(1);
		});

		it('completes all subjects', async () => {
			const fake = makeFakeAsyncEngine<Item>({ sourceData: SOURCE });
			const engine = await createRxJsEngineFromAsync<Item>(fake.engine);

			let didComplete = false;
			const sub = engine.results$.subscribe({
				complete(): void {
					didComplete = true;
				},
			});

			disposers.push(() => {
				sub.unsubscribe();
			});

			engine.dispose();
			expect(didComplete).toBe(true);
		});

		it('tolerates a throwing unsubscribe', async () => {
			const fake = makeFakeAsyncEngine<Item>({ sourceData: SOURCE });
			const engine = await createRxJsEngineFromAsync<Item>(fake.engine);

			await flush();
			fake.makeUnsubscribeThrow();

			expect(() => {
				engine.dispose();
			}).not.toThrow();
			await flush();
			expect(fake.unsubscribe.callCount).toBe(1);
		});

		it('does not push into the completed subjects after disposal', async () => {
			const { engine, fake } = await (async () => {
				const f = makeFakeAsyncEngine<Item>({ sourceData: SOURCE });
				const e = await createRxJsEngineFromAsync<Item>(f.engine);

				return { engine: e, fake: f };
			})();

			const emissions: number[] = [];
			const warm = engine.resultCount$.subscribe((c) => emissions.push(c));

			engine.dispose();
			fake.state.resultIndices = new Uint32Array([0, 1, 2]);
			fake.emit({ next: [], previous: [], type: 'results' });
			await flush();

			warm.unsubscribe();
			// Only the seeded (0) value ever reached the completed subject.
			expect(emissions).toEqual([0]);
		});
	});
});
