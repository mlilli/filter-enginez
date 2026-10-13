/**
 * `SessionTracker` — records active-rule-set snapshots per user session for Bayesian
 * co-occurrence training.
 *
 * @remarks
 * Per `docs/architecture.md` §8.2. Each "session" is a recorded set of active rule IDs; the
 * Bayesian model trains on the corpus of these sessions to compute pairwise co-occurrence
 * probabilities.
 *
 * Bounded by `maxSessions` (default 500) — oldest sessions evict as new ones land.
 *
 * @packageDocumentation
 */

import type { RuleId } from '../types.js';

// #region docs:session-tracker
/**
 * A single recorded session — the active rule IDs at a moment + timestamp.
 */
export interface SessionRecord {
	readonly ruleIds: ReadonlySet<RuleId>;
	readonly timestamp: number;
}

/**
 * Bounded FIFO buffer of session records, with a change counter the model trains against.
 */
export class SessionTracker {
	private readonly _recordedSessions: SessionRecord[] = [];
	private _version = 0;

	constructor(readonly maxSessions: number = 500) {}

	/**
	 * Record the currently-active rule set as a session for the Bayesian model to learn from.
	 *
	 * Typical consumer usage: call this on a debounced timer (e.g., 5s of stable selection)
	 * or on a meaningful UX event (e.g., "user clicked a result"). The model gets sharper as
	 * more sessions accumulate.
	 *
	 * @param activeRuleIds - The active rule IDs to record
	 */
	recordSession(activeRuleIds: readonly RuleId[]): void {
		this._recordedSessions.push({
			ruleIds: new Set(activeRuleIds),
			timestamp: Date.now(),
		});
		while (this._recordedSessions.length > this.maxSessions) {
			this._recordedSessions.shift();
		}
		this._version++;
	}

	/**
	 * Increments on every `recordSession` and `clear`. `BayesianModel` retrains when it changes —
	 * unlike `size`, it keeps moving once the buffer is full and the oldest session is evicted
	 * for each new one.
	 */
	get version(): number {
		return this._version;
	}

	/** Iterate session records oldest to newest. */
	*sessions(): IterableIterator<SessionRecord> {
		yield* this._recordedSessions;
	}

	/** Number of currently-retained sessions. */
	get size(): number {
		return this._recordedSessions.length;
	}

	/** Drop all sessions. */
	clear(): void {
		this._recordedSessions.length = 0;
		this._version++;
	}
}
// #endregion docs:session-tracker
