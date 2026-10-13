/**
 * @remarks
 * `types.ts` is a type-only module — it exports interfaces, unions, and type aliases with NO
 * runtime values, so it reports 0/0 coverage and there is nothing to execute. These tests are
 * thin compile-time shape assertions: each one constructs a value of the exported type and
 * asserts a structural property, so the type vocabulary is exercised by `tsc` (and a trivial
 * runtime assertion keeps Vitest happy). Behavior of the consumers of these types lives in the
 * suites for `FilterEngine`, `applyFiltersAndQuery`, and the store.
 */

import { describe, expect, it } from 'vitest';

import type {
	ChangeEvent,
	ChangeListener,
	FieldExtractor,
	FilterRuleAction,
	RuleId,
	SerializedRule,
	SimulationModification,
	SimulationResult,
	Unsubscribe,
} from './types.js';

import { ValueRule } from './rules/ValueRule.js';

describe('types', () => {
	it('RuleId is a string alias', () => {
		const id: RuleId = 'price-range';

		expect(id).toBe('price-range');
	});

	it('FieldExtractor accepts each of its four forms', () => {
		const asString: FieldExtractor = 'price';
		const asPaths: FieldExtractor = ['a.b', 'c.d'];
		const asFn: FieldExtractor = (item): unknown => item;
		const asUndefined: FieldExtractor = undefined;

		expect(asString).toBe('price');
		expect(asPaths).toHaveLength(2);
		expect(asFn('x')).toBe('x');
		expect(asUndefined).toBeUndefined();
	});

	it('FilterRuleAction is the rule predicate signature', () => {
		const rule = new ValueRule('color', 'red');
		const action: FilterRuleAction = (item, r) => r.action(item, r);

		expect(action({ color: 'red' }, rule)).toBe(true);
		expect(action({ color: 'blue' }, rule)).toBe(false);
	});

	it('SerializedRule carries type / field / config', () => {
		const serialized: SerializedRule = { config: 'red', field: 'color', type: 'ValueRule' };

		expect(serialized.type).toBe('ValueRule');
	});

	it('ChangeEvent narrows on its type discriminator', () => {
		const reset: ChangeEvent = { type: 'reset' };
		const sourceData: ChangeEvent = { next: [1], previous: [], type: 'sourceData' };

		expect(reset.type).toBe('reset');
		expect(sourceData.type).toBe('sourceData');
	});

	it('ChangeListener + Unsubscribe form the subscribe contract', () => {
		let didFire = false;
		const listener: ChangeListener = () => {
			didFire = true;
		};
		const unsubscribe: Unsubscribe = () => {
			didFire = false;
		};

		listener({ type: 'reset' });
		expect(didFire).toBe(true);
		unsubscribe();
		expect(didFire).toBe(false);
	});

	it('SimulationModification + SimulationResult describe the simulate contract', () => {
		const rule = new ValueRule('color', 'red');
		const modification: SimulationModification = {
			ignoreRules: ['x'],
			withRule: ['color', rule],
		};
		const result: SimulationResult<{ color: string }> = {
			cacheKey: 'k',
			resultCount: 0,
			sample: [],
			wouldBeEmpty: true,
		};

		expect(modification.withRule?.[0]).toBe('color');
		expect(result.wouldBeEmpty).toBe(true);
	});
});
