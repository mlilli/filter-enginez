/**
 * Tests for the worker-bridge wire-format helpers — `toWireEvent` (serialize rules, strip heavy
 * arrays), `toWireActionLogEntry` (flatten every action type into a thin summary), and the
 * `summarizeRuleConfig` readout reached through `RULE_ADDED` summaries.
 */

import {
	type Action,
	type ActionLogEntry,
	and,
	bool,
	type ChangeEvent,
	type EngineSnapshot,
	exists,
	type FilterRule,
	hierarchical,
	inSet,
	numCompare,
	range,
	text,
	value,
} from '@filter-enginez/core';
import { describe, expect, it } from 'vitest';

import { toWireActionLogEntry, toWireEvent } from './wireFormat.js';

type LogSource = NonNullable<ActionLogEntry['meta']>['source'];

/** A minimal but valid snapshot — `toWireActionLogEntry` never reads it, so the values are inert. */
const snapshot: EngineSnapshot = {
	capturedAt: 0,
	expression: null,
	groups: [],
	lastChangeRuleId: null,
	rules: new Map(),
	sourceDataVersion: 0,
	workingSetVersion: 0,
};

/** Wrap an action in a minimal `ActionLogEntry` and wire-format it. */
function wireOf(action: Action, source?: LogSource): ReturnType<typeof toWireActionLogEntry> {
	const entry: ActionLogEntry = {
		action,
		nextStateSnapshot: snapshot,
		previousStateSnapshot: snapshot,
		timestamp: 1234,
		...(source !== undefined && { meta: { source }}),
	};

	return toWireActionLogEntry(entry);
}

/** The devtools "args" summary a `RULE_ADDED` entry produces for a given rule. */
function summaryForRule(rule: FilterRule): string {
	return wireOf({ payload: { rule, ruleId: 'r' }, type: 'RULE_ADDED' }).summary;
}

describe('toWireEvent', () => {
	it('serializes both sides of an expression event and preserves nulls', () => {
		const expr = and(range('price', { max: 100, min: 0 }));

		expect(toWireEvent({ next: expr, previous: null, type: 'expression' })).toEqual({
			next: expr.serialize(),
			previous: null,
			type: 'expression',
		});
		expect(toWireEvent({ next: null, previous: expr, type: 'expression' })).toEqual({
			next: null,
			previous: expr.serialize(),
			type: 'expression',
		});
	});

	it('passes a reset event through unchanged', () => {
		expect(toWireEvent({ type: 'reset' })).toEqual({ type: 'reset' });
	});

	it('strips the heavy before/after arrays from data events', () => {
		for (const type of ['results', 'sourceData', 'workingSet'] as const) {
			expect(toWireEvent({ next: [1, 2, 3], previous: [4, 5], type })).toEqual({
				next: [],
				previous: [],
				type,
			});
		}
	});

	it('serializes the rule on rule:added and rule:removed', () => {
		const rule = range('price', { max: 100, min: 0 });

		expect(toWireEvent({ rule, ruleId: 'price', type: 'rule:added' })).toEqual({
			rule: rule.serialize(),
			ruleId: 'price',
			type: 'rule:added',
		});
		expect(toWireEvent({ rule, ruleId: 'price', type: 'rule:removed' })).toEqual({
			rule: rule.serialize(),
			ruleId: 'price',
			type: 'rule:removed',
		});
	});

	it('serializes both sides on rule:changed', () => {
		const previous = range('price', { max: 100, min: 0 });
		const next = range('price', { max: 50, min: 10 });

		expect(toWireEvent({ next, previous, ruleId: 'price', type: 'rule:changed' })).toEqual({
			next: next.serialize(),
			previous: previous.serialize(),
			ruleId: 'price',
			type: 'rule:changed',
		});
	});

	it('passes an unknown event type through the exhaustiveness default', () => {
		const unknownEvent = { type: '__unknown__' } as unknown as ChangeEvent;

		expect(toWireEvent(unknownEvent)).toBe(unknownEvent);
	});
});

describe('toWireActionLogEntry', () => {
	it('carries timestamp through and includes source only when present', () => {
		expect(wireOf({ type: 'RESET' }, 'engine')).toMatchObject({ source: 'engine', timestamp: 1234 });
		expect(wireOf({ type: 'RESET' })).not.toHaveProperty('source');
	});

	it('summarizes an EXPRESSION_SET (set vs cleared)', () => {
		expect(wireOf({ payload: { expression: and(exists('x')) }, type: 'EXPRESSION_SET' }).summary)
			.toBe('set expression');
		expect(wireOf({ payload: { expression: null }, type: 'EXPRESSION_SET' }).summary)
			.toBe('cleared expression');
	});

	it('summarizes group add / remove with the group id', () => {
		const added = wireOf({
			payload: { group: { composition: 'or', filterIds: ['a'], id: 'grp' }},
			type: 'GROUP_ADDED',
		});

		expect(added).toMatchObject({ groupId: 'grp', summary: 'added group <grp>' });

		const removed = wireOf({ payload: { groupId: 'grp' }, type: 'GROUP_REMOVED' });

		expect(removed).toMatchObject({ groupId: 'grp', summary: 'removed group <grp>' });
	});

	it('summarizes rule add / change / remove', () => {
		const added = wireOf({
			payload: { rule: range('price', { max: 100, min: 0 }), ruleId: 'price' },
			type: 'RULE_ADDED',
		});

		expect(added).toMatchObject({ ruleId: 'price', ruleType: 'RangeRule', type: 'RULE_ADDED' });
		expect(added.summary).toContain('RangeRule <price>');

		const changed = wireOf({
			payload: { rule: range('price', { max: 50, min: 5 }), ruleId: 'price' },
			type: 'RULE_CHANGED',
		});

		expect(changed.type).toBe('RULE_CHANGED');

		expect(wireOf({ payload: { ruleId: 'price' }, type: 'RULE_REMOVED' }).summary)
			.toBe('removed <price>');
	});

	it('summarizes reset / clear / source-data / working-set actions', () => {
		expect(wireOf({ type: 'RESET' }).summary).toBe('reset engine');
		expect(wireOf({ type: 'RULES_CLEARED' }).summary).toBe('cleared all rules');
		expect(wireOf({ payload: { items: [1, 2, 3]}, type: 'SOURCE_DATA_SET' }).summary)
			.toBe('setSourceData (3 items)');
		expect(wireOf({ type: 'WORKING_SET_RESET' }).summary).toBe('reset working set to source data');
		expect(wireOf({ payload: { items: [1, 2]}, type: 'WORKING_SET_SET' }).summary)
			.toBe('setWorkingSet (2 items)');
	});

	it('flags an unknown action type via the exhaustiveness default', () => {
		const unknownAction = { type: '__UNKNOWN__' } as unknown as Action;

		expect(wireOf(unknownAction).type).toBe('unknown');
	});
});

describe('summarizeRuleConfig (via RULE_ADDED summary)', () => {
	it('omits a suffix for a nil config', () => {
		expect(summaryForRule(exists('field'))).toBe('ExistsRule <r>');
	});

	it('renders primitive configs inline', () => {
		expect(summaryForRule(value('field', 'red'))).toContain(' = red');
		expect(summaryForRule(value('field', 5))).toContain(' = 5');
		expect(summaryForRule(value('field', 10n))).toContain(' = 10');
		expect(summaryForRule(bool('field', true))).toContain(' = true');
	});

	it('omits a suffix for a non-object, non-primitive config', () => {
		// `constructor.ruleTypeName`, NOT `constructor.name` — the wire format labels entries with
		// the declared static because every minifier rewrites the class identifier. Stubbing
		// `name` here would shape this fake after the wrong property rather than the contract.
		const fnConfigRule = {
			config: (): number => 0,
			constructor: { ruleTypeName: 'FnRule' },
		} as unknown as FilterRule;

		expect(summaryForRule(fnConfigRule)).toBe('FnRule <r>');
	});

	it('renders a range config, with ∞ for an infinite bound', () => {
		expect(summaryForRule(range('price', { max: 100, min: 0 }))).toContain('[0, 100]');
		expect(summaryForRule(range('price', { max: Infinity, min: 5 }))).toContain('[5, ∞]');
	});

	it('renders an in-set config by size', () => {
		expect(summaryForRule(inSet('c', []))).toContain('{ }');
		expect(summaryForRule(inSet('c', ['a', 'b']))).toContain('{ a, b }');
		expect(summaryForRule(inSet('c', ['a', 'b', 'c']))).toContain('{ a, +2 more }');
	});

	it('renders a hierarchical selection count', () => {
		const tree = { id: 'root' };

		expect(summaryForRule(hierarchical('region', { selected: [], tree }))).toContain('(no selection)');
		expect(summaryForRule(hierarchical('region', { selected: ['root'], tree }))).toContain('(1 selected)');
	});

	it('renders a text query, empty and truncated', () => {
		expect(summaryForRule(text('n', { mode: 'substring', query: '' }))).toContain('(empty)');
		expect(summaryForRule(text('n', { mode: 'substring', query: 'hello' }))).toContain('"hello"');
		expect(summaryForRule(text('n', { mode: 'substring', query: 'x'.repeat(40) }))).toContain('…');
	});

	it('omits a suffix for an unrecognized object config', () => {
		expect(summaryForRule(numCompare('score', { op: '>', value: 5 }))).toBe('NumericComparisonRule <r>');
	});
});
