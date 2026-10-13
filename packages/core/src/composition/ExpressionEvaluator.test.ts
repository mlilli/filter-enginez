/**
 * Tests for the recursive Boolean evaluator — `evaluateExpression` + `applyExpression`.
 *
 * @remarks
 * Exercises every branch of the Interpreter walk: the leaf delegation, the `and` / `or` / `not`
 * operator arms with true / false / mixed child results, the three empty-operand degenerate
 * cases (`and()` / `or()` / `not()` all yield `true`), `not` over a present child vs the missing
 * `firstChild === undefined` guard, and a deeply-nested `and(or(...), not(...))` tree.
 * `applyExpression` is verified as a filtering pass that returns a new array preserving order.
 */

import { describe, expect, it } from 'vitest';

import { CompositeRule } from '../rules/CompositeRule.js';
import { ValueRule } from '../rules/ValueRule.js';
import { applyExpression, evaluateExpression } from './ExpressionEvaluator.js';

/** A leaf rule that passes only items strictly equal to `target`. */
const eqRule = (target: unknown): ValueRule => new ValueRule(undefined, target);

describe('evaluateExpression', () => {
	it('delegates to a leaf rule\'s own predicate', () => {
		const leaf = eqRule(42);

		expect(evaluateExpression(leaf, 42)).toBe(true);
		expect(evaluateExpression(leaf, 7)).toBe(false);
	});

	describe('and', () => {
		it('is true when every child passes', () => {
			const tree = new CompositeRule('and', [eqRule(1), eqRule(1)]);

			expect(evaluateExpression(tree, 1)).toBe(true);
		});

		it('is false when any child fails', () => {
			const tree = new CompositeRule('and', [eqRule(1), eqRule(2)]);

			expect(evaluateExpression(tree, 1)).toBe(false);
		});

		it('is true for an empty "and" (no constraint)', () => {
			const tree = new CompositeRule('and', []);

			expect(evaluateExpression(tree, 'anything')).toBe(true);
		});
	});

	describe('or', () => {
		it('is true when at least one child passes', () => {
			const tree = new CompositeRule('or', [eqRule('red'), eqRule('blue')]);

			expect(evaluateExpression(tree, 'blue')).toBe(true);
		});

		it('is false when no child passes', () => {
			const tree = new CompositeRule('or', [eqRule('red'), eqRule('blue')]);

			expect(evaluateExpression(tree, 'green')).toBe(false);
		});

		it('is true for an empty "or" (degenerate no-op via the length-zero guard)', () => {
			const tree = new CompositeRule('or', []);

			expect(evaluateExpression(tree, 'anything')).toBe(true);
		});
	});

	describe('not', () => {
		it('inverts a present child that fails into a pass', () => {
			const tree = new CompositeRule('not', [eqRule(1)]);

			expect(evaluateExpression(tree, 2)).toBe(true);
		});

		it('inverts a present child that passes into a fail', () => {
			const tree = new CompositeRule('not', [eqRule(1)]);

			expect(evaluateExpression(tree, 1)).toBe(false);
		});

		it('is true for an empty "not" (the firstChild === undefined guard)', () => {
			const tree = new CompositeRule('not', []);

			expect(evaluateExpression(tree, 'anything')).toBe(true);
		});
	});

	describe('nesting', () => {
		it('evaluates a nested and(or(...), not(...)) tree with mixed results', () => {
			// (value === 'red' OR value === 'blue') AND NOT (value === 'blue')
			const tree = new CompositeRule('and', [
				new CompositeRule('or', [eqRule('red'), eqRule('blue')]),
				new CompositeRule('not', [eqRule('blue')]),
			]);

			expect(evaluateExpression(tree, 'red')).toBe(true);
			expect(evaluateExpression(tree, 'blue')).toBe(false);
			expect(evaluateExpression(tree, 'green')).toBe(false);
		});
	});
});

describe('applyExpression', () => {
	it('returns the subset of items that pass the expression, preserving order', () => {
		const tree = new CompositeRule('or', [eqRule(1), eqRule(3)]);

		expect(applyExpression(tree, [1, 2, 3, 4, 3])).toEqual([1, 3, 3]);
	});

	it('returns a new array (does not mutate the input)', () => {
		const items = [1, 2, 3];
		const result = applyExpression(eqRule(2), items);

		expect(result).toEqual([2]);
		expect(items).toEqual([1, 2, 3]);
	});

	it('returns an empty array when nothing passes', () => {
		expect(applyExpression(eqRule(99), [1, 2, 3])).toEqual([]);
	});
});
