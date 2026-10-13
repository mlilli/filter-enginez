/**
 * `ActionLog` — bounded chronological record of dispatched actions + their state snapshots.
 *
 * @remarks
 * The backbone of the engine's devtools (per `docs/architecture.md` §10.1). Every action
 * dispatched to the engine appends an `ActionLogEntry` here, wrapping the action with its
 * pre- and post-state snapshots + timestamp + optional metadata.
 *
 * Backed by a plain array with **FIFO eviction at capacity** — when `append()` would exceed
 * `maxEntries`, the oldest entry is dropped. (NOT an LRU — for an action log the eviction
 * semantics are strictly oldest-first; "most recently used" doesn't apply.)
 *
 * Supports the **truncate-future-on-append-after-jump** invariant required by time-travel:
 * if the user jumps backward via `setCurrentIndex(i)` and then a new action is appended, the
 * entries after `i` are dropped (the "future" they represented is no longer canonical).
 *
 * @packageDocumentation
 */

import type { Action } from '../store/Action.js';
import type { EngineSnapshot } from '../store/snapshots.js';

import { FilterEngineError } from '../errors/index.js';

// #region docs:action-log-append
/**
 * Optional metadata attached to an action log entry — useful for forensics / dev debugging.
 */
export interface ActionLogEntryMeta {
	/** Where the action originated from. */
	readonly source?: 'devtools' | 'engine' | 'redux-bridge' | 'replay' | 'url-state';
	/** Optional caller-supplied label for grouping or filtering. */
	readonly origin?: string;
}

/**
 * One entry in the action log — wraps an action with its before/after state.
 */
export interface ActionLogEntry {
	readonly action: Action;
	readonly meta?: ActionLogEntryMeta;
	readonly nextStateSnapshot: EngineSnapshot;
	readonly previousStateSnapshot: EngineSnapshot;
	readonly timestamp: number;
}

/**
 * Bounded chronological action log with time-travel-aware truncation.
 */
export class ActionLog {
	private _currentIndexInternal = -1;
	private readonly _entries: ActionLogEntry[] = [];

	/**
	 * @param maxEntries - Maximum entries retained. Older entries are dropped FIFO on overflow.
	 *                     Use `Infinity` for unbounded (dev only — production typically 100-500).
	 */
	constructor(readonly maxEntries: number) {}

	/**
	 * Append an entry to the log. If `currentIndex` is mid-log (user previously jumped
	 * backward), future entries are first truncated. If the resulting length exceeds
	 * `maxEntries`, the oldest entry is shifted out (currentIndex's conceptual position is
	 * preserved relative to the new array).
	 *
	 * @param entry - The entry to append
	 */
	append(entry: ActionLogEntry): void {
		// Truncate "future" entries if we were jumped backward before this append.
		if (this._currentIndexInternal < this._entries.length - 1) {
			this._entries.length = this._currentIndexInternal + 1;
		}

		this._entries.push(entry);

		if (this._entries.length > this.maxEntries) {
			this._entries.shift();
			// currentIndex stays at the same numeric value — the just-pushed entry is now at
			// (maxEntries - 1), which is where currentIndex points after the shift offset.
		} else {
			this._currentIndexInternal++;
		}
	}

	/**
	 * Insert entries from an earlier session ahead of this session's entries — used when
	 * `DevtoolsPersistence` finishes loading. The cursor shifts with the entries it pointed at
	 * (or, on an empty log, lands on the last inserted entry), so the log reads as if the earlier
	 * actions happened just before this session's. When the combined log would exceed
	 * `maxEntries`, the oldest inserted entries are dropped.
	 *
	 * @param entries - Earlier entries, oldest first
	 */
	prepend(entries: readonly ActionLogEntry[]): void {
		const room = Math.max(this.maxEntries - this._entries.length, 0);
		const kept = room >= entries.length ? entries : entries.slice(entries.length - room);

		this._entries.unshift(...kept);
		this._currentIndexInternal += kept.length;
	}

	/** Look up an entry by index. */
	get(index: number): ActionLogEntry | undefined {
		return this._entries[index];
	}

	/** Total number of entries currently retained. */
	get size(): number {
		return this._entries.length;
	}

	/** The current cursor — points at the most recently applied entry. -1 if empty. */
	get currentIndex(): number {
		return this._currentIndexInternal;
	}
	// #endregion docs:action-log-append

	/**
	 * Move the cursor without mutating the entries. Used by time-travel to track where the
	 * user has scrubbed to; the actual state restoration happens via `restoreSnapshot`
	 * called by `TimeTravel.jumpTo`.
	 *
	 * @param index - The new cursor position (-1 ≤ index < size)
	 * @throws `FilterEngineError` with code `DEVTOOLS_INDEX_OUT_OF_RANGE` if `index` is out of bounds
	 */
	setCurrentIndex(index: number): void {
		if (index < -1 || index >= this._entries.length) {
			throw new FilterEngineError(
				'DEVTOOLS_INDEX_OUT_OF_RANGE',
				`ActionLog index out of range: ${index} (must be -1 <= i < ${this._entries.length})`,
			);
		}
		this._currentIndexInternal = index;
	}

	/** Iterate entries from oldest to newest. */
	*[Symbol.iterator](): IterableIterator<ActionLogEntry> {
		yield* this._entries;
	}

	/** Read-only view of all entries (useful for devtools UI rendering). */
	toArray(): readonly ActionLogEntry[] {
		return this._entries.slice();
	}

	/** Drop all entries and reset the cursor. */
	clear(): void {
		this._entries.length = 0;
		this._currentIndexInternal = -1;
	}
}
