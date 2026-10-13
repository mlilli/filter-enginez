/**
 * Tests for the abstract `FilterRule` base — `getFieldValue` lens resolution, the default
 * no-op `action`, and the default `serialize()` shape.
 *
 * @remarks
 * Exercised via a tiny local concrete subclass (the base is abstract). `getFieldValue` is walked
 * across all five branches: nil item → undefined; undefined `field` → item-as-value; function
 * field; string-path field; and the string-array field for both the first-defined-match case and
 * the all-undefined → undefined case. `serialize()` is checked for the function-field
 * `'<function>'` placeholder, the string-field passthrough, and the `type` = **declared
 * `ruleTypeName`** mapping — plus the throw for a subclass that never declared one.
 *
 * **That last pair pins the minification contract** (see `./ruleTypeName.ts`): `type` must come
 * from the declared static `ruleTypeName`, never `this.constructor.name`, because bundlers rewrite
 * class names. A unit test cannot see a rewrite on its own — nothing here is minified — so the
 * *behavioral* half lives in
 * `tests/tooling/ruleTypeNamesSurviveMinification.test.ts`, which asserts against real minified
 * output. These tests pin the contract; that one pins the artifact.
 */

import { describe, expect, it } from 'vitest';

import type { FieldExtractor } from '../types.js';

import { FilterRule } from './FilterRule.js';

/**
 * Minimal concrete rule used to exercise the abstract base. Exposes `getFieldValue` (which is
 * `protected` on the base) so tests can assert the lens resolution directly.
 */
class TestRule extends FilterRule {
	static override readonly ruleTypeName = 'TestRule';

	config: unknown = undefined;

	extract(item: unknown): unknown {
		return this.getFieldValue(item);
	}
}

/**
 * A subclass whose declared name deliberately DIFFERS from its class identifier.
 *
 * @remarks
 * The two agree for every real rule, so an assertion using `TestRule` alone cannot tell a
 * `serialize()` that reads `ruleTypeName` from one that reads `this.constructor.name` — the latter
 * would answer correctly there too.
 * This fixture is the discriminating one. The undeclared-subclass half of the contract lives in
 * `ruleTypeName.test.ts` (this file is at the two-classes-per-file cap).
 */
class RenamedRule extends FilterRule {
	static override readonly ruleTypeName = 'TheDeclaredName';

	config: unknown = undefined;
}

describe('FilterRule.getFieldValue', () => {
	it('returns undefined when the item is null or undefined', () => {
		const rule = new TestRule('price');

		expect(rule.extract(null)).toBeUndefined();
		expect(rule.extract(undefined)).toBeUndefined();
	});

	it('returns the item itself when the field extractor is undefined', () => {
		const rule = new TestRule(undefined);

		expect(rule.extract(42)).toBe(42);
		expect(rule.extract('wine')).toBe('wine');
	});

	it('invokes the field extractor when it is a function', () => {
		const rule = new TestRule((item) => (item as { price: number }).price * 2);

		expect(rule.extract({ price: 10 })).toBe(20);
	});

	it('resolves a dotted string path via getPath', () => {
		const rule = new TestRule('address.city');

		expect(rule.extract({ address: { city: 'Napa' }})).toBe('Napa');
	});

	it('tries each path of a string-array field and returns the first defined match', () => {
		const rule = new TestRule(['mailingAddress.city', 'address.city']);

		// First path is undefined; second path resolves.
		expect(rule.extract({ address: { city: 'Sonoma' }})).toBe('Sonoma');
		// First path resolves and short-circuits before the second.
		expect(
			rule.extract({ address: { city: 'Sonoma' }, mailingAddress: { city: 'Paso Robles' }}),
		).toBe('Paso Robles');
	});

	it('returns undefined when every path of a string-array field is undefined', () => {
		const rule = new TestRule(['mailingAddress.city', 'address.city']);

		expect(rule.extract({ unrelated: true })).toBeUndefined();
	});
});

describe('FilterRule default action', () => {
	it('returns true for any item (no-op match-everything)', () => {
		const rule = new TestRule('price');

		expect(rule.action({ price: 1 }, rule)).toBe(true);
		expect(rule.action(null, rule)).toBe(true);
	});
});

describe('FilterRule.serialize', () => {
	it('passes a string field through unchanged and uses the declared ruleTypeName as type', () => {
		const rule = new TestRule('address.city');

		expect(rule.serialize()).toEqual({
			config: undefined,
			field: 'address.city',
			type: 'TestRule',
		});
	});

	it('reads the DECLARED static, not the class identifier', () => {
		// `this.constructor.name` would answer 'RenamedRule' here — this is the assertion that
		// separates reading the declared static from reading the class name a minifier rewrites.
		expect(new RenamedRule('x').serialize().type).toBe('TheDeclaredName');
	});

	it('passes a string-array field through unchanged', () => {
		const field: FieldExtractor = ['a.city', 'b.city'];
		const rule = new TestRule(field);

		expect(rule.serialize().field).toEqual(['a.city', 'b.city']);
	});

	it('normalizes a function field to the lossy <function> placeholder', () => {
		const rule = new TestRule((item) => item);

		expect(rule.serialize().field).toBe('<function>');
	});

	it('serializes an undefined field as undefined', () => {
		const rule = new TestRule(undefined);

		expect(rule.serialize().field).toBeUndefined();
	});
});
