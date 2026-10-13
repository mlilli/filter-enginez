/**
 * `useExclusion` — hook surface over the engine's "predictive checkbox disable" affordance.
 * For each candidate value, tells consumers whether selecting that value would yield zero
 * results given the engine's current state.
 *
 * @remarks
 * Per `docs/architecture.md` §12.1. "Predictive checkbox disable" — render a checkbox per facet
 * value, grey out the ones that would empty the result set. Powered by
 * the engine's `SimulationCache` (which short-circuits via `ExclusionGraph` for known-
 * mutually-exclusive pairs and falls back to bitmap / predicate evaluation otherwise).
 *
 * **Per-value rule builder.** The hook can't infer how to construct a hypothetical rule
 * from a candidate value alone (varietal vs price-bucket vs date-preset have completely
 * different rule shapes), so the consumer supplies a `buildRuleForValue(value)` factory.
 * For the typical "InSetRule with one value" case, that's `(v) => inSet('varietal', [v])`.
 * The factory runs once per candidate per render; results are memoized by the engine's
 * `SimulationCache` so repeated renders with the same candidate set are O(1) per value.
 *
 * **Sync-adapter-only.** The per-candidate `engine.core.simulate(...)` fan-out is synchronous only
 * on the sync adapter (`createSignalsEngine`). Worker-backed adapters
 * (`createSignalsEngineFromAsync`) do not serve a synchronous `core.simulate()` — it throws.
 * Worker-backed consumers read chip exclusion from `engine.asyncEngine.applyFiltersAndQuery(...)`
 * instead.
 *
 * @packageDocumentation
 */

import type { FilterRule, RuleId } from '@filter-enginez/core';

import { useMemo } from 'react';

import { useFilterEngine } from './useFilterEngine.js';
import { useSignal } from './useSignal.js';

/**
 * Constant-zero subscribable used as the fallback when `engine.swrRevision` isn't provided.
 *
 * @remarks
 * Satisfies the `ReadonlySignalShape` `useSignal` expects: always reads `0`, the `subscribe`
 * callback is a no-op that returns a no-op unsubscribe. Used when adapting against a third-
 * party engine or an older bundle version that doesn't carry the optional SWR-revision
 * signal — `useExclusion` then degrades to "cache fills become visible at the next real
 * engine event" rather than throwing.
 *
 * **Why module-level (not per-render).** `useSignal` internally does
 * `useMemo(() => signalToStoreTuple(signal), [signal])` — if the fallback object's identity
 * changed on every render, the memoized tuple would re-subscribe each time. A frozen module
 * constant has stable identity for the lifetime of the module.
 *
 * @internal
 */
const CONSTANT_ZERO_SIGNAL: {
	subscribe(onChange: (value: number) => void): () => void;
	readonly value: number;
} = Object.freeze({
	subscribe: (): (() => void) => () => { /* never bumps, nothing to clean up */ },
	value: 0,
});

/**
 * Per-value exclusion data for a given rule. Each entry maps an option value (string-
 * coerced) to whether selecting that value would produce zero results given the engine's
 * current state, plus the projected count if not zero.
 */
export type ExclusionMap = ReadonlyMap<
	string,
	{ readonly projectedCount: number; readonly wouldBeEmpty: boolean; }
>;

/**
 * Get the per-value exclusion data for a specific rule's option set.
 *
 * @param ruleId - The rule id to query exclusions for (used as the `withRule` key in the
 *   per-candidate simulation)
 * @param candidateValues - The option values to evaluate (typically the full enum of the
 *   underlying field — every varietal, every color, every bucket)
 * @param buildRuleForValue - Factory that converts a candidate value into the hypothetical
 *   `FilterRule` to simulate with
 * @returns A map from value → `{ wouldBeEmpty, projectedCount }`
 *
 * @example
 *   function VarietalFacetPanel({ allVarietals }: { allVarietals: string[] }) {
 *     const exclusion = useExclusion(
 *       'varietal',
 *       allVarietals,
 *       (v) => inSet('varietal', [v]),
 *     );
 *     return (
 *       <>
 *         {allVarietals.map(v => {
 *           const data = exclusion.get(v);
 *           return (
 *             <label key={v}>
 *               <input type="checkbox" disabled={data?.wouldBeEmpty} />
 *               {v} ({data?.projectedCount ?? 0})
 *             </label>
 *           );
 *         })}
 *       </>
 *     );
 *   }
 */
export function useExclusion(
	ruleId: RuleId,
	candidateValues: readonly string[],
	buildRuleForValue: (value: string) => FilterRule,
): ExclusionMap {
	const engine = useFilterEngine();

	// Track every engine state change. `lastChangeTimestamp` increments on rule-add /
	// rule-remove / rule-config-change / expression / source-data — ANY mutation that could
	// affect the simulation outcomes. Including it as a memo dependency below forces the
	// per-candidate simulate() calls to re-run on every change, not just on rule-add/remove.
	//
	// **Why the timestamp is a dependency.** Subscribing to `engine.activeRules` +
	// `engine.sourceData` via `useSignal` makes React re-render, but the memo's body only
	// re-executes when something in its deps array changes. Without a changing dep, projected
	// counts would go stale across rule-config changes (selecting a varietal would not update
	// the color chip's count badges). The monotonic `lastChangeTimestamp` captures every
	// relevant change in one dependency.
	const lastChange = useSignal(engine.lastChangeTimestamp);

	useSignal(engine.sourceData); // for the per-change re-render trigger
	useSignal(engine.activeRules); // ditto
	// **SWR revision.** The async adapter does not provide this signal. It is optional on the
	// SignalsEngine interface, so we fall back to the frozen constant-0 signal when it's
	// absent — a no-op re-run pulse kept as a memo dependency.
	const swrRevision = useSignal(engine.swrRevision ?? CONSTANT_ZERO_SIGNAL);

	// Stable key so the useMemo only re-runs when the candidate set actually changes.
	const candidateKey = useMemo(() => candidateValues.join('\0'), [candidateValues]);

	return useMemo<ExclusionMap>(() => {
		const result = new Map<string, { projectedCount: number; wouldBeEmpty: boolean; }>();

		for (const value of candidateValues) {
			const sim = engine.core.simulate({
				// Replace the rule under `ruleId` with the hypothetical single-value version.
				// If `ruleId` isn't currently active, this still works — `simulate` treats
				// `withRule` as "add or replace this rule in the hypothetical state."
				withRule: [ruleId, buildRuleForValue(value)],
			});

			result.set(value, {
				projectedCount: sim.resultCount,
				wouldBeEmpty: sim.wouldBeEmpty,
			});
		}

		return result;
		// `lastChange` fires on every real engine event; `swrRevision` fires after async
		// simulate cache fills. Both are intentionally in the dep array so cached values flow
		// into the returned Map — we WANT to re-run on every tick of either, even though they
		// don't appear in the body directly. (`react-hooks/exhaustive-deps` only runs on JSX
		// files, so no disable directive is needed in this `.ts` hook module.)
	}, [engine, ruleId, candidateKey, buildRuleForValue, lastChange, swrRevision]);
}
