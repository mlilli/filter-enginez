/**
 * `useExclusion` — hook surface over the engine's "predictive checkbox disable" affordance.
 * For each candidate value, tells consumers whether selecting that value would yield zero
 * results given the engine's current state.
 *
 * @remarks
 * Per `docs/architecture.md` §12.2. Mirror of `react-signals/useExclusion` over the RxJS
 * adapter — same `buildRuleForValue` factory contract (the hook can't infer rule
 * construction from a string alone, so the consumer supplies the factory).
 *
 * **Sync-adapter-only.** This hook fans out per-candidate `engine.core.simulate(...)` calls, which
 * are synchronous only on the sync adapter (`createRxJsEngine`). Worker-backed adapters
 * (`createRxJsEngineFromAsync`) do not serve a synchronous `core.simulate()` — it throws.
 * Worker-backed consumers read chip exclusion from `engine.asyncEngine.applyFiltersAndQuery(...)`
 * instead.
 *
 * @packageDocumentation
 */

import type { FilterRule, RuleId } from '@filter-enginez/core';

import { useMemo } from 'react';
import { BehaviorSubject } from 'rxjs';

import { useFilterEngine } from './useFilterEngine.js';
import { useObservable } from './useObservable.js';

/**
 * Constant-zero observable used as the fallback when `engine.swrRevision$` isn't provided.
 *
 * @remarks
 * Same role as the signals-side `CONSTANT_ZERO_SIGNAL`: lets `useExclusion` degrade
 * gracefully when adapting against a third-party engine or an older bundle version that
 * doesn't carry the optional SWR-revision stream. The frozen BehaviorSubject emits its
 * initial 0 to any subscriber and never advances.
 *
 * **Why module-level.** `useObservable` re-subscribes when the observable identity changes.
 * A frozen module constant has stable identity for the lifetime of the module.
 *
 * @internal
 */
const CONSTANT_ZERO_OBSERVABLE = new BehaviorSubject<number>(0).asObservable();

/**
 * Per-value exclusion data for a given rule.
 */
export type ExclusionMap = ReadonlyMap<
	string,
	{ readonly projectedCount: number; readonly wouldBeEmpty: boolean; }
>;

/**
 * Get the per-value exclusion data for a specific rule's option set.
 *
 * @param ruleId - The rule id to query exclusions for
 * @param candidateValues - The option values to evaluate
 * @param buildRuleForValue - Factory that converts a candidate value into the hypothetical
 *   `FilterRule` to simulate with
 * @returns A map from value → `{ wouldBeEmpty, projectedCount }`
 *
 * @example
 *   const exclusion = useExclusion(
 *     'varietal',
 *     allVarietals,
 *     (v) => inSet('varietal', [v]),
 *   );
 */
export function useExclusion(
	ruleId: RuleId,
	candidateValues: readonly string[],
	buildRuleForValue: (value: string) => FilterRule,
): ExclusionMap {
	const engine = useFilterEngine();
	// Track every engine state change via the monotonic timestamp — captures rule-add /
	// rule-remove / rule-config-change / expression / source-data uniformly. Including it
	// as a memo dependency below forces the per-candidate simulate() calls to re-run on
	// every change. react-signals/useExclusion does the same, and explains why.
	const lastChange = useObservable(engine.lastChangeTimestamp$, null);

	useObservable(engine.activeRules$, engine.core.getRules());
	useObservable(engine.sourceData$, engine.core.getSourceData());
	// **SWR revision.** The sync adapter emits a constant 0 and the async adapter does not provide
	// the stream. `swrRevision$` is optional on the interface, so we fall back to a frozen constant-0 observable
	// when it's absent — a no-op re-run pulse kept as a memo dependency for shape-parallelism.
	const swrRevision = useObservable(engine.swrRevision$ ?? CONSTANT_ZERO_OBSERVABLE, 0);

	const candidateKey = useMemo(() => candidateValues.join('\0'), [candidateValues]);

	return useMemo<ExclusionMap>(() => {
		const result = new Map<string, { projectedCount: number; wouldBeEmpty: boolean; }>();

		for (const value of candidateValues) {
			const sim = engine.core.simulate({
				withRule: [ruleId, buildRuleForValue(value)],
			});

			result.set(value, {
				projectedCount: sim.resultCount,
				wouldBeEmpty: sim.wouldBeEmpty,
			});
		}

		return result;
		// `lastChange` fires on every real engine event; `swrRevision` fires after async
		// simulate cache fills. Both are intentionally listed as memo dependencies so cached
		// values flow into the returned Map even though they don't appear in the body — they
		// act as re-run pulses. (The `react-hooks` plugin is not active for `.ts` files, so
		// this is a deliberate, documented dependency choice, not a suppression.)
	}, [engine, ruleId, candidateKey, buildRuleForValue, lastChange, swrRevision]);
}
