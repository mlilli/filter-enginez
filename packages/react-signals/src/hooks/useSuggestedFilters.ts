/**
 * `useSuggestedFilters` — hook surface over the engine's Bayesian co-occurrence suggestion
 * engine. Suggests the top-k filters most likely to be activated next given the user's
 * current selection.
 *
 * @remarks
 * Per `docs/architecture.md` §12.1 + §8. The "you might also like" / "people who filtered
 * for X also filtered for Y" affordance — pure on-device computation from the engine's
 * session-tracker history, no backend round-trip. Uses noisy-OR combination over the
 * Bayesian model's pairwise conditionals (see `BayesianModel` + `SuggestionEngine` in core
 * for the math).
 *
 * **Re-evaluation triggers.** Subscribes to `activeRules` so the suggestion ranking re-runs
 * when the selection changes. Does NOT subscribe to `sourceData` because suggestions are
 * derived from the session-tracker's history, not the current item corpus — adding items
 * doesn't change which filter pairs co-occur in past sessions.
 *
 * **Session recording is the consumer's responsibility.** This hook only reads the model;
 * `attachSuggestions(engine.core).sessionTracker.recordSession(activeRuleIds)` is what feeds
 * it. Typical consumer pattern: debounced recording on a stable 5s window of unchanged active
 * rules. Recording and reading converge on one `SessionTracker` because `attachSuggestions`
 * memoizes its trio per engine — see its docblock for why that is a correctness property here
 * rather than a convenience.
 *
 * **The import is the opt-in.** `suggestions/` ships from `@filter-enginez/core/suggestions`
 * rather than the root barrel, so a bundle containing this hook pays for the session tracker +
 * Bayesian model, and a bundle without it pays nothing.
 *
 * **Worker-backed engines are supported.** The trio needs nothing from the engine — it computes
 * over session history the main thread records itself — so it attaches to the async core shim
 * exactly as it does to a real engine.
 *
 * @packageDocumentation
 */

import { attachSuggestions, type SuggestionResult } from '@filter-enginez/core/suggestions';
import { useMemo } from 'react';

import { useFilterEngine } from './useFilterEngine.js';
import { useSignal } from './useSignal.js';

/**
 * Get the top-k suggested next filters given the engine's current selection.
 *
 * @param k - Number of suggestions to return. Default 3.
 * @returns Top-k suggestions sorted by joint probability descending. Empty array when
 *   the session tracker hasn't accumulated any sessions yet.
 *
 * @example
 *   function SuggestedFilters() {
 *     const suggestions = useSuggestedFilters(3);
 *     if (suggestions.length === 0) return null;
 *     return (
 *       <aside>
 *         <h4>People who filtered like this also tried…</h4>
 *         <ul>
 *           {suggestions.map(s => (
 *             <li key={s.ruleId}>
 *               {s.ruleId} ({(s.probability * 100).toFixed(0)}%)
 *             </li>
 *           ))}
 *         </ul>
 *       </aside>
 *     );
 *   }
 */
export function useSuggestedFilters(k = 3): readonly SuggestionResult[] {
	const engine = useFilterEngine();
	const activeRuleIds = useSignal(engine.activeRuleIds);

	return useMemo(
		() => attachSuggestions(engine.core).suggestions.getSuggestions(activeRuleIds, k),
		[engine, activeRuleIds, k],
	);
}
