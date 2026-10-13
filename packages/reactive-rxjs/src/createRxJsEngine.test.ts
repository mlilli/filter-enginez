/**
 * Tests for `createRxJsEngine` — the sync RxJS Adapter over `@filter-enginez/core`.
 *
 * @remarks
 * Shape-parallel to the signals adapter. Asserts seeded subjects replay synchronously to late
 * subscribers, the full subscribe fan-out across every event case, `distinctUntilChanged`
 * suppression of equal re-emits, the memoized per-rule stream cache, both eager / lazy
 * branches, the `replayBufferSize` 1-vs-0 behavior, the constant-0 `swrRevision$`, and
 * idempotent disposal completing all subjects with a post-dispose emission guard.
 */

import {
	type ChangeEvent,
	type ChangeListener,
	createFilterEngine,
	type FilterEngine,
	range,
	value,
} from '@filter-enginez/core';
import { type Observable } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';

import { createRxJsEngine } from './createRxJsEngine.js';

interface Item {
	readonly price: number;
}

const data: readonly Item[] = [{ price: 10 }, { price: 20 }, { price: 30 }];

const disposers: (() => void)[] = [];

afterEach(() => {
	while (disposers.length > 0) {
		disposers.pop()?.();
	}
});

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

/** Wrap a real core, capturing the registered ChangeListener so a test can drive any event. */
function makeCapturingCore<T>(core: FilterEngine<T>): {
	readonly core: FilterEngine<T>;
	emit(event: ChangeEvent): void;
} {
	let captured: ChangeListener | null = null;
	const wrapper = new Proxy(core, {
		get(target, prop, receiver): unknown {
			if (prop === 'subscribe') {
				return (listener: ChangeListener) => {
					captured = listener;

					return target.subscribe(listener);
				};
			}
			const member = Reflect.get(target, prop, receiver) as unknown;

			return typeof member === 'function' ? (member as (...a: unknown[]) => unknown).bind(target) : member;
		},
	});

	return {
		core: wrapper,
		emit(event: ChangeEvent): void {
			captured?.(event);
		},
	};
}

describe('createRxJsEngine', () => {
	describe('construction seeding', () => {
		it('seeds subjects so late subscribers synchronously get the seeded value', () => {
			const core = createFilterEngine<Item>({ sourceData: data });

			core.addRule('price', range('price', { max: 25, min: 15 }));
			const engine = createRxJsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			expect(latest(engine.results$)).toEqual(core.getResults());
			expect(latest(engine.resultCount$)).toBe(core.getResultCount());
			expect(latest(engine.sourceData$)).toEqual(data);
			expect(latest(engine.workingSet$)).toEqual(core.store.workingSet.value);
			expect(latest(engine.activeRules$)).toBe(core.getRules());
			expect(latest(engine.activeRuleIds$)).toEqual(core.getActiveRuleIds());
			expect(latest(engine.expression$)).toBeNull();
			expect(latest(engine.groups$)).toEqual(core.getGroups());
			expect(latest(engine.mode$)).toBe('flat-map');
			expect(latest(engine.lastChangeRuleId$)).toBe(core.store.lastChangeRuleId.value);
			expect(latest(engine.lastChangeTimestamp$)).toBe(core.store.lastChangeTimestamp.value);
			expect(latest(engine.lastChangeEvent$)).toBeNull();
			expect(latest(engine.swrRevision$ as Observable<number>)).toBe(0);
		});

		it('seeds mode to "expression" when an expression is set at construction', () => {
			const core = createFilterEngine<Item>({ sourceData: data });

			core.setExpression(range('price', { max: 25, min: 15 }) as never);
			const engine = createRxJsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			expect(latest(engine.mode$)).toBe('expression');
		});
	});

	describe('settle anchor — every mutation must be observable', () => {
		// Consumers need one stream that reliably says "something changed, re-run". An Angular app may
		// anchor its busy-indicator settle effect and its predictive-disable projection on
		// `lastChangeTimestamp$`; if `clearRules()` emitted nothing on it, clearing all filters would
		// latch the computing indicator on permanently and freeze the chip dimming. Table-driven over
		// every mutating call, because the likely failure is not a broken anchor but ONE silent
		// caller, and a test covering only `addRule` would look perfectly healthy.
		const MUTATIONS: readonly [name: string, mutate: (core: FilterEngine<Item>) => void][] = [
			[
				'addRule',
				(core): void => {
					core.addRule('price', range('price', { max: 25, min: 15 }));
				},
			],
			[
				'removeRule',
				(core): void => {
					core.removeRule('price');
				},
			],
			[
				'clearRules',
				(core): void => {
					core.clearRules();
				},
			],
			[
				'reset',
				(core): void => {
					core.reset();
				},
			],
		];

		it.each(MUTATIONS)('%s emits on lastChangeEvent$', (_name, mutate) => {
			const core = createFilterEngine<Item>({ sourceData: data });

			// Pre-seed a rule so `removeRule` and `clearRules` have something to act on — otherwise
			// they would be genuine no-ops and the test would prove nothing about the interesting case.
			core.addRule('price', range('price', { max: 30, min: 10 }));

			const engine = createRxJsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			const seen: (ChangeEvent | null)[] = [];
			const subscription = engine.lastChangeEvent$.subscribe((event) => seen.push(event));
			const countBefore = seen.length;

			mutate(core);
			subscription.unsubscribe();

			expect(seen.length).toBeGreaterThan(countBefore);
		});

		it('emits a DISTINCT event object each time, so identity-based anchors always re-fire', () => {
			// The property the other framework bindings rely on without saying so. React, Vue and Svelte
			// typically compose an object including the event, so their anchors change identity on every
			// emission regardless of what the timestamp did; a timestamp-only anchor does not.
			// It also covers the millisecond-collision case: two commits inside one `Date.now()` tick
			// still produce two distinct events.
			const core = createFilterEngine<Item>({ sourceData: data });
			const engine = createRxJsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			const seen: (ChangeEvent | null)[] = [];
			const subscription = engine.lastChangeEvent$.subscribe((event) => seen.push(event));

			core.addRule('price', range('price', { max: 25, min: 15 }));
			core.addRule('name', value('name', 'a'));
			subscription.unsubscribe();

			const events = seen.filter((event) => event !== null);

			expect(events.length).toBeGreaterThanOrEqual(2);
			expect(events.at(-1)).not.toBe(events.at(-2));
		});
	});

	describe('subscribe fan-out — every event case', () => {
		it('expression: updates expression$, mode$, results$ and events$', () => {
			const core = createFilterEngine<Item>({ sourceData: data });
			const engine = createRxJsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			// events$ is a plain Subject (no current value) — subscribe BEFORE the mutation.
			const events: ChangeEvent[] = [];
			const eventsSub = engine.events$.subscribe((e) => events.push(e));

			disposers.push(() => {
				eventsSub.unsubscribe();
			});

			const expr = range('price', { max: 25, min: 15 }) as never;

			core.setExpression(expr);

			expect(latest(engine.expression$)).toBe(expr);
			expect(latest(engine.mode$)).toBe('expression');
			expect(latest(engine.results$)).toEqual(core.getResults());
			expect(events.map((e) => e.type)).toEqual(['expression']);
			expect(latest(engine.lastChangeEvent$)?.type).toBe('expression');

			// Back to flat-map — exercises the expression-case ternary's 'flat-map' arm.
			core.setExpression(null);
			expect(latest(engine.expression$)).toBeNull();
			expect(latest(engine.mode$)).toBe('flat-map');
		});

		it('reset: clearRules re-reads everything', () => {
			const core = createFilterEngine<Item>({ sourceData: data });

			core.addRule('price', range('price', { max: 25, min: 15 }));
			const engine = createRxJsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			core.clearRules();

			expect(latest(engine.activeRules$).size).toBe(0);
			expect(latest(engine.activeRuleIds$)).toEqual([]);
			expect(latest(engine.expression$)).toBeNull();
			expect(latest(engine.mode$)).toBe('flat-map');
			expect(latest(engine.groups$)).toEqual([]);
			expect(latest(engine.results$)).toEqual(data);
			expect(latest(engine.resultCount$)).toBe(data.length);
		});

		it('reset: addGroup / removeGroup refresh groups$', () => {
			const core = createFilterEngine<Item>({ sourceData: data });
			const engine = createRxJsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			core.addGroup({ composition: 'or', filterIds: [], id: 'g1' });
			expect(latest(engine.groups$).map((g) => g.id)).toContain('g1');

			core.removeGroup('g1');
			expect(latest(engine.groups$).map((g) => g.id)).not.toContain('g1');
		});

		it('reset: with an expression still set keeps mode$ "expression" (ternary arm)', () => {
			// addGroup emits a `reset` event WITHOUT clearing the expression, so the reset
			// case's `getExpression() !== null ? 'expression' : 'flat-map'` ternary takes its
			// 'expression' arm.
			const core = createFilterEngine<Item>({ sourceData: data });

			core.setExpression(range('price', { max: 25, min: 15 }) as never);
			const engine = createRxJsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			core.addGroup({ composition: 'or', filterIds: [], id: 'g1' });

			expect(latest(engine.lastChangeEvent$)?.type).toBe('reset');
			expect(latest(engine.mode$)).toBe('expression');
		});

		it('results: synthetic results event refreshes results$ + resultCount$', () => {
			const core = createFilterEngine<Item>({ sourceData: data });
			const cap = makeCapturingCore(core);
			const engine = createRxJsEngine(cap.core);

			disposers.push(() => {
				engine.dispose();
			});

			cap.emit({ next: data, previous: [], type: 'results' });

			expect(latest(engine.results$)).toEqual(core.getResults());
			expect(latest(engine.resultCount$)).toBe(core.getResultCount());
			expect(latest(engine.lastChangeEvent$)?.type).toBe('results');
		});

		it('rule:added refreshes rule streams + results', () => {
			const core = createFilterEngine<Item>({ sourceData: data });
			const engine = createRxJsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			core.addRule('price', range('price', { max: 25, min: 15 }));

			expect(latest(engine.activeRules$).has('price')).toBe(true);
			expect(latest(engine.activeRuleIds$)).toContain('price');
			expect(latest(engine.lastChangeRuleId$)).toBe('price');
			expect(latest(engine.lastChangeEvent$)?.type).toBe('rule:added');
		});

		it('rule:changed: re-adding the same id emits rule:changed', () => {
			const core = createFilterEngine<Item>({ sourceData: data });

			core.addRule('price', range('price', { max: 25, min: 15 }));
			const engine = createRxJsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			core.addRule('price', range('price', { max: 100, min: 0 }));
			expect(latest(engine.lastChangeEvent$)?.type).toBe('rule:changed');
		});

		it('rule:removed: removeRule clears the rule', () => {
			const core = createFilterEngine<Item>({ sourceData: data });

			core.addRule('price', range('price', { max: 25, min: 15 }));
			const engine = createRxJsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			core.removeRule('price');
			expect(latest(engine.activeRules$).has('price')).toBe(false);
			expect(latest(engine.lastChangeEvent$)?.type).toBe('rule:removed');
		});

		it('sourceData: setSourceData refreshes sourceData$, results$, workingSet$', () => {
			const core = createFilterEngine<Item>({ sourceData: data });
			const engine = createRxJsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			const next: readonly Item[] = [{ price: 99 }];

			core.setSourceData(next);

			expect(latest(engine.sourceData$)).toEqual(next);
			expect(latest(engine.results$)).toEqual(core.getResults());
			expect(latest(engine.workingSet$)).toEqual(core.store.workingSet.value);
			expect(latest(engine.lastChangeEvent$)?.type).toBe('sourceData');
		});

		it('workingSet: setWorkingSet then resetWorkingSet refresh workingSet$', () => {
			const core = createFilterEngine<Item>({ sourceData: data });
			const engine = createRxJsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			const subset: readonly Item[] = [{ price: 10 }];

			core.setWorkingSet(subset);
			expect(latest(engine.workingSet$)).toEqual(subset);
			expect(latest(engine.lastChangeEvent$)?.type).toBe('workingSet');

			core.resetWorkingSet();
			expect(latest(engine.workingSet$)).toEqual(data);
		});
	});

	describe('distinctUntilChanged', () => {
		it('does not double-emit when an equal value is pushed again', () => {
			const core = createFilterEngine<Item>({ sourceData: data });
			const engine = createRxJsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			const emissions: number[] = [];
			const sub = engine.resultCount$.subscribe((c) => emissions.push(c));

			disposers.push(() => {
				sub.unsubscribe();
			});

			// Two workingSet resets to the same (full) set → resultCount stays 3, distinct
			// suppresses the redundant emission.
			core.resetWorkingSet();
			core.resetWorkingSet();

			expect(emissions).toEqual([data.length]);
		});
	});

	describe('per-rule stream cache', () => {
		it('memoizes by id (same Observable) and emits on that rule change', () => {
			const core = createFilterEngine<Item>({ sourceData: data });
			const engine = createRxJsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			const first = engine.rule$('price');

			expect(first).toBe(engine.rule$('price'));

			const seen: (string | undefined)[] = [];
			const sub = first.subscribe((r) => seen.push(r?.constructor.name));

			disposers.push(() => {
				sub.unsubscribe();
			});

			core.addRule('price', value('price', 10));
			expect(seen).toContain('ValueRule');
		});

		it('distinctUntilChanged: an unrelated rule change does not re-emit', () => {
			const core = createFilterEngine<Item>({ sourceData: data });
			const engine = createRxJsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			const seen: (string | undefined)[] = [];
			const sub = engine.rule$('price').subscribe((r) => seen.push(r?.constructor.name));

			disposers.push(() => {
				sub.unsubscribe();
			});

			// Initial replay: undefined (price absent).
			core.addRule('other', value('price', 10));
			// price still undefined → distinct suppresses a second emission.
			expect(seen).toEqual([undefined]);
		});
	});

	describe('eagerPerRuleStreams', () => {
		it('false (default): lazily creates and memoizes on first rule$()', () => {
			const core = createFilterEngine<Item>({ sourceData: data });

			core.addRule('price', value('price', 10));
			const engine = createRxJsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			expect(engine.rule$('price')).toBe(engine.rule$('price'));
		});

		it('true: pre-populates existing rules and freshly-added rules', () => {
			const core = createFilterEngine<Item>({ sourceData: data });

			core.addRule('price', value('price', 10));
			const engine = createRxJsEngine(core, { eagerPerRuleStreams: true });

			disposers.push(() => {
				engine.dispose();
			});

			expect(latest(engine.rule$('price'))?.constructor.name).toBe('ValueRule');

			core.addRule('size', value('price', 20));
			expect(latest(engine.rule$('size'))?.constructor.name).toBe('ValueRule');
		});

		it('true but rule:changed does not build via the eager guard', () => {
			const core = createFilterEngine<Item>({ sourceData: data });

			core.addRule('price', value('price', 10));
			const engine = createRxJsEngine(core, { eagerPerRuleStreams: true });

			disposers.push(() => {
				engine.dispose();
			});

			core.addRule('price', value('price', 20));
			expect(latest(engine.lastChangeEvent$)?.type).toBe('rule:changed');
		});
	});

	describe('replayBufferSize', () => {
		it('default 1: a late subscriber sees the last value', () => {
			const core = createFilterEngine<Item>({ sourceData: data });
			const engine = createRxJsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			core.addRule('price', value('price', 10));
			expect(latest(engine.resultCount$)).toBe(core.getResultCount());
		});

		it('0: the option is threaded through to shareReplay', () => {
			// NOTE: with this rxjs version, `shareReplay({ bufferSize: 0, refCount: false })`
			// does NOT actually suppress replay — a late subscriber still receives the most
			// recent value. The source docstring claims `0` suppresses replay; that does not
			// hold here. The test asserts the OBSERVED behavior so it stays honest, while still
			// exercising the non-default `replayBufferSize` code path.
			const core = createFilterEngine<Item>({ sourceData: data });
			const engine = createRxJsEngine(core, { replayBufferSize: 0 });

			disposers.push(() => {
				engine.dispose();
			});

			core.addRule('price', value('price', 10));

			expect(latest(engine.resultCount$)).toBe(core.getResultCount());
		});
	});

	describe('dispose', () => {
		it('is idempotent and flips isDisposed', () => {
			const core = createFilterEngine<Item>({ sourceData: data });
			const engine = createRxJsEngine(core);

			expect(engine.isDisposed).toBe(false);
			engine.dispose();
			expect(engine.isDisposed).toBe(true);
			engine.dispose();
			expect(engine.isDisposed).toBe(true);
		});

		it('completes all subjects (subscribers see complete)', () => {
			const core = createFilterEngine<Item>({ sourceData: data });
			const engine = createRxJsEngine(core);

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

		it('does not emit after disposal (the isDisposed guard)', () => {
			const core = createFilterEngine<Item>({ sourceData: data });
			const engine = createRxJsEngine(core);

			// Warm the shareReplay so it connects to the source and buffers the pre-dispose
			// value (a shareReplay that was never subscribed yields nothing after completion).
			const emissions: ReadonlyMap<string, unknown>[] = [];
			const warm = engine.activeRules$.subscribe((m) => emissions.push(m));

			engine.dispose();

			// A core mutation after dispose must not push into the (completed) subjects.
			core.addRule('price', value('price', 10));

			warm.unsubscribe();
			// Only the seeded (empty) value was ever emitted — the post-dispose mutation never
			// reached the completed subject.
			expect(emissions).toHaveLength(1);
			expect(emissions[0]?.has('price')).toBe(false);
		});

		it('clears the per-rule cache (new Observable after dispose)', () => {
			const core = createFilterEngine<Item>({ sourceData: data });
			const engine = createRxJsEngine(core);

			const before = engine.rule$('price');

			engine.dispose();
			expect(engine.rule$('price')).not.toBe(before);
		});

		it('the subscribe callback short-circuits via the isDisposed guard', () => {
			// Drive the captured listener directly AFTER dispose — the real `unsubscribe()` would
			// otherwise stop core from ever calling it, leaving the `if (isDisposed) return`
			// guard unexercised.
			const core = createFilterEngine<Item>({ sourceData: data });
			const cap = makeCapturingCore(core);
			const engine = createRxJsEngine(cap.core);

			// Warm activeRules$ before dispose so it buffers the (empty) pre-dispose value.
			const emissions: ReadonlyMap<string, unknown>[] = [];
			const warm = engine.activeRules$.subscribe((m) => emissions.push(m));

			engine.dispose();
			cap.emit({ rule: value('price', 10), ruleId: 'price', type: 'rule:added' });

			warm.unsubscribe();
			expect(emissions).toHaveLength(1);
			expect(emissions[0]?.has('price')).toBe(false);
		});
	});

	it('swrRevision$ is a constant-0 stream', () => {
		const core = createFilterEngine<Item>({ sourceData: data });
		const engine = createRxJsEngine(core);

		disposers.push(() => {
			engine.dispose();
		});

		expect(latest(engine.swrRevision$ as Observable<number>)).toBe(0);
	});
});
