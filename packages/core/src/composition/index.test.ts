/**
 * Tests for the composition barrel — `./index.ts`.
 *
 * @remarks
 * A pure re-export barrel may report 0/0 in coverage, which is substantively 100%. The value
 * of this test is asserting the public surface stays intact: the `and` / `or` / `not` factories
 * and the `applyExpression` / `evaluateExpression` / `simplify` functions are live, callable
 * bindings re-exported from this entry point (the type-only `FilterGroup` exports carry no
 * runtime binding to assert).
 */

import { describe, expect, it } from 'vitest';

import { ValueRule } from '../rules/ValueRule.js';
import {
	and,
	applyExpression,
	evaluateExpression,
	not,
	or,
	simplify,
} from './index.js';

describe('composition barrel', () => {
	it('re-exports the and/or/not factories as callable bindings', () => {
		expect(typeof and).toBe('function');
		expect(typeof or).toBe('function');
		expect(typeof not).toBe('function');

		const node = and(or(new ValueRule(undefined, 1)), not(new ValueRule(undefined, 2)));

		expect(node.config.op).toBe('and');
	});

	it('re-exports the evaluator and simplify functions wired to live behavior', () => {
		const expr = or(new ValueRule(undefined, 1), new ValueRule(undefined, 3));

		expect(evaluateExpression(expr, 3)).toBe(true);
		expect(applyExpression(expr, [1, 2, 3])).toEqual([1, 3]);
		expect(simplify(and(new ValueRule(undefined, 1)))).toBeInstanceOf(ValueRule);
	});
});
