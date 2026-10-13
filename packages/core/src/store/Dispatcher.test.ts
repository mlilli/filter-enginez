/**
 * Tests for `Dispatcher` — the single mutation entry point onto the `InternalStore`.
 *
 * @remarks
 * Exercises every `case` in `apply`'s action switch: expression set, group add/remove, reset,
 * rule add/change/remove, rules-cleared, source-data set, working-set set/reset. Asserts both
 * the resulting store state AND the version-counter bumps + `lastChange*` side-effects each
 * action is responsible for. Also confirms `dispatch` simply delegates to `apply` (the replay
 * path uses `apply` directly to avoid re-logging), and that a multi-signal action is applied as
 * one batch an effect never observes half-done.
 */

import { effect } from '@preact/signals-core';
import { describe, expect, it, vi } from 'vitest';

import type { FilterGroup } from '../composition/FilterGroup.js';

import { CompositeRule } from '../rules/CompositeRule.js';
import { PredicateRule } from '../rules/PredicateRule.js';
import { Dispatcher } from './Dispatcher.js';
import { InternalStore } from './InternalStore.js';

interface Item {
	readonly price: number;
}

function makeFixture(initial: readonly Item[] = []): {
	dispatcher: Dispatcher<Item>;
	store: InternalStore<Item>;
} {
	const store = new InternalStore<Item>(initial);

	return { dispatcher: new Dispatcher<Item>(store), store };
}

function priceAbove(threshold: number): PredicateRule<Item> {
	return new PredicateRule<Item>('price', (item) => item.price > threshold);
}

const groupG1: FilterGroup = { composition: 'or', filterIds: ['a'], id: 'g1' };
const groupG2: FilterGroup = { composition: 'and', filterIds: ['b'], id: 'g2' };

describe('Dispatcher', () => {
	describe('EXPRESSION_SET', () => {
		it('sets the expression signal', () => {
			const { dispatcher, store } = makeFixture();
			const expr = new CompositeRule('and', [priceAbove(5)]);

			dispatcher.dispatch({ payload: { expression: expr }, type: 'EXPRESSION_SET' });

			expect(store.expression.value).toBe(expr);
		});

		it('clears the expression when dispatched with null', () => {
			const { dispatcher, store } = makeFixture();

			store.expression.value = new CompositeRule('or', []);
			dispatcher.dispatch({ payload: { expression: null }, type: 'EXPRESSION_SET' });

			expect(store.expression.value).toBeNull();
		});
	});

	describe('GROUP_ADDED / GROUP_REMOVED', () => {
		it('appends a group to the groups signal', () => {
			const { dispatcher, store } = makeFixture();

			dispatcher.dispatch({ payload: { group: groupG1 }, type: 'GROUP_ADDED' });
			dispatcher.dispatch({ payload: { group: groupG2 }, type: 'GROUP_ADDED' });

			expect(store.groups.value.map((g) => g.id)).toEqual(['g1', 'g2']);
		});

		it('removes only the group matching the given id', () => {
			const { dispatcher, store } = makeFixture();

			store.groups.value = [groupG1, groupG2];
			dispatcher.dispatch({ payload: { groupId: 'g1' }, type: 'GROUP_REMOVED' });

			expect(store.groups.value.map((g) => g.id)).toEqual(['g2']);
		});

		it('removing a non-existent group id leaves groups unchanged', () => {
			const { dispatcher, store } = makeFixture();

			store.groups.value = [groupG1];
			dispatcher.dispatch({ payload: { groupId: 'missing' }, type: 'GROUP_REMOVED' });

			expect(store.groups.value.map((g) => g.id)).toEqual(['g1']);
		});
	});

	describe('RULE_ADDED / RULE_CHANGED', () => {
		it('adds a rule and records it as the last change', () => {
			const { dispatcher, store } = makeFixture();
			const rule = priceAbove(5);
			const before = Date.now();

			dispatcher.dispatch({ payload: { rule, ruleId: 'price' }, type: 'RULE_ADDED' });

			expect(store.rules.value.get('price')).toBe(rule);
			expect(store.lastChangeRuleId.value).toBe('price');
			expect(store.lastChangeTimestamp.value).toBeGreaterThanOrEqual(before);
		});

		it('writes an immutable new Map rather than mutating the existing one', () => {
			const { dispatcher, store } = makeFixture();
			const original = store.rules.value;

			dispatcher.dispatch({ payload: { rule: priceAbove(5), ruleId: 'price' }, type: 'RULE_ADDED' });

			expect(store.rules.value).not.toBe(original);
			expect(original.size).toBe(0);
		});

		it('RULE_CHANGED replaces the rule for an existing id', () => {
			const { dispatcher, store } = makeFixture();
			const first = priceAbove(5);
			const second = priceAbove(10);

			dispatcher.dispatch({ payload: { rule: first, ruleId: 'price' }, type: 'RULE_ADDED' });
			dispatcher.dispatch({ payload: { rule: second, ruleId: 'price' }, type: 'RULE_CHANGED' });

			expect(store.rules.value.get('price')).toBe(second);
			expect(store.rules.value.size).toBe(1);
			expect(store.lastChangeRuleId.value).toBe('price');
		});
	});

	describe('RULE_REMOVED', () => {
		it('deletes the rule and records it as the last change', () => {
			const { dispatcher, store } = makeFixture();

			dispatcher.dispatch({ payload: { rule: priceAbove(5), ruleId: 'price' }, type: 'RULE_ADDED' });
			const before = Date.now();

			dispatcher.dispatch({ payload: { ruleId: 'price' }, type: 'RULE_REMOVED' });

			expect(store.rules.value.has('price')).toBe(false);
			expect(store.lastChangeRuleId.value).toBe('price');
			expect(store.lastChangeTimestamp.value).toBeGreaterThanOrEqual(before);
		});

		it('removing an absent rule id is a no-op on the map but still records the change id', () => {
			const { dispatcher, store } = makeFixture();

			dispatcher.dispatch({ payload: { ruleId: 'ghost' }, type: 'RULE_REMOVED' });

			expect(store.rules.value.size).toBe(0);
			expect(store.lastChangeRuleId.value).toBe('ghost');
		});
	});

	describe('RULES_CLEARED', () => {
		it('clears rules, groups, and expression but leaves source/working data alone', () => {
			const { dispatcher, store } = makeFixture([{ price: 1 }]);

			dispatcher.dispatch({ payload: { rule: priceAbove(5), ruleId: 'price' }, type: 'RULE_ADDED' });
			store.groups.value = [groupG1];
			store.expression.value = new CompositeRule('and', []);

			dispatcher.dispatch({ type: 'RULES_CLEARED' });

			expect(store.rules.value.size).toBe(0);
			expect(store.groups.value).toEqual([]);
			expect(store.expression.value).toBeNull();
			// Source data untouched.
			expect(store.sourceData.value).toEqual([{ price: 1 }]);
		});

		it('stamps the last-change fields, like every other mutating action', () => {
			// `RULES_CLEARED` must stamp `lastChangeTimestamp` like every other mutation. A reducer that
			// left it holding the previous commit's value would make a consumer anchored on that
			// timestamp see nothing happen — e.g. a "Clear all filters" button whose computing
			// indicator starts and never resolves, because the settle effect it depends on never
			// re-runs — while individual clears keep working, so it would look like a UI bug rather
			// than a reducer gap.
			// Fake timers are load-bearing here, not decoration. `Date.now()` is millisecond-resolution
			// and two back-to-back dispatches land inside the same millisecond, so a real-clock version
			// of this test would read an unchanged timestamp and fail even against a correct reducer.
			// (That resolution limit is also why the Angular adapter anchors on the change event, which
			// is a fresh object per emission and so cannot collide.)
			vi.useFakeTimers();

			try {
				const { dispatcher, store } = makeFixture([{ price: 1 }]);

				dispatcher.dispatch({ payload: { rule: priceAbove(5), ruleId: 'price' }, type: 'RULE_ADDED' });
				const timestampBefore = store.lastChangeTimestamp.value;

				vi.advanceTimersByTime(1);
				dispatcher.dispatch({ type: 'RULES_CLEARED' });

				expect(store.lastChangeTimestamp.value).not.toBe(timestampBefore);
				expect(store.lastChangeTimestamp.value).not.toBeNull();
				// Null rather than the id of some arbitrary rule that happened to be cleared — no
				// single rule changed. Matches RESET.
				expect(store.lastChangeRuleId.value).toBeNull();
			} finally {
				vi.useRealTimers();
			}
		});
	});

	describe('RESET', () => {
		it('clears rules/groups/expression, mirrors working set to source, and bumps the working version', () => {
			const source: Item[] = [{ price: 1 }, { price: 2 }];
			const { dispatcher, store } = makeFixture(source);

			dispatcher.dispatch({ payload: { rule: priceAbove(5), ruleId: 'price' }, type: 'RULE_ADDED' });
			store.groups.value = [groupG1];
			store.expression.value = new CompositeRule('and', []);
			store.workingSet.value = [{ price: 99 }];
			const versionBefore = store.workingSetVersion.value;

			dispatcher.dispatch({ type: 'RESET' });

			expect(store.rules.value.size).toBe(0);
			expect(store.groups.value).toEqual([]);
			expect(store.expression.value).toBeNull();
			expect(store.workingSet.value).toBe(store.sourceData.value);
			expect(store.workingSet.value).toEqual(source);
			expect(store.workingSetVersion.value).toBe(versionBefore + 1);
			expect(store.lastChangeRuleId.value).toBeNull();
			expect(store.lastChangeTimestamp.value).toBeNull();
		});
	});

	describe('SOURCE_DATA_SET', () => {
		it('sets source data, mirrors it to the working set, and bumps both version counters', () => {
			const { dispatcher, store } = makeFixture();
			const items: Item[] = [{ price: 5 }, { price: 6 }];

			dispatcher.dispatch({ payload: { items }, type: 'SOURCE_DATA_SET' });

			expect(store.sourceData.value).toBe(items);
			expect(store.workingSet.value).toBe(items);
			expect(store.sourceDataVersion.value).toBe(1);
			expect(store.workingSetVersion.value).toBe(1);
		});
	});

	describe('WORKING_SET_SET / WORKING_SET_RESET', () => {
		it('sets a custom working set and bumps the working version', () => {
			const { dispatcher, store } = makeFixture([{ price: 1 }, { price: 2 }]);
			const subset: Item[] = [{ price: 2 }];
			const versionBefore = store.workingSetVersion.value;

			dispatcher.dispatch({ payload: { items: subset }, type: 'WORKING_SET_SET' });

			expect(store.workingSet.value).toBe(subset);
			expect(store.workingSetVersion.value).toBe(versionBefore + 1);
		});

		it('resets the working set back to mirror source data', () => {
			const source: Item[] = [{ price: 1 }, { price: 2 }];
			const { dispatcher, store } = makeFixture(source);

			store.workingSet.value = [{ price: 2 }];
			const versionBefore = store.workingSetVersion.value;

			dispatcher.dispatch({ type: 'WORKING_SET_RESET' });

			expect(store.workingSet.value).toBe(store.sourceData.value);
			expect(store.workingSet.value).toEqual(source);
			expect(store.workingSetVersion.value).toBe(versionBefore + 1);
		});
	});

	describe('dispatch / apply equivalence', () => {
		it('apply mutates the store directly, matching dispatch (the no-re-log replay path)', () => {
			const { dispatcher, store } = makeFixture();
			const rule = priceAbove(5);

			dispatcher.apply({ payload: { rule, ruleId: 'price' }, type: 'RULE_ADDED' });

			expect(store.rules.value.get('price')).toBe(rule);
		});
	});

	it('applies a multi-signal action as one batch', () => {
		const { dispatcher, store } = makeFixture([{ price: 1 }]);
		const seen: string[] = [];

		dispatcher.apply({ payload: { rule: new PredicateRule<Item>('price', () => true), ruleId: 'r' }, type: 'RULE_ADDED' });
		dispatcher.apply({ payload: { group: { composition: 'or', filterIds: ['r'], id: 'g' }}, type: 'GROUP_ADDED' });
		const dispose = effect(() => {
			seen.push(`${store.rules.value.size}/${store.groups.value.length}`);
		});

		dispatcher.apply({ type: 'RESET' });
		dispose();

		expect(seen).toEqual(['1/1', '0/0']);
	});
});
