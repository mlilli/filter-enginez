/**
 * Tests for `simplify` — algebraic simplification of `CompositeRule` expression trees.
 *
 * @remarks
 * Covers each rewrite rule and its identity/no-op counterpart: leaf pass-through, recursive
 * child simplification (including children that simplify to `null` and are dropped), the
 * empty-`and`/`or` → `null` collapse, single-child `and(x)`/`or(x)` → `x` collapse, the
 * `not(not(x))` double-negation elimination (and the cases that DON'T qualify — single `not`,
 * `not` wrapping a non-`not` composite, a multi-child `not` reduced to its first child), the
 * always-true-child rules for `or` / `not`, an evaluator-equivalence sweep, and the structural
 * rebuild fall-through that returns a fresh `CompositeRule` with simplified children. The
 * `firstChild !== undefined` guard arms are reached by feeding both populated and emptied
 * child lists.
 */

import { describe, expect, it } from 'vitest';

import type { FilterRule } from '../rules/FilterRule.js';

import { CompositeRule } from '../rules/CompositeRule.js';
import { ValueRule } from '../rules/ValueRule.js';
import { simplify } from './simplify.js';

/** A leaf rule that passes only items strictly equal to `target`. */
const eqRule = (target: unknown): ValueRule => new ValueRule(undefined, target);

/**
 * Narrow a simplification result to a `CompositeRule` (or fail the test). Uses a real
 * `instanceof` guard so downstream property reads need no `as` cast.
 */
const expectComposite = (rule: FilterRule | null): CompositeRule => {
	expect(rule).toBeInstanceOf(CompositeRule);

	if (!(rule instanceof CompositeRule)) {
		throw new Error('expected a CompositeRule');
	}

	return rule;
};

describe('simplify', () => {
	it('returns a non-composite leaf rule unchanged', () => {
		const leaf = eqRule(1);

		expect(simplify(leaf)).toBe(leaf);
	});

	describe('empty and/or → null', () => {
		it('collapses an empty "and" to null (no constraint)', () => {
			expect(simplify(new CompositeRule('and', []))).toBeNull();
		});

		it('collapses an empty "or" to null', () => {
			expect(simplify(new CompositeRule('or', []))).toBeNull();
		});

		it('collapses an "and" whose only child simplifies to null', () => {
			// The inner empty "or" simplifies to null and is dropped, emptying the parent.
			const tree = new CompositeRule('and', [new CompositeRule('or', [])]);

			expect(simplify(tree)).toBeNull();
		});
	});

	describe('single-child collapse', () => {
		it('collapses "and(x)" to x', () => {
			const child = eqRule(1);

			expect(simplify(new CompositeRule('and', [child]))).toBe(child);
		});

		it('collapses "or(x)" to x', () => {
			const child = eqRule('red');

			expect(simplify(new CompositeRule('or', [child]))).toBe(child);
		});

		it('collapses after a sibling child drops to null', () => {
			const survivor = eqRule(1);
			// The empty inner "and" simplifies to null and is dropped, leaving one child.
			const tree = new CompositeRule('and', [survivor, new CompositeRule('and', [])]);

			expect(simplify(tree)).toBe(survivor);
		});
	});

	describe('double-negation elimination', () => {
		it('collapses "not(not(x))" to x', () => {
			const inner = eqRule(1);
			const tree = new CompositeRule('not', [new CompositeRule('not', [inner])]);

			expect(simplify(tree)).toBe(inner);
		});

		it('eliminates a chain of double negations down to the leaf', () => {
			const inner = eqRule(1);
			// not(not(not(not(x)))) → x
			const tree = new CompositeRule('not', [
				new CompositeRule('not', [
					new CompositeRule('not', [new CompositeRule('not', [inner])]),
				]),
			]);

			expect(simplify(tree)).toBe(inner);
		});

		it('preserves a single "not" wrapping a leaf', () => {
			const child = eqRule(1);
			const result = expectComposite(simplify(new CompositeRule('not', [child])));

			expect(result.config.op).toBe('not');
			expect(result.config.rules).toEqual([child]);
		});

		it('does NOT eliminate "not" wrapping a non-"not" composite', () => {
			// not(or(x, y)) — the inner "or" has two children, so it survives as a composite
			// that is not a "not", exercising the "inner not a not-composite" arm.
			const child = eqRule(1);
			const result = expectComposite(
				simplify(new CompositeRule('not', [new CompositeRule('or', [child, eqRule(2)])])),
			);

			expect(result.config.op).toBe('not');
		});

		it('reads only the first child of a multi-child "not", as the evaluator does', () => {
			// The evaluator treats not(a, b) as !a, so not(not(a, b)) is a.
			const first = eqRule(1);
			const inner = new CompositeRule('not', [first, eqRule(2)]);

			expect(simplify(new CompositeRule('not', [inner]))).toBe(first);
		});
	});

	describe('always-true children', () => {
		it('collapses an empty "not" to null, matching the evaluator', () => {
			expect(simplify(new CompositeRule('not', []))).toBeNull();
		});

		it('makes an "or" with an always-true child null', () => {
			// or(and(), x) passes every item, so it constrains nothing.
			expect(simplify(new CompositeRule('or', [new CompositeRule('and', []), eqRule(1)]))).toBeNull();
		});

		it('turns "not" of an always-true child into the canonical match-nothing form', () => {
			const result = expectComposite(simplify(new CompositeRule('not', [new CompositeRule('or', [])])));

			expect(result.config.op).toBe('not');
			expect(result.action(1, result)).toBe(false);
			expect(result.action('anything', result)).toBe(false);
		});
	});

	describe('preserves the evaluator answer', () => {
		const trees: readonly FilterRule[] = [
			new CompositeRule('or', [new CompositeRule('and', []), eqRule(1)]),
			new CompositeRule('not', [new CompositeRule('and', [])]),
			new CompositeRule('and', [new CompositeRule('not', [new CompositeRule('or', [])]), eqRule(1)]),
			new CompositeRule('not', [new CompositeRule('not', [new CompositeRule('and', [])])]),
			new CompositeRule('not', [eqRule(1), eqRule(2)]),
			new CompositeRule('or', [new CompositeRule('and', [eqRule(1)]), new CompositeRule('not', [eqRule(2)])]),
		];

		it.each(trees.map((tree, index) => [index, tree] as const))('tree %i', (_index, tree) => {
			const simplified = simplify(tree);

			for (const item of [0, 1, 2, 3]) {
				const isOriginalMatch = tree.action(item, tree);
				const isSimplifiedMatch = simplified === null ? true : simplified.action(item, simplified);

				expect(isSimplifiedMatch).toBe(isOriginalMatch);
			}
		});
	});

	describe('structural rebuild', () => {
		it('returns a fresh multi-child "and" with simplified children', () => {
			const a = eqRule(1);
			const b = eqRule(2);
			const original = new CompositeRule('and', [a, b]);
			const result = expectComposite(simplify(original));

			expect(result).not.toBe(original);
			expect(result.config.op).toBe('and');
			expect(result.config.rules).toEqual([a, b]);
		});

		it('flattens nested single-child collapses inside a multi-child parent', () => {
			const inner = eqRule(1);
			const b = eqRule(2);
			// or(and(inner), b) → or(inner, b)
			const tree = new CompositeRule('or', [new CompositeRule('and', [inner]), b]);
			const result = expectComposite(simplify(tree));

			expect(result.config.op).toBe('or');
			expect(result.config.rules).toEqual([inner, b]);
		});

		it('keeps a still-simplified result evaluable', () => {
			const tree = new CompositeRule('and', [eqRule(1), new CompositeRule('not', [eqRule(2)])]);
			const result = expectComposite(simplify(tree));

			// 1 passes the "and" of (=== 1) and NOT(=== 2):
			expect(result.action(1, result)).toBe(true);
			expect(result.action(2, result)).toBe(false);
		});
	});
});
