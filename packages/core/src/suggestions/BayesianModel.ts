/**
 * `BayesianModel` — empirical co-occurrence model over session records.
 *
 * @remarks
 * Per `docs/architecture.md` §8.1. For each ordered pair of rule IDs `(X, Y)`, computes the
 * conditional probability `P(Y | X) = sessions(X ∧ Y) / sessions(X)` — the empirical chance
 * that rule `Y` is also selected in a session given that rule `X` is selected. Used by
 * `SuggestionEngine` to power the "you might also like" / "people who filtered for X also
 * filtered for Y" affordance from the user's own engine session history.
 *
 * **The count table.** Two flat data structures:
 *
 *   - `singleCounts: Map<RuleId, number>` — how many sessions included rule X
 *   - `pairCounts: Map<RuleId, Map<RuleId, number>>` — for each rule X, how many sessions
 *     included both X and each other rule Y
 *
 * Pair counts are stored asymmetrically (the outer-key X is the "given" rule; the inner-key
 * Y is the "asking about" rule) but populated symmetrically — counting a session containing
 * `{X, Y}` increments both `pairCounts[X][Y]` and `pairCounts[Y][X]`. This makes the
 * conditional-probability lookup O(1) in either direction at the cost of 2x storage; the
 * tradeoff is right for the suggestion query path which fans out from one "given" rule.
 *
 * **Lazy training.** `trainIfStale` is idempotent — re-runs the count pass only when the
 * tracker's `version` has moved since the last training (every recorded session and every
 * `clear()` moves it, including once the buffer is full and evicting). This avoids O(N) work on
 * every suggestion query when nothing has changed.
 *
 * **Probabilities are raw empirical frequencies** (no smoothing): `P(Y | X)` is the pair count
 * over the single count. Combining the conditionals of a multi-rule selection is the
 * `SuggestionEngine`'s job (noisy-OR).
 *
 * @packageDocumentation
 */

import type { RuleId } from '../types.js';
import type { SessionTracker } from './SessionTracker.js';

/**
 * Bayesian co-occurrence model. Trained from a `SessionTracker`'s recorded sessions.
 */
export class BayesianModel {
	/** `ruleId -> sessions-containing-ruleId-count`. */
	private readonly _singleCounts = new Map<RuleId, number>();

	/** `givenRuleId -> (otherRuleId -> sessions-containing-both-count)`. */
	private readonly _pairCounts = new Map<RuleId, Map<RuleId, number>>();

	/** Total number of sessions the model was trained from (denominator for marginals). */
	private _totalSessions = 0;

	/**
	 * The tracker and tracker `version` the model last trained against — short-circuits
	 * `trainIfStale` when nothing has changed.
	 */
	private _trainedAt: { readonly tracker: SessionTracker; readonly version: number } | null = null;

	/**
	 * Train (or re-train) the model from the tracker's current session corpus. Idempotent if
	 * the tracker has recorded nothing since the last call.
	 *
	 * @param tracker - The session tracker holding the corpus to train from
	 */
	trainIfStale(tracker: SessionTracker): void {
		if (this._trainedAt?.tracker === tracker && this._trainedAt.version === tracker.version) {
			return;
		}

		// Full rebuild — the corpus is bounded by SessionTracker.maxSessions (default 500),
		// so the linear-in-corpus retraining cost is negligible compared to the suggestion
		// query path. An incremental update would need to track which sessions were evicted;
		// a full rebuild avoids that bookkeeping.
		this._singleCounts.clear();
		this._pairCounts.clear();
		this._totalSessions = 0;

		for (const session of tracker.sessions()) {
			this._totalSessions++;
			const ruleIds = [...session.ruleIds];

			for (let i = 0; i < ruleIds.length; i++) {
				const x = ruleIds[i];

				/* v8 ignore next 3 -- defensive: noUncheckedIndexedAccess guard; ruleIds is a dense array */
				if (x === undefined) {
					continue;
				}
				this._singleCounts.set(x, (this._singleCounts.get(x) ?? 0) + 1);

				// Pair counts — populate symmetrically so conditional lookup works either way.
				for (let j = 0; j < ruleIds.length; j++) {
					if (i === j) {
						continue;
					}
					const y = ruleIds[j];

					/* v8 ignore next 3 -- defensive: noUncheckedIndexedAccess guard; ruleIds is a dense array */
					if (y === undefined) {
						continue;
					}
					let inner = this._pairCounts.get(x);

					if (!inner) {
						inner = new Map();
						this._pairCounts.set(x, inner);
					}
					inner.set(y, (inner.get(y) ?? 0) + 1);
				}
			}
		}

		this._trainedAt = { tracker, version: tracker.version };
	}

	/**
	 * Return the conditional probabilities `P(other | conditionRuleId)` for every other rule
	 * seen in the training corpus.
	 *
	 * @param conditionRuleId - The "given" rule
	 * @returns Iterable of `[otherRuleId, probability]` pairs (probability in `(0, 1]`)
	 *
	 * @remarks
	 * Returns an empty iterable if `conditionRuleId` was never seen in any session (no signal
	 * to condition on). Otherwise the iteration order is insertion order (the order rules were
	 * encountered during training) — `SuggestionEngine` re-sorts by ranked probability, so
	 * the order here doesn't matter to the consumer-facing API.
	 */
	*conditionalsFor(conditionRuleId: RuleId): Iterable<[RuleId, number]> {
		const conditionCount = this._singleCounts.get(conditionRuleId);

		if (!conditionCount) {
			return;
		}

		const inner = this._pairCounts.get(conditionRuleId);

		if (!inner) {
			return;
		}

		for (const [otherRuleId, jointCount] of inner) {
			yield [otherRuleId, jointCount / conditionCount];
		}
	}

	/**
	 * The marginal probability `P(ruleId)` — the fraction of training sessions that included
	 * this rule. Used by the suggestion engine's tie-breaker for rules that haven't co-
	 * occurred with the current selection (fall back to "popular among any session").
	 */
	marginal(ruleId: RuleId): number {
		if (this._totalSessions === 0) {
			return 0;
		}
		const count = this._singleCounts.get(ruleId) ?? 0;

		return count / this._totalSessions;
	}

	/** All rule IDs the model has seen during training. */
	allKnownRules(): IterableIterator<RuleId> {
		return this._singleCounts.keys();
	}

	/** Number of distinct rules seen across training. */
	get vocabularySize(): number {
		return this._singleCounts.size;
	}

	/** Number of sessions the model was last trained against. */
	get trainedSessionCount(): number {
		return this._totalSessions;
	}

	/** Drop all learned counts. The next `trainIfStale` call will rebuild from scratch. */
	clear(): void {
		this._singleCounts.clear();
		this._pairCounts.clear();
		this._totalSessions = 0;
		this._trainedAt = null;
	}
}
