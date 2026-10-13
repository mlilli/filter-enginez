/**
 * `useSuggestedFilters` — hook surface over the engine's Bayesian co-occurrence suggestion
 * engine. Mirror of `react-signals/useSuggestedFilters` over the RxJS adapter.
 *
 * @remarks
 * Per `docs/architecture.md` §12.2 + §8. Subscribes to `activeRuleIds$` (the input to
 * `getSuggestions`). Does NOT subscribe to `sourceData$` — suggestions come from session-
 * tracker history, not the item corpus.
 *
 * **The import is the opt-in.** `suggestions/` ships from `@filter-enginez/core/suggestions`
 * rather than the root barrel, so a bundle containing this hook pays for the session tracker +
 * Bayesian model, and a bundle without it pays nothing. Feed the model with
 * `attachSuggestions(engine.core).sessionTracker.recordSession(activeRuleIds)`; the trio is
 * memoized per engine, so the recorder and this reader share one tracker.
 *
 * **Worker-backed engines are supported** — see the `react-signals` twin's docblock for why.
 *
 * @packageDocumentation
 */

import { attachSuggestions, type SuggestionResult } from '@filter-enginez/core/suggestions';
import { useMemo } from 'react';

import { useFilterEngine } from './useFilterEngine.js';
import { useObservable } from './useObservable.js';

/**
 * Get the top-k suggested next filters given the engine's current selection.
 *
 * @param k - Number of suggestions to return. Default 3.
 * @returns Top-k suggestions sorted by joint probability descending
 */
export function useSuggestedFilters(k = 3): readonly SuggestionResult[] {
	const engine = useFilterEngine();
	const activeRuleIds = useObservable(engine.activeRuleIds$, engine.core.getActiveRuleIds());

	return useMemo(
		() => attachSuggestions(engine.core).suggestions.getSuggestions(activeRuleIds, k),
		[engine, activeRuleIds, k],
	);
}
