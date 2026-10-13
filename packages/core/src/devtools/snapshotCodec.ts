/**
 * `snapshotCodec` — plain-JSON forms of engine snapshots and action-log entries.
 *
 * @remarks
 * `EngineSnapshot` holds live `FilterRule` instances in a `Map`, and actions carry live rules
 * too. Neither survives `JSON.stringify` (a `Map` becomes `{}`) or `structuredClone` (a rule's
 * `action` is a function). Three devtools features need the plain form:
 *
 *   - **Persistence** (`DevtoolsPersistence`) writes encoded entries to any `StorageAdapter`
 *     and revives them through the rule registry on load.
 *   - **The Redux DevTools bridge** sends encoded actions and states, so the extension shows
 *     each rule's type, field and config rather than an empty object.
 *   - **Diff** (`diff`) compares encoded snapshots, so a rule change shows up as an edit.
 *
 * Rules encode through `rule.serialize()` and revive through `ruleRegistry.deserialize()` —
 * the same round-trip JSON config and the worker bridge use (§9.3). A rule that cannot
 * serialize (a `PredicateRule`) leaves its entry without a plain form; persistence skips such entries.
 *
 * @packageDocumentation
 */

import type { FilterGroup } from '../composition/FilterGroup.js';
import type { FilterRule } from '../rules/FilterRule.js';
import type { Action } from '../store/Action.js';
import type { EngineSnapshot } from '../store/snapshots.js';
import type { RuleId, SerializedRule } from '../types.js';
import type { ActionLogEntry, ActionLogEntryMeta } from './ActionLog.js';

import { FilterEngineRuleError } from '../errors/index.js';
import { CompositeRule } from '../rules/CompositeRule.js';
import { ruleRegistry } from '../rules/ruleRegistry.js';

/** The plain-JSON form of an {@link EngineSnapshot}. */
export interface SerializedEngineSnapshot {
	readonly expression: SerializedRule | null;
	readonly groups: readonly FilterGroup[];
	readonly lastChangeRuleId: RuleId | null;
	readonly capturedAt: number;
	/** `[ruleId, serialized rule]` pairs, in registration order. */
	readonly rules: readonly (readonly [RuleId, SerializedRule])[];
	readonly sourceDataVersion: number;
	readonly workingSetVersion: number;
}

/**
 * The plain-JSON form of a filter-state {@link Action}. Actions that replace the data itself
 * (`SOURCE_DATA_SET`, `WORKING_SET_SET`) have no encoded form: the items belong to the
 * application, not to the filter state.
 */
export type SerializedAction =
	| { readonly payload: { readonly expression: SerializedRule | null }; readonly type: 'EXPRESSION_SET' }
	| { readonly payload: { readonly group: FilterGroup }; readonly type: 'GROUP_ADDED' }
	| { readonly payload: { readonly groupId: string }; readonly type: 'GROUP_REMOVED' }
	| { readonly payload: { readonly rule: SerializedRule; readonly ruleId: RuleId }; readonly type: 'RULE_ADDED' | 'RULE_CHANGED' }
	| { readonly payload: { readonly ruleId: RuleId }; readonly type: 'RULE_REMOVED' }
	| { readonly type: 'RESET' | 'RULES_CLEARED' | 'WORKING_SET_RESET' };

/** The plain-JSON form of an {@link ActionLogEntry}. */
export interface SerializedActionLogEntry {
	readonly action: SerializedAction;
	readonly meta?: ActionLogEntryMeta;
	readonly nextStateSnapshot: SerializedEngineSnapshot;
	readonly previousStateSnapshot: SerializedEngineSnapshot;
	readonly timestamp: number;
}

/**
 * Encode a snapshot. Throws when a rule in it cannot serialize (`PredicateRule`).
 */
export function serializeSnapshot(snapshot: EngineSnapshot): SerializedEngineSnapshot {
	return {
		capturedAt: snapshot.capturedAt,
		expression: snapshot.expression === null ? null : snapshot.expression.serialize(),
		groups: snapshot.groups,
		lastChangeRuleId: snapshot.lastChangeRuleId,
		rules: [...snapshot.rules].map(([id, rule]) => [id, rule.serialize()] as const),
		sourceDataVersion: snapshot.sourceDataVersion,
		workingSetVersion: snapshot.workingSetVersion,
	};
}

/** Revive an expression, insisting the result is a composite (what `EngineSnapshot` holds). */
function deserializeExpression(json: SerializedRule | null): CompositeRule | null {
	if (json === null) {
		return null;
	}
	const rule: FilterRule = ruleRegistry.deserialize(json);

	if (!(rule instanceof CompositeRule)) {
		throw new FilterEngineRuleError(
			'RULE_INVALID_SERIALIZED_CONFIG',
			`snapshotCodec: an expression must revive as a CompositeRule, got '${json.type}'.`,
		);
	}

	return rule;
}

/**
 * Revive a snapshot through the rule registry. Throws when a rule type is not registered.
 */
export function deserializeSnapshot(json: SerializedEngineSnapshot): EngineSnapshot {
	return {
		capturedAt: json.capturedAt,
		expression: deserializeExpression(json.expression),
		groups: json.groups,
		lastChangeRuleId: json.lastChangeRuleId,
		rules: new Map(json.rules.map(([id, rule]) => [id, ruleRegistry.deserialize(rule)])),
		sourceDataVersion: json.sourceDataVersion,
		workingSetVersion: json.workingSetVersion,
	};
}

/**
 * Encode an action, or return `null` for an action that replaces the data itself. Throws when
 * the action carries a rule that cannot serialize.
 */
export function serializeAction(action: Action): SerializedAction | null {
	switch (action.type) {
		case 'EXPRESSION_SET':
			return {
				payload: { expression: action.payload.expression === null ? null : action.payload.expression.serialize() },
				type: action.type,
			};
		case 'RULE_ADDED':
		case 'RULE_CHANGED':
			return { payload: { rule: action.payload.rule.serialize(), ruleId: action.payload.ruleId }, type: action.type };
		case 'SOURCE_DATA_SET':
		case 'WORKING_SET_SET':
			return null;
		default:
			return action;
	}
}

/** Revive an encoded action through the rule registry. */
export function deserializeAction(json: SerializedAction): Action {
	switch (json.type) {
		case 'EXPRESSION_SET':
			return { payload: { expression: deserializeExpression(json.payload.expression) }, type: json.type };
		case 'RULE_ADDED':
		case 'RULE_CHANGED':
			return { payload: { rule: ruleRegistry.deserialize(json.payload.rule), ruleId: json.payload.ruleId }, type: json.type };
		default:
			return json;
	}
}

/**
 * Encode an action-log entry, or return `null` when it has no plain form — a data-replacing
 * action, or a rule that cannot serialize anywhere in the entry.
 */
export function serializeEntry(entry: ActionLogEntry): SerializedActionLogEntry | null {
	try {
		const action = serializeAction(entry.action);

		if (action === null) {
			return null;
		}

		return {
			action,
			...(entry.meta && { meta: entry.meta }),
			nextStateSnapshot: serializeSnapshot(entry.nextStateSnapshot),
			previousStateSnapshot: serializeSnapshot(entry.previousStateSnapshot),
			timestamp: entry.timestamp,
		};
	} catch {
		return null;
	}
}

/**
 * Revive an encoded entry, or return `null` when it is malformed or names a rule type this
 * runtime has not registered. A persisted log is untrusted input, so nothing here throws.
 */
export function deserializeEntry(json: unknown): ActionLogEntry | null {
	try {
		const candidate = json as SerializedActionLogEntry;

		return {
			action: deserializeAction(candidate.action),
			...(candidate.meta && { meta: candidate.meta }),
			nextStateSnapshot: deserializeSnapshot(candidate.nextStateSnapshot),
			previousStateSnapshot: deserializeSnapshot(candidate.previousStateSnapshot),
			timestamp: candidate.timestamp,
		};
	} catch {
		return null;
	}
}
