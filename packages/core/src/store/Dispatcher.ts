/**
 * `Dispatcher` — applies typed actions to the engine's internal store.
 *
 * @remarks
 * Per Pillar 4 (`docs/architecture.md` §1.4): every state mutation is an `Action`. The
 * dispatcher is the reducer half — it turns an action into signal writes, batched so effects
 * and computeds observe one consistent post-action state. The surrounding pipeline (snapshot
 * capture, acceleration-cache invalidation, action-log recording, Redux DevTools forwarding,
 * change events) is `FilterEngine`'s private `_dispatchAndEmit`, which every public mutator
 * calls. Consumers mutate through the engine's methods; calling `dispatch` directly applies the
 * state change without recording or notifying anything.
 *
 * `apply` is public for the devtools `Replay` module, which re-applies logged actions.
 *
 * @packageDocumentation
 */

import { batch } from '@preact/signals-core';

import type { Action } from './Action.js';
import type { InternalStore } from './InternalStore.js';

// #region docs:dispatcher-apply
/**
 * Routes `Action` instances to the appropriate state mutations on an `InternalStore`.
 */
export class Dispatcher<T> {
	constructor(private readonly _store: InternalStore<T>) {}

	/**
	 * Apply an action to the store. Equivalent to {@link Dispatcher.apply}; `FilterEngine` wraps
	 * it with the recording and notification pipeline.
	 *
	 * @param action - The action to dispatch
	 */
	dispatch(action: Action): void {
		this.apply(action);
	}

	/**
	 * Apply an action to the store without logging it. Used by the devtools `Replay` module
	 * (and internally by `dispatch`). The writes are batched: an action that touches several
	 * signals (`RESET`, `SOURCE_DATA_SET`) is observed as one change, never a half-applied one.
	 *
	 * @param action - The action to apply
	 */
	apply(action: Action): void {
		batch(() => {
			this._applyUnbatched(action);
		});
	}

	/** The per-action signal writes; always called inside {@link Dispatcher.apply}'s batch. */
	private _applyUnbatched(action: Action): void {
		const store = this._store;

		switch (action.type) {
			case 'EXPRESSION_SET': {
				store.expression.value = action.payload.expression;

				return;
			}
			case 'GROUP_ADDED': {
				store.groups.value = [...store.groups.value, action.payload.group];

				return;
			}
			case 'GROUP_REMOVED': {
				store.groups.value = store.groups.value.filter(
					(group) => group.id !== action.payload.groupId,
				);

				return;
			}
			case 'RESET': {
				store.rules.value = new Map();
				store.groups.value = [];
				store.expression.value = null;
				store.workingSet.value = store.sourceData.value;
				store.workingSetVersion.value = store.workingSetVersion.value + 1;
				store.lastChangeRuleId.value = null;
				store.lastChangeTimestamp.value = null;

				return;
			}
			case 'RULE_ADDED':
			case 'RULE_CHANGED': {
				const next = new Map(store.rules.value);

				next.set(action.payload.ruleId, action.payload.rule);
				store.rules.value = next;
				store.lastChangeRuleId.value = action.payload.ruleId;
				store.lastChangeTimestamp.value = Date.now();

				return;
			}
			case 'RULE_REMOVED': {
				const next = new Map(store.rules.value);

				next.delete(action.payload.ruleId);
				store.rules.value = next;
				store.lastChangeRuleId.value = action.payload.ruleId;
				store.lastChangeTimestamp.value = Date.now();

				return;
			}
			// #endregion docs:dispatcher-apply
			case 'RULES_CLEARED': {
				store.rules.value = new Map();
				store.groups.value = [];
				store.expression.value = null;
				// Stamped like every other rule mutation, so a consumer that anchors on
				// `lastChangeTimestamp` alone (a "computing" indicator that settles when the
				// timestamp moves) sees a clear-all. `ruleId` is null because no single rule
				// changed, matching RESET above.
				store.lastChangeRuleId.value = null;
				store.lastChangeTimestamp.value = Date.now();

				return;
			}
			case 'SOURCE_DATA_SET': {
				const items = action.payload.items as readonly T[];

				store.sourceData.value = items;
				store.sourceDataVersion.value = store.sourceDataVersion.value + 1;
				// Reset workingSet to mirror the new sourceData by default.
				store.workingSet.value = items;
				store.workingSetVersion.value = store.workingSetVersion.value + 1;

				return;
			}
			case 'WORKING_SET_RESET': {
				store.workingSet.value = store.sourceData.value;
				store.workingSetVersion.value = store.workingSetVersion.value + 1;

				return;
			}
			case 'WORKING_SET_SET': {
				store.workingSet.value = action.payload.items as readonly T[];
				store.workingSetVersion.value = store.workingSetVersion.value + 1;

				return;
			}
		}
	}
}
