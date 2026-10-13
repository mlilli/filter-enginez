/**
 * Tests for the `Action` discriminated-union module.
 *
 * @remarks
 * `Action` is a pure type module — it contributes no runtime code, so this suite asserts the
 * compile-time contract via type-level checks (constructing each variant and narrowing on the
 * `type` discriminant) plus a runtime smoke test that the constructed action literals carry the
 * expected shape. The point is that every member of the union is reachable and discriminated
 * correctly, and that `ActionType` enumerates exactly the `type` strings.
 */

import { describe, expect, it } from 'vitest';

import type { FilterGroup } from '../composition/FilterGroup.js';
import type { Action, ActionType } from './Action.js';

import { CompositeRule } from '../rules/CompositeRule.js';
import { PredicateRule } from '../rules/PredicateRule.js';

const sampleRule = new PredicateRule<{ price: number }>('price', (item) => item.price > 0);
const sampleGroup: FilterGroup = { composition: 'or', filterIds: ['a'], id: 'g1' };
const sampleExpression = new CompositeRule('and', [sampleRule]);

describe('Action', () => {
	it('discriminates each action variant by its `type` literal', () => {
		const actions: Action[] = [
			{ payload: { expression: sampleExpression }, type: 'EXPRESSION_SET' },
			{ payload: { group: sampleGroup }, type: 'GROUP_ADDED' },
			{ payload: { groupId: 'g1' }, type: 'GROUP_REMOVED' },
			{ payload: { items: [1, 2, 3]}, type: 'SOURCE_DATA_SET' },
			{ payload: { items: [1]}, type: 'WORKING_SET_SET' },
			{ payload: { rule: sampleRule, ruleId: 'price' }, type: 'RULE_ADDED' },
			{ payload: { rule: sampleRule, ruleId: 'price' }, type: 'RULE_CHANGED' },
			{ payload: { ruleId: 'price' }, type: 'RULE_REMOVED' },
			{ type: 'RESET' },
			{ type: 'RULES_CLEARED' },
			{ type: 'WORKING_SET_RESET' },
		];

		expect(actions.map((action) => action.type)).toEqual([
			'EXPRESSION_SET',
			'GROUP_ADDED',
			'GROUP_REMOVED',
			'SOURCE_DATA_SET',
			'WORKING_SET_SET',
			'RULE_ADDED',
			'RULE_CHANGED',
			'RULE_REMOVED',
			'RESET',
			'RULES_CLEARED',
			'WORKING_SET_RESET',
		]);
	});

	it('narrows payload shape on the `type` discriminant', () => {
		// A heterogeneous union array keeps the element type as the full `Action`, so the
		// `type === 'RULE_ADDED'` guard is a genuine discriminant narrowing (not provably-true
		// on a single-member literal). The matched member's payload narrows to `{ rule; ruleId }`.
		const actions: Action[] = [
			{ type: 'RESET' },
			{ payload: { rule: sampleRule, ruleId: 'price' }, type: 'RULE_ADDED' },
		];
		const found = actions.find((action) => action.type === 'RULE_ADDED');

		expect(found).toBeDefined();
		if (found?.type === 'RULE_ADDED') {
			expect(found.payload.ruleId).toBe('price');
			expect(found.payload.rule).toBe(sampleRule);
		}
	});

	it('exposes `EXPRESSION_SET` with a nullable expression payload', () => {
		const actions: Action[] = [
			{ type: 'RESET' },
			{ payload: { expression: null }, type: 'EXPRESSION_SET' },
		];
		const cleared = actions.find((action) => action.type === 'EXPRESSION_SET');

		expect(cleared).toBeDefined();
		if (cleared?.type === 'EXPRESSION_SET') {
			expect(cleared.payload.expression).toBeNull();
		}
	});

	it('admits exactly the union `type` strings as `ActionType`', () => {
		const types: ActionType[] = [
			'EXPRESSION_SET',
			'GROUP_ADDED',
			'GROUP_REMOVED',
			'SOURCE_DATA_SET',
			'WORKING_SET_SET',
			'RULE_ADDED',
			'RULE_CHANGED',
			'RULE_REMOVED',
			'RESET',
			'RULES_CLEARED',
			'WORKING_SET_RESET',
		];

		// 11 distinct members, no duplicates.
		expect(new Set(types).size).toBe(11);
	});
});
