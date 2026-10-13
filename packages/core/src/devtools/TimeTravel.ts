/**
 * `TimeTravel` — undo / redo / jumpTo orchestration on top of the action log + store snapshots.
 *
 * @remarks
 * Implements the time-travel scrubbing API per `docs/architecture.md` §10.3. Owns no state of
 * its own — delegates to `ActionLog` (cursor + entries) and `InternalStore` (signal
 * restoration via `restoreSnapshot`).
 *
 * Standard semantics:
 *   - `undo()` → moves to previous entry's `previousStateSnapshot`
 *   - `redo()` → moves to next entry's `nextStateSnapshot`
 *   - `jumpTo(i)` → moves to entry `i`'s `nextStateSnapshot`
 *
 * @packageDocumentation
 */

import type { InternalStore } from '../store/InternalStore.js';
import type { ChangeEvent } from '../types.js';
import type { ActionLog } from './ActionLog.js';

import { FilterEngineError } from '../errors/index.js';
import { restoreSnapshot } from '../store/snapshots.js';

/**
 * Notifier invoked after a time-travel restore actually changes state, so every reactive
 * surface (signals fan-out, RxJS bridge, Redux mirror, URL sync) re-reads the restored engine.
 *
 * @remarks
 * A time-travel restore writes the store signals directly via `restoreSnapshot` — it does NOT
 * go through the dispatcher, so nothing emits a `ChangeEvent` on its own. Without this callback
 * an `undo()` / `redo()` silently mutates the core while the signal-backed facades that render
 * the UI (active-rule chips, result count, active expression) stay stale. `TimeTravel` therefore
 * asks its owner (`FilterEngine`, via `Devtools`) to emit on its behalf. A `'reset'` event is the
 * correct shape: it already denotes "a wholesale state change happened — re-read everything," so
 * subscribers restore in lockstep without TimeTravel having to reason about which fields moved.
 */
export type TimeTravelEmit = (event: ChangeEvent) => void;

/**
 * Time-travel API. Backed by an `ActionLog` cursor + `InternalStore` snapshot restoration.
 */
export class TimeTravel<T> {
	/**
	 * @param _store - The internal store whose signals are restored from snapshots.
	 * @param _actionLog - The cursor + entries backing undo/redo/jumpTo.
	 * @param _emitChange - Called with `{ type: 'reset' }` after any restore that actually
	 *   changed state, so reactive surfaces re-read. Optional so a bare `new TimeTravel(store,
	 *   log)` (tests, headless replay) keeps working — it just won't notify.
	 * @param _beforeRestore - Called just before a snapshot is written to the store, so the owner
	 *   can drop caches keyed on the state being replaced (`FilterEngine` clears its bitmap,
	 *   exclusion-graph and simulation caches here).
	 */
	constructor(
		private readonly _store: InternalStore<T>,
		private readonly _actionLog: ActionLog,
		private readonly _emitChange?: TimeTravelEmit,
		private readonly _beforeRestore?: () => void,
	) {}

	/**
	 * The cursor's current position in the action log. `-1` when no actions have been
	 * dispatched yet.
	 */
	get currentIndex(): number {
		return this._actionLog.currentIndex;
	}

	/** True if there's at least one prior state to restore. */
	get canUndo(): boolean {
		return this._actionLog.currentIndex >= 0;
	}

	/** True if there's at least one future state to restore (user has previously jumped back). */
	get canRedo(): boolean {
		return this._actionLog.currentIndex < this._actionLog.size - 1;
	}

	// #region docs:jump-undo-redo
	/**
	 * Jump to a specific entry in the action log and restore its post-state.
	 *
	 * @param index - Target index. `-1` restores the pre-first-action state (engine reset
	 *                to whatever it was at construction).
	 * @throws `FilterEngineError` with code `DEVTOOLS_INDEX_OUT_OF_RANGE` if index is out of range
	 */
	jumpTo(index: number): void {
		if (index === -1) {
			// Restoring to before any action — use entry 0's `previousStateSnapshot`, which IS
			// the state captured immediately before the first dispatched action ran. That's
			// the canonical "pre-modification" state without needing a separate construction
			// snapshot tracked alongside the action log.
			const first = this._actionLog.get(0);

			if (first !== undefined) {
				this._beforeRestore?.();
				restoreSnapshot(this._store, first.previousStateSnapshot);
				this._actionLog.setCurrentIndex(-1);
				// Only notify when a snapshot was actually restored — an empty log is a true no-op.
				this._emitChange?.({ type: 'reset' });

				return;
			}
			this._actionLog.setCurrentIndex(-1);

			return;
		}
		const entry = this._actionLog.get(index);

		if (!entry) {
			throw new FilterEngineError(
				'DEVTOOLS_INDEX_OUT_OF_RANGE',
				`Cannot jumpTo index ${index} — out of range (action log has ${this._actionLog.size} entries)`,
			);
		}
		this._beforeRestore?.();
		restoreSnapshot(this._store, entry.nextStateSnapshot);
		this._actionLog.setCurrentIndex(index);
		this._emitChange?.({ type: 'reset' });
	}

	/** Step backward one action. No-op if already at -1. */
	undo(): void {
		if (this.canUndo) {
			this.jumpTo(this._actionLog.currentIndex - 1);
		}
	}

	/** Step forward one action. No-op if already at the latest. */
	redo(): void {
		if (this.canRedo) {
			this.jumpTo(this._actionLog.currentIndex + 1);
		}
	}
	// #endregion docs:jump-undo-redo
}
