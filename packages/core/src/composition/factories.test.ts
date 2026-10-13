/**
 * Tests for the composition factory functions — `and()`, `or()`, `not()`.
 *
 * @remarks
 * Each factory is an ergonomic builder over `CompositeRule`. The assertions confirm the
 * produced node is a `CompositeRule` with the correct operator and child list (variadic
 * spread for `and`/`or`, single-child wrapping for `not`), the zero-argument degenerate
 * shapes, and that the resulting trees evaluate per the operator semantics so the builders
 * are verified end-to-end, not just structurally.
 */

import { describe, expect, it } from 'vitest';

import { CompositeRule } from '../rules/CompositeRule.js';
import { ValueRule } from '../rules/ValueRule.js';
import { and, not, or } from './factories.js';

/** A leaf rule that passes only items strictly equal to `target`. */
const eqRule = (target: unknown): ValueRule => new ValueRule(undefined, target);

describe('and', () => {
	it('produces a CompositeRule with the "and" operator and spread children', () => {
		const a = eqRule(1);
		const b = eqRule(2);
		const node = and(a, b);

		expect(node).toBeInstanceOf(CompositeRule);
		expect(node.config.op).toBe('and');
		expect(node.config.rules).toEqual([a, b]);
	});

	it('produces an empty "and" (no constraint) when called with no rules', () => {
		const node = and();

		expect(node.config.op).toBe('and');
		expect(node.config.rules).toEqual([]);
		expect(node.action('anything', node)).toBe(true);
	});

	it('evaluates as logical AND of its children', () => {
		const passing = and(eqRule(1), eqRule(1));
		const failing = and(eqRule(1), eqRule(2));

		expect(passing.action(1, passing)).toBe(true);
		expect(failing.action(1, failing)).toBe(false);
	});
});

describe('or', () => {
	it('produces a CompositeRule with the "or" operator and spread children', () => {
		const a = eqRule('red');
		const b = eqRule('blue');
		const node = or(a, b);

		expect(node).toBeInstanceOf(CompositeRule);
		expect(node.config.op).toBe('or');
		expect(node.config.rules).toEqual([a, b]);
	});

	it('produces an empty "or" (no-op match) when called with no rules', () => {
		const node = or();

		expect(node.config.op).toBe('or');
		expect(node.config.rules).toEqual([]);
		expect(node.action('anything', node)).toBe(true);
	});

	it('evaluates as logical OR of its children', () => {
		const node = or(eqRule('red'), eqRule('blue'));

		expect(node.action('blue', node)).toBe(true);
		expect(node.action('green', node)).toBe(false);
	});
});

describe('not', () => {
	it('produces a CompositeRule with the "not" operator wrapping a single child', () => {
		const child = eqRule(1);
		const node = not(child);

		expect(node).toBeInstanceOf(CompositeRule);
		expect(node.config.op).toBe('not');
		expect(node.config.rules).toEqual([child]);
	});

	it('inverts the wrapped child during evaluation', () => {
		const node = not(eqRule(1));

		expect(node.action(2, node)).toBe(true);
		expect(node.action(1, node)).toBe(false);
	});
});
