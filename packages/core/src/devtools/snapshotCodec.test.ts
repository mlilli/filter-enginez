/**
 * @remarks
 * Tests for `snapshotCodec` — the plain-JSON forms of snapshots, actions and log entries used by
 * persistence, the Redux DevTools bridge and diff. Covers every action shape in both directions,
 * expressions (set, cleared, and a non-composite revival rejected), entry metadata, the `null`
 * results for entries that cannot be stored, and the `null` result for malformed input.
 */

import { describe, expect, it } from 'vitest';

import type { Action } from '../store/Action.js';
import type { EngineSnapshot } from '../store/snapshots.js';
import type { ActionLogEntry } from './ActionLog.js';

import { and } from '../composition/factories.js';
import { CompositeRule } from '../rules/CompositeRule.js';
import { PredicateRule } from '../rules/PredicateRule.js';
import { ValueRule } from '../rules/ValueRule.js';
import {
	deserializeAction,
	deserializeEntry,
	deserializeSnapshot,
	serializeAction,
	serializeEntry,
	serializeSnapshot,
} from './snapshotCodec.js';

function snapshot(overrides: Partial<EngineSnapshot> = {}): EngineSnapshot {
	return {
		capturedAt: 7,
		expression: null,
		groups: [{ composition: 'or', filterIds: ['color'], id: 'g' }],
		lastChangeRuleId: 'color',
		rules: new Map([['color', new ValueRule('color', 'red')]]),
		sourceDataVersion: 2,
		workingSetVersion: 3,
		...overrides,
	};
}

/** Encode then revive through a real JSON round-trip. */
function roundTripAction(action: Action): Action {
	const encoded = serializeAction(action);

	if (encoded === null) {
		throw new Error('expected an encodable action');
	}

	return deserializeAction(JSON.parse(JSON.stringify(encoded)) as typeof encoded);
}

describe('snapshotCodec', () => {
	it('round-trips a snapshot with rules and an expression', () => {
		const original = snapshot({ expression: and(new ValueRule('size', 'L')) });
		const revived = deserializeSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(original))) as ReturnType<typeof serializeSnapshot>);

		expect(revived.rules.get('color')).toBeInstanceOf(ValueRule);
		expect(revived.expression).toBeInstanceOf(CompositeRule);
		expect({ ...revived, expression: null, rules: null }).toEqual({ ...original, expression: null, rules: null });
	});

	it('rejects an expression that revives as a leaf rule', () => {
		const encoded = { ...serializeSnapshot(snapshot()), expression: new ValueRule('a', 1).serialize() };

		expect(() => deserializeSnapshot(encoded)).toThrow(/CompositeRule/u);
	});

	it.each<Action>([
		{ payload: { expression: null }, type: 'EXPRESSION_SET' },
		{ payload: { group: { composition: 'and', filterIds: ['a'], id: 'g' }}, type: 'GROUP_ADDED' },
		{ payload: { groupId: 'g' }, type: 'GROUP_REMOVED' },
		{ payload: { ruleId: 'r' }, type: 'RULE_REMOVED' },
		{ type: 'RESET' },
		{ type: 'RULES_CLEARED' },
		{ type: 'WORKING_SET_RESET' },
	])('round-trips a $type action unchanged', (action) => {
		expect(roundTripAction(action)).toEqual(action);
	});

	it('round-trips rule and expression actions through the registry', () => {
		const rule = new ValueRule('color', 'red');
		const added = roundTripAction({ payload: { rule, ruleId: 'color' }, type: 'RULE_CHANGED' });
		const expressed = roundTripAction({ payload: { expression: and(rule) }, type: 'EXPRESSION_SET' });

		expect(added.type === 'RULE_CHANGED' && added.payload.rule).toBeInstanceOf(ValueRule);
		expect(expressed.type === 'EXPRESSION_SET' && expressed.payload.expression).toBeInstanceOf(CompositeRule);
	});

	it('has no encoded form for data-replacing actions', () => {
		expect(serializeAction({ payload: { items: []}, type: 'SOURCE_DATA_SET' })).toBeNull();
		expect(serializeAction({ payload: { items: []}, type: 'WORKING_SET_SET' })).toBeNull();
	});

	it('encodes and revives a whole entry, keeping its metadata', () => {
		const entry: ActionLogEntry = {
			action: { type: 'RESET' },
			meta: { origin: 'test', source: 'engine' },
			nextStateSnapshot: snapshot(),
			previousStateSnapshot: snapshot({ rules: new Map() }),
			timestamp: 11,
		};
		const revived = deserializeEntry(JSON.parse(JSON.stringify(serializeEntry(entry))));

		expect(revived?.meta).toEqual({ origin: 'test', source: 'engine' });
		expect(revived?.timestamp).toBe(11);
		expect(revived?.previousStateSnapshot.rules.size).toBe(0);
		const bare: ActionLogEntry = {
			action: entry.action,
			nextStateSnapshot: entry.nextStateSnapshot,
			previousStateSnapshot: entry.previousStateSnapshot,
			timestamp: 12,
		};

		expect(deserializeEntry(serializeEntry(bare))).not.toHaveProperty('meta');
	});

	it('returns null for an entry it cannot encode or decode', () => {
		const predicate = new PredicateRule<unknown>(undefined, () => true);
		const entry: ActionLogEntry = {
			action: { type: 'RESET' },
			nextStateSnapshot: snapshot({ rules: new Map([['p', predicate]]) }),
			previousStateSnapshot: snapshot(),
			timestamp: 1,
		};

		expect(serializeEntry(entry)).toBeNull();
		expect(serializeEntry({ ...entry, action: { payload: { items: []}, type: 'SOURCE_DATA_SET' }})).toBeNull();
		expect(deserializeEntry(undefined)).toBeNull();
		expect(deserializeEntry({ action: { type: 'RESET' }})).toBeNull();
	});
});
