/**
 * `SuggestionEngine` — the consumer-facing `getSuggestions(...)` API.
 *
 * @remarks
 * Per `docs/architecture.md` §8.3. Wraps `BayesianModel` + `SessionTracker` and serves
 * top-k filter-suggestion results given a current selection. Used by the React adapter's
 * `useSuggestedFilters()` hook to render "you might also like" rows.
 *
 * **Obtained via `attachSuggestions(engine)` from `@filter-enginez/core/suggestions`**, not from
 * the engine, so consumers who never ask for suggestions never ship them. Take the whole bag
 * rather than constructing this directly: the orchestrator is only as good as the
 * `SessionTracker` behind it, and a tracker nothing writes to yields no suggestions.
 *
 * **The query path.**
 *
 *   1. Train the model lazily (skipped when no session was recorded since the last training)
 *   2. For each rule `Y` in the model's vocabulary that isn't already in the current selection:
 *      - For each rule `X` in the current selection, look up `P(Y | X)`
 *      - Combine the conditionals with the noisy-OR formula below
 *   3. Sort candidates by combined probability descending; slice to `k`
 *
 * **Combination formula.** For current selection `S = {X_1, X_2, ...}` and candidate `Y`:
 *
 *     P(Y | S) ≈ 1 - Π_i (1 - P(Y | X_i))
 *
 * This "noisy-OR" formulation is more robust than the strict naive-Bayes product when the
 * selection rules aren't conditionally independent (they almost never are in real filter UX —
 * "Cabernet" and "red" co-occur trivially). Noisy-OR treats each `P(Y | X_i)` as an
 * independent piece of evidence FOR `Y`; a candidate that's a strong "given X_1 → Y" or
 * "given X_2 → Y" gets a high combined score even if other conditionals are weak.
 *
 * **Cold-start fallback.** When the current selection is empty, suggestions rank by marginal
 * popularity — `P(Y)` for each rule, top-k by frequency in the training corpus. When a selection
 * yields fewer than `k` co-occurring candidates, the remaining slots are filled by marginal
 * popularity at a discounted score that always ranks below every co-occurrence-based candidate.
 *
 * **Empty-model behavior.** With zero training sessions, returns `[]` cleanly — consumers
 * don't need to defensively check whether sessions have accumulated.
 *
 * @packageDocumentation
 */

import type { RuleId } from '../types.js';
import type { BayesianModel } from './BayesianModel.js';
import type { SessionTracker } from './SessionTracker.js';

/**
 * Result entry for a suggestion query.
 */
export interface SuggestionResult {
	readonly ruleId: RuleId;
	/** Joint probability across the current selection, in `(0, 1]`. Higher = better candidate. */
	readonly probability: number;
}

/**
 * Top-k filter-suggestion orchestrator.
 */
export class SuggestionEngine {
	constructor(
		private readonly _tracker: SessionTracker,
		private readonly _model: BayesianModel,
	) {}

	// #region docs:get-suggestions
	/**
	 * Suggest the top-k most-likely-next filters given the user's current selection.
	 *
	 * @param currentSelection - The currently-active rule IDs (excluded from suggestions)
	 * @param k - Number of suggestions to return. Default 3.
	 * @returns Top-k suggestions sorted by joint probability descending. Empty if no
	 *   training data is available.
	 */
	getSuggestions(currentSelection: readonly RuleId[], k = 3): SuggestionResult[] {
		this._model.trainIfStale(this._tracker);

		if (this._model.trainedSessionCount === 0) {
			return [];
		}

		const selectionSet = new Set(currentSelection);
		const candidateScores = new Map<RuleId, number>();

		if (currentSelection.length === 0) {
			// Cold-start: rank by marginal popularity. No selection-set exclusion is needed here —
			// `selectionSet` is built from an empty `currentSelection`, so nothing is ever excluded.
			for (const candidateId of this._model.allKnownRules()) {
				const marginal = this._model.marginal(candidateId);

				/* v8 ignore next -- defensive: every rule from allKnownRules() has singleCount >= 1, so marginal is always > 0 */
				if (marginal > 0) {
					candidateScores.set(candidateId, marginal);
				}
			}
		} else {
			// Noisy-OR over the per-selection conditionals.
			// For each X in selection, walk P(Y | X) for every Y in its conditional table.
			// Combine into 1 - Π(1 - P(Y | X_i)) per candidate Y.
			//
			// Initialize each candidate's "miss probability" to 1.0; multiply by `(1 - P(Y|X))`
			// as we accumulate evidence. Final score is `1 - missProbability`.
			const missProbabilities = new Map<RuleId, number>();

			for (const selectedRuleId of currentSelection) {
				for (const [candidateRuleId, conditionalProb] of this._model.conditionalsFor(selectedRuleId)) {
					if (selectionSet.has(candidateRuleId)) {
						continue;
					}
					const currentMiss = missProbabilities.get(candidateRuleId) ?? 1;

					missProbabilities.set(candidateRuleId, currentMiss * (1 - conditionalProb));
				}
			}

			for (const [candidateRuleId, missProb] of missProbabilities) {
				candidateScores.set(candidateRuleId, 1 - missProb);
			}

			// Fill for candidates with no co-occurrence with the current selection — marginal
			// popularity, scaled below the weakest co-occurrence score so these only ever rank
			// after every evidence-backed candidate.
			if (candidateScores.size < k) {
				const weakestScore = Math.min(1, ...candidateScores.values());

				for (const candidateId of this._model.allKnownRules()) {
					if (selectionSet.has(candidateId) || candidateScores.has(candidateId)) {
						continue;
					}
					const marginal = this._model.marginal(candidateId);

					// marginal ≤ 1, so marginal × 0.01 × weakestScore < weakestScore: strictly below
					// every co-occurrence score, while keeping the fill ordered by popularity.
					/* v8 ignore next -- defensive: every rule from allKnownRules() has singleCount >= 1, so marginal is always > 0 */
					if (marginal > 0) {
						candidateScores.set(candidateId, marginal * 0.01 * weakestScore);
					}
				}
			}
		}

		// Sort descending; slice to top-k.
		const ranked: SuggestionResult[] = [];

		for (const [ruleId, probability] of candidateScores) {
			ranked.push({ probability, ruleId });
		}
		ranked.sort((a, b) => b.probability - a.probability);

		return ranked.slice(0, k);
	}
	// #endregion docs:get-suggestions
}
