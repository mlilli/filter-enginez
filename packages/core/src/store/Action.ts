/**
 * `Action` — the typed discriminated union covering every state mutation the engine performs.
 *
 * @remarks
 * Implements the Command pattern (GoF Behavioral, per `docs/architecture.md` §18). Every
 * mutation to engine state passes through a `Dispatcher.dispatch(action)` call. Actions are:
 *
 *   - **Replayable** — `devtools.replay()` re-applies a sequence of actions
 *   - **Serializable** — actions are recorded in the action log, and devtools persistence
 *     encodes them for storage (the `RULE_*` action payloads reference `FilterRule` instances;
 *     `devtools/snapshotCodec.ts` encodes those via `rule.serialize()`)
 *   - **Time-travelable** — each action's previous/next snapshots support `jumpTo` scrubbing
 *
 * Subscribers receive `ChangeEvent`s (see `types.ts`), NOT raw `Action`s. The Action is the
 * internal mutation language; ChangeEvent is the public notification language. The translation
 * happens in `FilterEngine`.
 *
 * @packageDocumentation
 */

import type { FilterGroup } from '../composition/FilterGroup.js';
import type { CompositeRule } from '../rules/CompositeRule.js';
import type { FilterRule } from '../rules/FilterRule.js';
import type { RuleId } from '../types.js';

/**
 * The full action union — discriminated by `type`.
 */
export type Action =
	| {
		readonly payload: { readonly expression: CompositeRule | null };
		readonly type: 'EXPRESSION_SET';
	}
	| {
		readonly payload: { readonly group: FilterGroup };
		readonly type: 'GROUP_ADDED';
	}
	| {
		readonly payload: { readonly groupId: string };
		readonly type: 'GROUP_REMOVED';
	}
	| {
		readonly payload: { readonly items: readonly unknown[] };
		readonly type: 'SOURCE_DATA_SET';
	}
	| {
		readonly payload: { readonly items: readonly unknown[] };
		readonly type: 'WORKING_SET_SET';
	}
	| {
		readonly payload: { readonly rule: FilterRule; readonly ruleId: RuleId; };
		readonly type: 'RULE_ADDED';
	}
	| {
		readonly payload: { readonly rule: FilterRule; readonly ruleId: RuleId; };
		readonly type: 'RULE_CHANGED';
	}
	| {
		readonly payload: { readonly ruleId: RuleId };
		readonly type: 'RULE_REMOVED';
	}
	| {
		readonly type: 'RESET';
	}
	| {
		readonly type: 'RULES_CLEARED';
	}
	| {
		readonly type: 'WORKING_SET_RESET';
	};

/**
 * Extract the literal action `type` strings as a string-literal union.
 *
 * @example
 *   const t: ActionType = 'RULE_ADDED';  // OK
 *   const u: ActionType = 'INVALID_ACTION';  // error — not in the union
 */
export type ActionType = Action['type'];
