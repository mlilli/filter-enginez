/**
 * Engine state snapshots — point-in-time captures of internal state used for time-travel,
 * action diffing, and replay.
 *
 * @remarks
 * Implements the Memento pattern (GoF Behavioral, per `docs/architecture.md` §18).
 *
 * **Snapshots intentionally do NOT include source data.** Source data is referenced by version
 * (an integer monotonically incremented by `setSourceData`). A snapshot's size therefore
 * depends on the rule state, not the dataset size, which keeps cross-reload action-log
 * persistence practical.
 *
 * Restoring a snapshot whose `sourceDataVersion` doesn't match the current `store
 * .sourceDataVersion.value` is a legal operation — the snapshot's rules/expression/groups
 * apply to whatever data is currently loaded.
 *
 * @packageDocumentation
 */

import { batch } from '@preact/signals-core';

import type { FilterGroup } from '../composition/FilterGroup.js';
import type { CompositeRule } from '../rules/CompositeRule.js';
import type { FilterRule } from '../rules/FilterRule.js';
import type { RuleId } from '../types.js';
import type { InternalStore } from './InternalStore.js';

// #region docs:engine-snapshot
/**
 * Captured engine state at a point in time. Restorable via `restoreSnapshot`.
 */
export interface EngineSnapshot {
	readonly expression: CompositeRule | null;
	readonly groups: readonly FilterGroup[];
	readonly lastChangeRuleId: RuleId | null;
	readonly rules: ReadonlyMap<RuleId, FilterRule>;
	readonly sourceDataVersion: number;
	readonly workingSetVersion: number;
	readonly capturedAt: number;
}

/**
 * Capture the current state of the engine into an immutable snapshot.
 *
 * @param store - The internal store to snapshot
 * @returns A new `EngineSnapshot` with a fresh `capturedAt` timestamp
 */
export function captureSnapshot<T>(store: InternalStore<T>): EngineSnapshot {
	return {
		capturedAt: Date.now(),
		expression: store.expression.value,
		groups: [...store.groups.value],
		lastChangeRuleId: store.lastChangeRuleId.value,
		rules: new Map(store.rules.value),
		sourceDataVersion: store.sourceDataVersion.value,
		workingSetVersion: store.workingSetVersion.value,
	};
}
// #endregion docs:engine-snapshot

/**
 * Restore engine state from a snapshot.
 *
 * @remarks
 * Restores the rules, expression, groups and `lastChangeRuleId`. Source data and the working
 * set are NOT touched: the snapshot's `sourceDataVersion` / `workingSetVersion` fields are
 * kept for cache-key coherency but not used to roll the store's current versions back.
 *
 * Restoring is a single conceptual operation — all signal writes happen atomically (subscribers
 * see the post-restore state in one update, not per-signal).
 *
 * @param store - The internal store to mutate
 * @param snapshot - The snapshot to restore from
 */
export function restoreSnapshot<T>(
	store: InternalStore<T>,
	snapshot: EngineSnapshot,
): void {
	// All signal writes are wrapped in `batch` so downstream effects + computeds re-run once
	// at the end of the batch — not four times across the four writes. Critical for time-
	// travel UX: a single `jumpTo(index)` produces exactly one re-render at the consumer
	// layer, not one per restored field.
	batch(() => {
		store.rules.value = new Map(snapshot.rules);
		store.expression.value = snapshot.expression;
		store.groups.value = [...snapshot.groups];
		store.lastChangeRuleId.value = snapshot.lastChangeRuleId;
	});
}
