/**
 * Tests for `createSignalsEngine` — the sync signals Adapter over `@filter-enginez/core`.
 *
 * @remarks
 * Drives REAL core mutations through the subscribe fan-out and asserts that every affected
 * signal updates (and unaffected ones don't). Covers every `case` in the event switch, the
 * memoized per-rule signal cache, both eager / lazy branches, the constant-0 `swrRevision`
 * signal, and idempotent disposal with the post-dispose update guard. The synthetic `results`
 * event (no public mutation emits a bare `'results'` event) is driven by capturing the
 * registered `ChangeListener` via a transparent core wrapper so the real switch branch runs.
 */

import {
	type ChangeEvent,
	type ChangeListener,
	createFilterEngine,
	type FilterEngine,
	range,
	value,
} from '@filter-enginez/core';
import { effect } from '@preact/signals-core';
import { afterEach, describe, expect, it } from 'vitest';

import { createSignalsEngine } from './createSignalsEngine.js';

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

/**
 * Wrap a real core, capturing the `ChangeListener` the adapter registers so a test can drive
 * arbitrary `ChangeEvent`s (notably the `'results'` event no public mutation emits directly).
 */
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

describe('createSignalsEngine', () => {
	describe('construction seeding', () => {
		it('seeds every signal from the core current state', () => {
			const core = createFilterEngine<Item>({ sourceData: data });

			core.addRule('price', range('price', { max: 25, min: 15 }));
			const engine = createSignalsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			expect(engine.results.value).toEqual(core.getResults());
			expect(engine.resultCount.value).toBe(core.getResultCount());
			expect(engine.sourceData.value).toEqual(data);
			expect(engine.workingSet.value).toEqual(core.store.workingSet.value);
			expect(engine.activeRules.value).toBe(core.getRules());
			expect(engine.activeRuleIds.value).toEqual(core.getActiveRuleIds());
			expect(engine.expression.value).toBeNull();
			expect(engine.groups.value).toEqual(core.getGroups());
			expect(engine.mode.value).toBe('flat-map');
			expect(engine.lastChangeRuleId.value).toBe(core.store.lastChangeRuleId.value);
			expect(engine.lastChangeTimestamp.value).toBe(core.store.lastChangeTimestamp.value);
			expect(engine.lastChangeEvent.value).toBeNull();
			expect(engine.swrRevision?.value).toBe(0);
		});

		it('seeds mode to "expression" when an expression is set at construction', () => {
			const core = createFilterEngine<Item>({ sourceData: data });

			core.setExpression(range('price', { max: 25, min: 15 }) as never);
			const engine = createSignalsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			expect(engine.mode.value).toBe('expression');
			expect(engine.expression.value).not.toBeNull();
		});
	});

	describe('subscribe fan-out — every event case', () => {
		it('expression: setExpression updates expression, mode, results, lastChangeEvent', () => {
			const core = createFilterEngine<Item>({ sourceData: data });
			const engine = createSignalsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			const expr = range('price', { max: 25, min: 15 }) as never;

			core.setExpression(expr);

			expect(engine.expression.value).toBe(expr);
			expect(engine.mode.value).toBe('expression');
			expect(engine.results.value).toEqual(core.getResults());
			expect(engine.resultCount.value).toBe(core.getResultCount());
			expect(engine.lastChangeEvent.value?.type).toBe('expression');

			core.setExpression(null);
			expect(engine.expression.value).toBeNull();
			expect(engine.mode.value).toBe('flat-map');
		});

		it('reset: clearRules re-reads everything', () => {
			const core = createFilterEngine<Item>({ sourceData: data });

			core.addRule('price', range('price', { max: 25, min: 15 }));
			const engine = createSignalsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			core.clearRules();

			expect(engine.activeRules.value.size).toBe(0);
			expect(engine.activeRuleIds.value).toEqual([]);
			expect(engine.expression.value).toBeNull();
			expect(engine.mode.value).toBe('flat-map');
			expect(engine.groups.value).toEqual([]);
			expect(engine.results.value).toEqual(data);
			expect(engine.resultCount.value).toBe(data.length);
			expect(engine.lastChangeEvent.value?.type).toBe('reset');
		});

		it('reset: addGroup / removeGroup emit reset and refresh groups', () => {
			const core = createFilterEngine<Item>({ sourceData: data });
			const engine = createSignalsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			core.addGroup({ composition: 'or', filterIds: [], id: 'g1' });
			expect(engine.groups.value.map((g) => g.id)).toContain('g1');
			expect(engine.lastChangeEvent.value?.type).toBe('reset');

			core.removeGroup('g1');
			expect(engine.groups.value.map((g) => g.id)).not.toContain('g1');
		});

		it('reset: with an expression still set keeps mode "expression" (ternary arm)', () => {
			// addGroup emits a `reset` event WITHOUT clearing the expression, so the reset
			// case's `getExpression() !== null ? 'expression' : 'flat-map'` ternary takes its
			// 'expression' arm.
			const core = createFilterEngine<Item>({ sourceData: data });

			core.setExpression(range('price', { max: 25, min: 15 }) as never);
			const engine = createSignalsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			core.addGroup({ composition: 'or', filterIds: [], id: 'g1' });

			expect(engine.lastChangeEvent.value?.type).toBe('reset');
			expect(engine.mode.value).toBe('expression');
		});

		it('reset: reset() restores defaults', () => {
			const core = createFilterEngine<Item>({ sourceData: data });

			core.addRule('price', range('price', { max: 25, min: 15 }));
			const engine = createSignalsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			core.reset();

			expect(engine.activeRules.value.size).toBe(0);
			expect(engine.lastChangeEvent.value?.type).toBe('reset');
		});

		it('reset: devtools.undo()/redo() refresh the facade (time-travel emits reset)', () => {
			// `engine.core.devtools.undo()` restores the store directly (the path the keyboard
			// shortcut + devtools panel drive), bypassing the dispatcher. If it emitted nothing, the
			// facade's active-rule / expression signals would stay stale and filter chips would never
			// clear. TimeTravel emits a `reset`, which this fan-out re-reads wholesale.
			const core = createFilterEngine<Item>({ sourceData: data });
			const engine = createSignalsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			core.addRule('price', range('price', { max: 25, min: 15 }));
			expect(engine.activeRules.value.size).toBe(1);
			const filteredCount = engine.resultCount.value;

			core.devtools.undo();

			expect(engine.activeRules.value.size).toBe(0);
			expect(engine.activeRuleIds.value).toEqual([]);
			expect(engine.results.value).toEqual(data);
			expect(engine.resultCount.value).toBe(data.length);
			expect(engine.lastChangeEvent.value?.type).toBe('reset');

			core.devtools.redo();

			expect(engine.activeRules.value.size).toBe(1);
			expect(engine.resultCount.value).toBe(filteredCount);
		});

		it('results: synthetic results event refreshes results + resultCount', () => {
			const core = createFilterEngine<Item>({ sourceData: data });
			const cap = makeCapturingCore(core);
			const engine = createSignalsEngine(cap.core);

			disposers.push(() => {
				engine.dispose();
			});

			cap.emit({ next: data, previous: [], type: 'results' });

			expect(engine.results.value).toEqual(core.getResults());
			expect(engine.resultCount.value).toBe(core.getResultCount());
			expect(engine.lastChangeEvent.value?.type).toBe('results');
		});

		it('rule:added: addRule (new) refreshes rule signals + results', () => {
			const core = createFilterEngine<Item>({ sourceData: data });
			const engine = createSignalsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			core.addRule('price', range('price', { max: 25, min: 15 }));

			expect(engine.activeRules.value.has('price')).toBe(true);
			expect(engine.activeRuleIds.value).toContain('price');
			expect(engine.lastChangeRuleId.value).toBe('price');
			expect(engine.lastChangeTimestamp.value).not.toBeNull();
			expect(engine.results.value).toEqual(core.getResults());
			expect(engine.lastChangeEvent.value?.type).toBe('rule:added');
		});

		it('rule:changed: re-adding the same id emits rule:changed', () => {
			const core = createFilterEngine<Item>({ sourceData: data });

			core.addRule('price', range('price', { max: 25, min: 15 }));
			const engine = createSignalsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			core.addRule('price', range('price', { max: 100, min: 0 }));

			expect(engine.lastChangeEvent.value?.type).toBe('rule:changed');
			expect(engine.results.value).toEqual(data);
		});

		it('rule:removed: removeRule clears the rule from the signals', () => {
			const core = createFilterEngine<Item>({ sourceData: data });

			core.addRule('price', range('price', { max: 25, min: 15 }));
			const engine = createSignalsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			core.removeRule('price');

			expect(engine.activeRules.value.has('price')).toBe(false);
			expect(engine.lastChangeEvent.value?.type).toBe('rule:removed');
		});

		it('sourceData: setSourceData refreshes sourceData, results, workingSet', () => {
			const core = createFilterEngine<Item>({ sourceData: data });
			const engine = createSignalsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			const next: readonly Item[] = [{ price: 99 }];

			core.setSourceData(next);

			expect(engine.sourceData.value).toEqual(next);
			expect(engine.results.value).toEqual(core.getResults());
			expect(engine.workingSet.value).toEqual(core.store.workingSet.value);
			expect(engine.lastChangeEvent.value?.type).toBe('sourceData');
		});

		it('workingSet: setWorkingSet then resetWorkingSet refresh the working set', () => {
			const core = createFilterEngine<Item>({ sourceData: data });
			const engine = createSignalsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			const subset: readonly Item[] = [{ price: 10 }];

			core.setWorkingSet(subset);
			expect(engine.workingSet.value).toEqual(subset);
			expect(engine.results.value).toEqual(core.getResults());
			expect(engine.lastChangeEvent.value?.type).toBe('workingSet');

			core.resetWorkingSet();
			expect(engine.workingSet.value).toEqual(data);
		});
	});

	describe('per-rule signal cache', () => {
		it('memoizes by id (same instance) and tracks the rule value', () => {
			const core = createFilterEngine<Item>({ sourceData: data });
			const engine = createSignalsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			const first = engine.rule('price');
			const second = engine.rule('price');

			expect(first).toBe(second);

			expect(first.value).toBeUndefined();
			const rule = range('price', { max: 25, min: 15 });

			core.addRule('price', rule);
			expect(first.value).toBe(rule);
		});

		it('returns undefined for an absent id', () => {
			const core = createFilterEngine<Item>({ sourceData: data });
			const engine = createSignalsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			expect(engine.rule('nope').value).toBeUndefined();
		});

		it('the per-rule signal drives an effect on change', () => {
			const core = createFilterEngine<Item>({ sourceData: data });
			const engine = createSignalsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			const seen: (string | undefined)[] = [];
			const stop = effect(() => {
				const rule = engine.rule('price').value;

				seen.push(rule?.constructor.name);
			});

			disposers.push(stop);

			core.addRule('price', value('price', 10));
			expect(seen).toContain('ValueRule');
		});
	});

	describe('eagerPerRuleSignals', () => {
		it('false (default): does not pre-populate; lazily creates on first rule()', () => {
			const core = createFilterEngine<Item>({ sourceData: data });

			core.addRule('price', value('price', 10));
			const engine = createSignalsEngine(core);

			disposers.push(() => {
				engine.dispose();
			});

			// Lazy creation still memoizes once accessed.
			expect(engine.rule('price')).toBe(engine.rule('price'));
		});

		it('true: pre-populates existing rules at construction and on rule:added', () => {
			const core = createFilterEngine<Item>({ sourceData: data });

			core.addRule('price', value('price', 10));
			const engine = createSignalsEngine(core, { eagerPerRuleSignals: true });

			disposers.push(() => {
				engine.dispose();
			});

			// Pre-populated: the cached signal already reflects the existing rule.
			expect(engine.rule('price').value?.constructor.name).toBe('ValueRule');

			// rule:added eager path: a freshly-added rule gets a pre-built signal too.
			core.addRule('size', value('price', 20));
			expect(engine.rule('size').value?.constructor.name).toBe('ValueRule');
		});

		it('true but a non-added rule event does NOT build via the eager guard', () => {
			const core = createFilterEngine<Item>({ sourceData: data });

			core.addRule('price', value('price', 10));
			const engine = createSignalsEngine(core, { eagerPerRuleSignals: true });

			disposers.push(() => {
				engine.dispose();
			});

			// rule:changed is not rule:added — guard's left arm is false.
			core.addRule('price', value('price', 20));
			expect(engine.lastChangeEvent.value?.type).toBe('rule:changed');
		});
	});

	describe('dispose', () => {
		it('is idempotent and flips isDisposed', () => {
			const core = createFilterEngine<Item>({ sourceData: data });
			const engine = createSignalsEngine(core);

			expect(engine.isDisposed).toBe(false);
			engine.dispose();
			expect(engine.isDisposed).toBe(true);
			// Second call is a no-op (does not throw).
			engine.dispose();
			expect(engine.isDisposed).toBe(true);
		});

		it('stops updating signals after disposal (the isDisposed guard)', () => {
			const core = createFilterEngine<Item>({ sourceData: data });
			const engine = createSignalsEngine(core);

			engine.dispose();
			core.addRule('price', value('price', 10));

			expect(engine.activeRules.value.has('price')).toBe(false);
			expect(engine.lastChangeEvent.value).toBeNull();
		});

		it('clears the per-rule cache (new signal instance after dispose)', () => {
			const core = createFilterEngine<Item>({ sourceData: data });
			const engine = createSignalsEngine(core);

			const before = engine.rule('price');

			engine.dispose();
			const after = engine.rule('price');

			expect(after).not.toBe(before);
		});

		it('the subscribe callback short-circuits via the isDisposed guard', () => {
			// Drive the captured listener directly AFTER dispose — the real `unsubscribe()` would
			// otherwise stop core from ever calling it, leaving the `if (isDisposed) return`
			// guard unexercised.
			const core = createFilterEngine<Item>({ sourceData: data });
			const cap = makeCapturingCore(core);
			const engine = createSignalsEngine(cap.core);

			engine.dispose();
			cap.emit({ rule: value('price', 10), ruleId: 'price', type: 'rule:added' });

			expect(engine.activeRules.value.has('price')).toBe(false);
			expect(engine.lastChangeEvent.value).toBeNull();
		});
	});

	it('swrRevision is a constant-0 signal', () => {
		const core = createFilterEngine<Item>({ sourceData: data });
		const engine = createSignalsEngine(core);

		disposers.push(() => {
			engine.dispose();
		});

		expect(engine.swrRevision?.value).toBe(0);
		core.addRule('price', value('price', 10));
		expect(engine.swrRevision?.value).toBe(0);
	});
});
