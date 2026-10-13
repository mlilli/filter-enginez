/**
 * `createSignalsEngine` — the factory that wraps a `FilterEngine` in a `SignalsEngine`
 * reactive facade backed by `@preact/signals-core`.
 *
 * @remarks
 * Per `docs/architecture.md` §11.1. The Adapter half of the Adapter+Facade pattern — bridges
 * the engine's plain `subscribe(callback)` API to fine-grained signals consumers compose
 * into their reactive graphs.
 *
 * **The fan-out.** Every `ChangeEvent` the engine emits routes to exactly the signals it
 * affects — `'rule:added'` bumps `activeRules` + `activeRuleIds` + `lastChangeRuleId` +
 * `lastChangeTimestamp` + `lastChangeEvent`, but not `expression`. `'sourceData'` bumps
 * `sourceData` + (transitively) `results` + `resultCount` via the engine's own computeds.
 * Writes are wrapped in `batch()` so downstream computeds run once per event, not once per
 * affected signal.
 *
 * **Per-rule signal cache.** `engine.rule(id)` returns a `computed` derivation of
 * `activeRules.value.get(id)`. The cache memoizes by id so multiple consumers asking for the
 * same rule share one computed instance — important for React's render-stability guarantees
 * (one `useSignal(engine.rule('price'))` per component should be one subscription, not N).
 *
 * **Why a function, not a class.** Adapter packages are tiny ergonomics layers; a function
 * call keeps the consumer surface minimal (`const engine = createSignalsEngine(core)` reads
 * cleanly). Third-party adapters for other reactive primitives (Vue, Solid, MobX) can mirror
 * the function shape trivially.
 *
 * @packageDocumentation
 */

import type {
	ChangeEvent,
	CompositeRule,
	FilterEngine,
	FilterGroup,
	FilterRule,
	RuleId,
} from '@filter-enginez/core';

import { batch, computed, type ReadonlySignal, signal } from '@preact/signals-core';

import type { SignalsEngine } from './SignalsEngine.js';

/**
 * Options for `createSignalsEngine`.
 */
export interface CreateSignalsEngineOptions {
	/**
	 * If `true`, the adapter eagerly creates per-rule signals for every currently-registered
	 * rule on construction (and on every `rule:added` event). Default `false` — per-rule
	 * signals are lazily created on first `engine.rule(id)` call. Set to `true` only if every
	 * rule is known to be observed (the laziness optimization stops being useful).
	 */
	readonly eagerPerRuleSignals?: boolean;
}

/**
 * Wrap a `FilterEngine` in a `SignalsEngine` reactive facade.
 *
 * @typeParam T - The item type the underlying engine operates over
 * @param core - The engine instance to adapt
 * @param options - Optional adapter configuration
 * @returns A `SignalsEngine<T>` exposing the engine state as preact signals
 *
 * @example
 *   import { createFilterEngine } from '@filter-enginez/core';
 *   import { createSignalsEngine } from '@filter-enginez/reactive-signals';
 *
 *   const core = createFilterEngine<Wine>({ sourceData: wines });
 *   const engine = createSignalsEngine(core);
 *
 *   // Read in a reactive context:
 *   computed(() => `${engine.resultCount.value} matches`);
 *
 *   // Write through the underlying core:
 *   core.addRule('price', range('price', { min: 10, max: 50 }));
 *
 *   // Tear down when done:
 *   engine.dispose();
 */
export function createSignalsEngine<T>(
	core: FilterEngine<T>,
	options: CreateSignalsEngineOptions = {},
): SignalsEngine<T> {
	// ─── Writable signals — seeded from the engine's current state ─────────
	const resultsSignal = signal<readonly T[]>(core.getResults());
	const resultCountSignal = signal<number>(core.getResultCount());
	const sourceDataSignal = signal<readonly T[]>(core.getSourceData());
	const workingSetSignal = signal<readonly T[]>(core.store.workingSet.value);
	const activeRulesSignal = signal<ReadonlyMap<RuleId, FilterRule>>(core.getRules());
	const activeRuleIdsSignal = signal<readonly RuleId[]>(core.getActiveRuleIds());
	const expressionSignal = signal<CompositeRule | null>(core.getExpression());
	const groupsSignal = signal<readonly FilterGroup[]>(core.getGroups());
	const modeSignal = signal<'expression' | 'flat-map'>(
		core.getExpression() !== null ? 'expression' : 'flat-map',
	);
	const lastChangeRuleIdSignal = signal<RuleId | null>(core.store.lastChangeRuleId.value);
	const lastChangeTimestampSignal = signal<number | null>(core.store.lastChangeTimestamp.value);
	const lastChangeEventSignal = signal<ChangeEvent | null>(null);

	// ─── Per-rule signal cache (memoized lazy derivations) ─────────────────
	const perRuleSignals = new Map<RuleId, ReadonlySignal<FilterRule | undefined>>();
	const buildRuleSignal = (ruleId: RuleId): ReadonlySignal<FilterRule | undefined> => {
		let cached = perRuleSignals.get(ruleId);

		if (!cached) {
			cached = computed(() => activeRulesSignal.value.get(ruleId));
			perRuleSignals.set(ruleId, cached);
		}

		return cached;
	};

	// Eager pre-populate per-rule signals if requested.
	if (options.eagerPerRuleSignals) {
		for (const id of core.getRules().keys()) {
			buildRuleSignal(id);
		}
	}

	let isDisposed = false;

	// #region docs:subscribe-fan-out
	// ─── The engine.subscribe fan-out loop ─────────────────────────────────
	const unsubscribe = core.subscribe((event: ChangeEvent) => {
		if (isDisposed) {
			return;
		}
		batch(() => {
			// Always reflect the most recent event + (for rule mutations) the change metadata.
			lastChangeEventSignal.value = event;

			switch (event.type) {
				case 'expression':
					expressionSignal.value = core.getExpression();
					modeSignal.value = core.getExpression() !== null ? 'expression' : 'flat-map';
					resultsSignal.value = core.getResults();
					resultCountSignal.value = core.getResultCount();

					return;

				case 'reset':
					// A `reset` event covers any wholesale state change (RESET, RULES_CLEARED,
					// group add/remove). Re-read everything; cheaper than reasoning about exactly
					// which signals changed.
					activeRulesSignal.value = core.getRules();
					activeRuleIdsSignal.value = core.getActiveRuleIds();
					expressionSignal.value = core.getExpression();
					modeSignal.value = core.getExpression() !== null ? 'expression' : 'flat-map';
					groupsSignal.value = core.getGroups();
					resultsSignal.value = core.getResults();
					resultCountSignal.value = core.getResultCount();
					workingSetSignal.value = core.store.workingSet.value;
					lastChangeRuleIdSignal.value = core.store.lastChangeRuleId.value;
					lastChangeTimestampSignal.value = core.store.lastChangeTimestamp.value;

					return;

				case 'results':
					resultsSignal.value = core.getResults();
					resultCountSignal.value = core.getResultCount();

					return;
				case 'rule:added':
				case 'rule:changed':
				case 'rule:removed':
					activeRulesSignal.value = core.getRules();
					activeRuleIdsSignal.value = core.getActiveRuleIds();
					lastChangeRuleIdSignal.value = core.store.lastChangeRuleId.value;
					lastChangeTimestampSignal.value = core.store.lastChangeTimestamp.value;
					// Result set changes when rule set changes — re-read.
					resultsSignal.value = core.getResults();
					resultCountSignal.value = core.getResultCount();
					// Pre-populate per-rule signal on `rule:added` if eager mode is on.
					if (event.type === 'rule:added' && options.eagerPerRuleSignals) {
						buildRuleSignal(event.ruleId);
					}

					return;

				case 'sourceData':
					sourceDataSignal.value = core.getSourceData();
					// sourceData change cascades to results via the engine's own computeds — re-read.
					resultsSignal.value = core.getResults();
					resultCountSignal.value = core.getResultCount();
					workingSetSignal.value = core.store.workingSet.value;

					return;

				case 'workingSet':
					workingSetSignal.value = core.store.workingSet.value;
					resultsSignal.value = core.getResults();
					resultCountSignal.value = core.getResultCount();

					return;
			}
		});
	});
	// #endregion docs:subscribe-fan-out

	// ─── The SignalsEngine surface ─────────────────────────────────────────
	const facade: SignalsEngine<T> = {
		activeRuleIds: activeRuleIdsSignal,
		activeRules: activeRulesSignal,
		core,
		dispose: () => {
			if (isDisposed) {
				return;
			}
			isDisposed = true;
			unsubscribe();
			perRuleSignals.clear();
		},
		expression: expressionSignal,
		groups: groupsSignal,
		get isDisposed(): boolean {
			return isDisposed;
		},
		lastChangeEvent: lastChangeEventSignal,
		lastChangeRuleId: lastChangeRuleIdSignal,
		lastChangeTimestamp: lastChangeTimestampSignal,
		mode: modeSignal,
		resultCount: resultCountSignal,
		results: resultsSignal,
		rule: (ruleId: RuleId) => buildRuleSignal(ruleId),
		sourceData: sourceDataSignal,
		// Sync engines have no SWR side-channel — simulate() returns synchronously, no cache
		// to revalidate, nothing to flush. The constant-0 signal satisfies the interface
		// uniformly so SWR-aware hooks (`useExclusion`) don't have to branch on adapter type.
		swrRevision: signal(0),
		workingSet: workingSetSignal,
	};

	return facade;
}
