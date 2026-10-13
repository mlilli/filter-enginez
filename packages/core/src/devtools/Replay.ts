/**
 * `Replay` — re-apply a sequence of actions from the action log without re-logging.
 *
 * @remarks
 * Per `docs/architecture.md` §10.5. Used for:
 *   - "What if I had checked X first?" devtools exploration — replay from a custom starting
 *     snapshot
 *   - Recovery — re-derive current state from the log if state is somehow corrupted
 *   - Test fixtures — capture a sequence of actions, replay deterministically in tests
 *
 * Replay skips `dispatch()` and goes directly to `Dispatcher.apply()`, so it doesn't re-log
 * the actions or emit one change event per action. Like a time-travel restore, it writes the
 * store outside the dispatch pipeline, so it calls the owner's `beforeRestore` hook first (cache
 * invalidation) and emits a single `{ type: 'reset' }` when it finishes, so every reactive
 * surface re-reads the replayed state.
 *
 * @packageDocumentation
 */

import type { Dispatcher } from '../store/Dispatcher.js';
import type { InternalStore } from '../store/InternalStore.js';
import type { ActionLog } from './ActionLog.js';
import type { TimeTravelEmit } from './TimeTravel.js';

import { type EngineSnapshot, restoreSnapshot } from '../store/snapshots.js';

/**
 * Options for `Replay.replay()`.
 */
export interface ReplayOptions {
	/**
	 * Optional starting snapshot to restore before replay begins. If omitted, replays from
	 * the current store state.
	 */
	readonly startingFrom?: EngineSnapshot;
}

// #region docs:replay-class
/**
 * Action-log replay orchestrator.
 */
export class Replay<T> {
	constructor(
		private readonly _store: InternalStore<T>,
		private readonly _dispatcher: Dispatcher<T>,
		private readonly _actionLog: ActionLog,
		private readonly _emitChange?: TimeTravelEmit,
		private readonly _beforeRestore?: () => void,
	) {}

	/**
	 * Re-apply actions from `fromIndex` (inclusive) to the end of the action log.
	 *
	 * @param fromIndex - The starting index (0-based)
	 * @param options - Optional `startingFrom` snapshot to restore before replay
	 */
	replay(fromIndex: number, options: ReplayOptions = {}): void {
		this._beforeRestore?.();
		if (options.startingFrom) {
			restoreSnapshot(this._store, options.startingFrom);
		}
		for (let index = fromIndex; index < this._actionLog.size; index++) {
			const entry = this._actionLog.get(index);

			/* v8 ignore next 3 -- defensive: get(index) for an in-range index never returns undefined */
			if (entry === undefined) {
				continue;
			}
			this._dispatcher.apply(entry.action);
		}
		this._emitChange?.({ type: 'reset' });
	}
}
// #endregion docs:replay-class
