/**
 * @remarks
 * Tests for `composeFlatExpression` (the flat-map expression with filter groups folded in) and
 * `isConjunctive` (whether the groups leave the filter a plain AND). Covers no rules, no groups,
 * standalone + grouped rules, duplicate and unregistered ids, one-member and empty groups, and the
 * `'or'`-group threshold of two present members.
 */

import { describe, expect, it } from 'vitest';

import type { FilterRule } from '../rules/FilterRule.js';
import type { FilterGroup } from './FilterGroup.js';

import { CompositeRule } from '../rules/CompositeRule.js';
import { ValueRule } from '../rules/ValueRule.js';
import { composeFlatExpression, isConjunctive } from './composeFlatExpression.js';

const a = new ValueRule('a', 1);
const b = new ValueRule('b', 2);
const c = new ValueRule('c', 3);

function rulesOf(entries: Record<string, FilterRule>): ReadonlyMap<string, FilterRule> {
	return new Map(Object.entries(entries));
}

function composite(rule: FilterRule | null): CompositeRule {
	if (!(rule instanceof CompositeRule)) {
		throw new TypeError('expected a CompositeRule');
	}

	return rule;
}

describe('composeFlatExpression', () => {
	it('is null with no rules, with or without groups', () => {
		expect(composeFlatExpression(new Map(), [])).toBeNull();
		expect(composeFlatExpression(new Map(), [{ composition: 'or', filterIds: ['a'], id: 'g' }])).toBeNull();
	});

	it('returns the lone rule, or an AND of all rules, when there are no groups', () => {
		expect(composeFlatExpression(rulesOf({ a }), [])).toBe(a);
		const both = composite(composeFlatExpression(rulesOf({ a, b }), []));

		expect(both.config.op).toBe('and');
		expect(both.config.rules).toEqual([a, b]);
	});

	it('ANDs standalone rules with each group composed by its own operator', () => {
		const groups: FilterGroup[] = [{ composition: 'or', filterIds: ['b', 'c'], id: 'g' }];
		const expression = composite(composeFlatExpression(rulesOf({ a, b, c }), groups));

		expect(expression.config.op).toBe('and');
		const [standalone, group] = expression.config.rules;

		expect(standalone).toBe(a);
		expect(composite(group ?? null).config).toEqual({ op: 'or', rules: [b, c]});
	});

	it('skips unregistered and duplicate ids, unwraps one-member groups and drops empty ones', () => {
		const groups: FilterGroup[] = [
			{ composition: 'or', filterIds: ['a', 'a', 'missing'], id: 'one' },
			{ composition: 'and', filterIds: ['missing'], id: 'empty' },
		];

		expect(composeFlatExpression(rulesOf({ a }), groups)).toBe(a);
	});
});

describe('isConjunctive', () => {
	it('is true with no groups and for "and" groups', () => {
		expect(isConjunctive(['a', 'b'], [])).toBe(true);
		expect(isConjunctive(['a', 'b'], [{ composition: 'and', filterIds: ['a', 'b'], id: 'g' }])).toBe(true);
	});

	it('is false only when an "or" group names two or more present ids', () => {
		const groups: FilterGroup[] = [{ composition: 'or', filterIds: ['a', 'b', 'b'], id: 'g' }];

		expect(isConjunctive(['a'], groups)).toBe(true);
		expect(isConjunctive(['a', 'b'], groups)).toBe(false);
	});
});
