/**
 * Tests for `InternalStore` — the engine's signal-tree state container.
 *
 * @remarks
 * Covers the constructor defaults, every writable signal's reactivity, and all branches of the
 * derived (`computed`) signals:
 *   - `mode` — both 'flat-map' and 'expression'
 *   - `activeRuleIds` — keys projection, reactive to rule changes
 *   - `effectiveExpression` — expression-mode (simplified), empty-rules, single-rule, multi-rule
 *     AND-compose, and filter groups (OR within, AND between, unregistered ids skipped)
 *   - the results accelerator — used when it answers, bypassed when it declines or is removed
 *   - `resultIndices` — identity (contiguous 0..n) and filtered (Uint32Array of matches)
 *   - `results` — identity referential-stability fast-path and projected-array path, with the
 *     `results[i] === workingSet[resultIndices[i]]` invariant asserted
 *   - `resultCount` — derived from `resultIndices.length`
 * Signals are read via `.value` (pull); subscription propagation is verified with `effect`.
 */

import { effect } from '@preact/signals-core';
import { afterEach, describe, expect, it } from 'vitest';

import { CompositeRule } from '../rules/CompositeRule.js';
import { PredicateRule } from '../rules/PredicateRule.js';
import { InternalStore } from './InternalStore.js';

const disposers: (() => void)[] = [];

afterEach(() => {
	while (disposers.length > 0) {
		disposers.pop()?.();
	}
});

interface Item {
	readonly price: number;
}

function priceAbove(threshold: number): PredicateRule<Item> {
	return new PredicateRule<Item>('price', (item) => item.price > threshold);
}

describe('InternalStore', () => {
	describe('constructor defaults', () => {
		it('defaults to an empty source/working set when no initial data is supplied', () => {
			const store = new InternalStore<Item>();

			expect(store.sourceData.value).toEqual([]);
			expect(store.workingSet.value).toEqual([]);
			expect(store.sourceDataVersion.value).toBe(0);
			expect(store.workingSetVersion.value).toBe(0);
			expect(store.rules.value.size).toBe(0);
			expect(store.expression.value).toBeNull();
			expect(store.groups.value).toEqual([]);
			expect(store.lastChangeRuleId.value).toBeNull();
			expect(store.lastChangeTimestamp.value).toBeNull();
		});

		it('seeds both source data and working set from the initial data', () => {
			const data: Item[] = [{ price: 1 }, { price: 2 }];
			const store = new InternalStore<Item>(data);

			expect(store.sourceData.value).toBe(data);
			expect(store.workingSet.value).toBe(data);
		});
	});

	describe('mode', () => {
		it("reports 'flat-map' when no expression is set", () => {
			expect(new InternalStore<Item>().mode.value).toBe('flat-map');
		});

		it("reports 'expression' when an expression is set, and flips back when cleared", () => {
			const store = new InternalStore<Item>();

			store.expression.value = new CompositeRule('and', []);
			expect(store.mode.value).toBe('expression');

			store.expression.value = null;
			expect(store.mode.value).toBe('flat-map');
		});
	});

	describe('activeRuleIds', () => {
		it('projects the rule-map keys and reacts to rule changes', () => {
			const store = new InternalStore<Item>();

			expect(store.activeRuleIds.value).toEqual([]);

			store.rules.value = new Map([
				['a', priceAbove(1)],
				['b', priceAbove(2)],
			]);

			expect(store.activeRuleIds.value).toEqual(['a', 'b']);
		});
	});

	describe('effectiveExpression', () => {
		it('returns the explicit expression when in expression mode', () => {
			const store = new InternalStore<Item>();
			const expr = new CompositeRule('or', [priceAbove(1)]);

			store.expression.value = expr;
			// Rules present but ignored — expression mode wins.
			store.rules.value = new Map([['r', priceAbove(5)]]);

			// Simplified for evaluation: or(x) is x. `expression` itself is untouched.
			expect(store.effectiveExpression.value).toBe(expr.config.rules[0]);
			expect(store.expression.value).toBe(expr);
		});

		it('is null for an expression that constrains nothing', () => {
			const store = new InternalStore<Item>([{ price: 1 }]);

			store.expression.value = new CompositeRule('and', []);

			expect(store.effectiveExpression.value).toBeNull();
			expect(store.resultCount.value).toBe(1);
		});

		it('returns null in flat-map mode with no rules', () => {
			expect(new InternalStore<Item>().effectiveExpression.value).toBeNull();
		});

		it('returns the single rule unwrapped when exactly one rule is registered', () => {
			const store = new InternalStore<Item>();
			const rule = priceAbove(5);

			store.rules.value = new Map([['only', rule]]);

			expect(store.effectiveExpression.value).toBe(rule);
		});

		it('AND-composes multiple flat-map rules into a CompositeRule', () => {
			const store = new InternalStore<Item>();
			const r1 = priceAbove(1);
			const r2 = priceAbove(2);

			store.rules.value = new Map([
				['a', r1],
				['b', r2],
			]);
			const effective = store.effectiveExpression.value;

			expect(effective).toBeInstanceOf(CompositeRule);
			expect((effective as CompositeRule).config.op).toBe('and');
			expect((effective as CompositeRule).config.rules).toEqual([r1, r2]);
		});
	});

	describe('filter groups', () => {
		const items: Item[] = [{ price: 1 }, { price: 5 }, { price: 9 }];

		it('ORs the rules a group names and ANDs the group with standalone rules', () => {
			const store = new InternalStore<Item>(items);

			store.rules.value = new Map([
				['cheap', new PredicateRule<Item>('price', (item) => item.price < 2)],
				['dear', new PredicateRule<Item>('price', (item) => item.price > 8)],
				['positive', priceAbove(0)],
			]);
			store.groups.value = [{ composition: 'or', filterIds: ['cheap', 'dear'], id: 'ends' }];

			expect(store.results.value).toEqual([{ price: 1 }, { price: 9 }]);
		});

		it('skips unregistered ids, unwraps one-member groups and drops empty ones', () => {
			const store = new InternalStore<Item>(items);
			const above4 = priceAbove(4);

			store.rules.value = new Map([['above4', above4]]);
			store.groups.value = [
				{ composition: 'or', filterIds: ['above4', 'missing'], id: 'one' },
				{ composition: 'or', filterIds: ['nothing'], id: 'empty' },
			];

			expect(store.effectiveExpression.value).toBe(above4);
			expect(store.resultCount.value).toBe(2);
		});

		it('ANDs the members of an "and" group', () => {
			const store = new InternalStore<Item>(items);

			store.rules.value = new Map([
				['above0', priceAbove(0)],
				['above4', priceAbove(4)],
			]);
			store.groups.value = [{ composition: 'and', filterIds: ['above0', 'above4', 'above4'], id: 'g' }];

			expect(store.resultCount.value).toBe(2);
		});
	});

	describe('results accelerator', () => {
		it('serves resultIndices from the accelerator when it answers, and the evaluator when it declines', () => {
			const store = new InternalStore<Item>([{ price: 1 }, { price: 5 }, { price: 9 }]);
			let answer: Uint32Array | null = Uint32Array.from([2]);

			store.setResultsAccelerator(() => answer);
			store.rules.value = new Map([['gt4', priceAbove(4)]]);
			expect([...store.resultIndices.value]).toEqual([2]);

			answer = null;
			store.rules.value = new Map([['gt4', priceAbove(4)]]);
			expect([...store.resultIndices.value]).toEqual([1, 2]);

			store.setResultsAccelerator(null);
			store.rules.value = new Map([['gt0', priceAbove(0)]]);
			expect([...store.resultIndices.value]).toEqual([0, 1, 2]);
		});
	});

	describe('resultIndices', () => {
		it('emits a contiguous 0..n-1 Uint32Array when no expression is active', () => {
			const store = new InternalStore<Item>([{ price: 1 }, { price: 2 }, { price: 3 }]);
			const indices = store.resultIndices.value;

			expect(indices).toBeInstanceOf(Uint32Array);
			expect([...indices]).toEqual([0, 1, 2]);
		});

		it('emits an empty Uint32Array for an empty working set with no expression', () => {
			const store = new InternalStore<Item>([]);

			expect(store.resultIndices.value).toBeInstanceOf(Uint32Array);
			expect(store.resultIndices.value.length).toBe(0);
		});

		it('emits only the matching positions when a rule filters the working set', () => {
			const store = new InternalStore<Item>([{ price: 1 }, { price: 5 }, { price: 9 }]);

			store.rules.value = new Map([['gt4', priceAbove(4)]]);
			const indices = store.resultIndices.value;

			expect(indices).toBeInstanceOf(Uint32Array);
			expect([...indices]).toEqual([1, 2]);
		});

		it('emits an empty Uint32Array when an active rule matches nothing', () => {
			const store = new InternalStore<Item>([{ price: 1 }, { price: 2 }]);

			store.rules.value = new Map([['gt100', priceAbove(100)]]);

			expect([...store.resultIndices.value]).toEqual([]);
		});
	});

	describe('results', () => {
		it('returns the working set by reference when no expression is active (memo fast-path)', () => {
			const data: Item[] = [{ price: 1 }, { price: 2 }];
			const store = new InternalStore<Item>(data);

			// Same reference as workingSet — preserves React memo bail-out.
			expect(store.results.value).toBe(store.workingSet.value);
			expect(store.results.value).toBe(data);
		});

		it('projects the filtered subset and upholds results[i] === workingSet[resultIndices[i]]', () => {
			const data: Item[] = [{ price: 1 }, { price: 5 }, { price: 9 }];
			const store = new InternalStore<Item>(data);

			store.rules.value = new Map([['gt4', priceAbove(4)]]);
			const results = store.results.value;
			const indices = store.resultIndices.value;

			expect(results).toEqual([{ price: 5 }, { price: 9 }]);
			for (let i = 0; i < indices.length; i++) {
				expect(results[i]).toBe(data[indices[i] as number]);
			}
		});

		it('reacts to working-set changes when filtering', () => {
			const store = new InternalStore<Item>([{ price: 5 }, { price: 9 }]);

			store.rules.value = new Map([['gt4', priceAbove(4)]]);
			expect(store.results.value).toEqual([{ price: 5 }, { price: 9 }]);

			store.workingSet.value = [{ price: 1 }, { price: 9 }];
			expect(store.results.value).toEqual([{ price: 9 }]);
		});
	});

	describe('resultCount', () => {
		it('counts all items when unfiltered', () => {
			const store = new InternalStore<Item>([{ price: 1 }, { price: 2 }, { price: 3 }]);

			expect(store.resultCount.value).toBe(3);
		});

		it('counts only the matching items when filtered', () => {
			const store = new InternalStore<Item>([{ price: 1 }, { price: 5 }, { price: 9 }]);

			store.rules.value = new Map([['gt4', priceAbove(4)]]);

			expect(store.resultCount.value).toBe(2);
		});
	});

	describe('reactive propagation', () => {
		it('notifies a downstream effect when the working set changes', () => {
			const store = new InternalStore<Item>([{ price: 5 }]);

			store.rules.value = new Map([['gt4', priceAbove(4)]]);
			const counts: number[] = [];

			disposers.push(
				effect(() => {
					counts.push(store.resultCount.value);
				}),
			);

			// Initial synchronous run.
			expect(counts).toEqual([1]);

			store.workingSet.value = [{ price: 5 }, { price: 6 }, { price: 1 }];
			expect(counts).toEqual([1, 2]);
		});
	});
});
