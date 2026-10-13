/**
 * Tests for `CompositeRule` — the Boolean composition (AND / OR / NOT) of child rules.
 *
 * @remarks
 * Exercises the operator semantics through the live `evaluateExpression` wiring: AND with all
 * children passing vs one failing, OR with at least one passing vs all failing, NOT inverting a
 * child, the empty-operand degenerate cases (empty AND / OR / NOT all match), nested composites,
 * and the `config` structure + `FilterRule` round-trip via `serialize()`.
 */

import { describe, expect, it } from 'vitest';

import { CompositeRule } from './CompositeRule.js';
import { FilterRule } from './FilterRule.js';
import { ValueRule } from './ValueRule.js';

/** A leaf rule that always passes — for composing known-true children. */
const passRule = (): FilterRule => new ValueRule(undefined, undefined);

/** A leaf rule that passes only items strictly equal to `target`. */
const eqRule = (target: unknown): FilterRule => new ValueRule(undefined, target);

describe('CompositeRule', () => {
	it('stores the operator and child rules on config', () => {
		const child = passRule();
		const composite = new CompositeRule('and', [child]);

		expect(composite.config.op).toBe('and');
		expect(composite.config.rules).toEqual([child]);
	});

	it('is itself a FilterRule (so it can nest)', () => {
		expect(new CompositeRule('and', [])).toBeInstanceOf(FilterRule);
	});

	describe('AND', () => {
		it('passes an item only when every child passes', () => {
			const composite = new CompositeRule('and', [eqRule(1), passRule()]);

			expect(composite.action(1, composite)).toBe(true);
		});

		it('fails an item when any child fails', () => {
			const composite = new CompositeRule('and', [eqRule(1), eqRule(2)]);

			expect(composite.action(1, composite)).toBe(false);
		});

		it('passes every item when it has no children (no constraint)', () => {
			const composite = new CompositeRule('and', []);

			expect(composite.action('anything', composite)).toBe(true);
		});
	});

	describe('OR', () => {
		it('passes an item when at least one child passes', () => {
			const composite = new CompositeRule('or', [eqRule(1), eqRule(2)]);

			expect(composite.action(2, composite)).toBe(true);
		});

		it('fails an item when no child passes', () => {
			const composite = new CompositeRule('or', [eqRule(1), eqRule(2)]);

			expect(composite.action(3, composite)).toBe(false);
		});

		it('passes every item when it has no children (degenerate no-op)', () => {
			const composite = new CompositeRule('or', []);

			expect(composite.action('anything', composite)).toBe(true);
		});
	});

	describe('NOT', () => {
		it('passes an item when the wrapped child does NOT pass', () => {
			const composite = new CompositeRule('not', [eqRule(1)]);

			expect(composite.action(2, composite)).toBe(true);
		});

		it('fails an item when the wrapped child passes', () => {
			const composite = new CompositeRule('not', [eqRule(1)]);

			expect(composite.action(1, composite)).toBe(false);
		});

		it('passes every item when it has no children (degenerate)', () => {
			const composite = new CompositeRule('not', []);

			expect(composite.action('anything', composite)).toBe(true);
		});
	});

	describe('nesting', () => {
		it('evaluates a nested AND(OR(...), NOT(...)) tree', () => {
			// (value === 'red' OR value === 'blue') AND NOT (value === 'blue')
			const tree = new CompositeRule('and', [
				new CompositeRule('or', [eqRule('red'), eqRule('blue')]),
				new CompositeRule('not', [eqRule('blue')]),
			]);

			expect(tree.action('red', tree)).toBe(true);
			expect(tree.action('blue', tree)).toBe(false);
			expect(tree.action('green', tree)).toBe(false);
		});
	});

	describe('serialize', () => {
		it('recursively serializes the operator and child rules into a plain tree', () => {
			const child = eqRule('red');
			const composite = new CompositeRule('and', [child]);
			const serialized = composite.serialize();

			expect(serialized.type).toBe('CompositeRule');
			expect(serialized.field).toBeUndefined();
			// Children are serialized (not held by reference), so the tree is structuredClone-safe.
			expect(serialized.config).toEqual({ op: 'and', rules: [child.serialize()]});
		});

		it('serializes nested composites all the way down', () => {
			const tree = new CompositeRule('and', [
				new CompositeRule('or', [eqRule('red'), eqRule('blue')]),
			]);
			const config = tree.serialize().config as {
				readonly op: string;
				readonly rules: readonly { readonly type: string }[];
			};

			expect(config.op).toBe('and');
			expect(config.rules[0]?.type).toBe('CompositeRule');
		});
	});
});
