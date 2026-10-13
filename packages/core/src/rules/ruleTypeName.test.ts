/**
 * Tests for `getRuleTypeName` — the single accessor that both `FilterRule.serialize()` and the
 * worker bridge's devtools "args" column read.
 *
 * @remarks
 * The contract has two halves and they are deliberately different: the accessor **never throws**
 * (an action-log label that throws is worse than a vague one), while `serialize()` **does** throw
 * on the undeclared case (a wire `type` nothing can revive is worse than a loud refusal). Both
 * halves are asserted here and in `FilterRule.test.ts` respectively.
 */

import { describe, expect, it } from 'vitest';

import { FilterRule } from './FilterRule.js';
import { InSetRule } from './InSetRule.js';
import { RangeRule } from './RangeRule.js';
import { getRuleTypeName } from './ruleTypeName.js';

/** A subclass whose declared name deliberately differs from its class identifier. */
class RenamedRule extends FilterRule {
	static override readonly ruleTypeName = 'TheDeclaredName';

	config: unknown = undefined;
}

/** A subclass that never declared `ruleTypeName` — the mistake the contract exists to catch. */
class UndeclaredRule extends FilterRule {
	config: unknown = undefined;
}

describe('getRuleTypeName', () => {
	it('returns the name a built-in rule declares', () => {
		expect(getRuleTypeName(new InSetRule('genre', ['fiction']))).toBe('InSetRule');
		expect(getRuleTypeName(new RangeRule('year', { max: 2025, min: 2000 }))).toBe('RangeRule');
	});

	it('returns the DECLARED name even when it differs from the class identifier', () => {
		// `constructor.name` would answer 'RenamedRule' — this is what distinguishes reading the
		// declared static from reading a class name that a production build mangles.
		expect(getRuleTypeName(new RenamedRule())).toBe('TheDeclaredName');
	});

	it('falls back to the base sentinel — without throwing — for an undeclared subclass', () => {
		expect(getRuleTypeName(new UndeclaredRule())).toBe('FilterRule');
	});
});

describe('FilterRule.serialize — the enforcing half of the same contract', () => {
	it('refuses to serialize a subclass that never declared ruleTypeName', () => {
		// Deliberately louder than the accessor: a wire `type` that no registry entry matches
		// surfaces later, somewhere else, inside a `catch`, far from the subclass that caused it.
		expect(() => new UndeclaredRule('price').serialize()).toThrowError(/does not declare/);
	});
});
