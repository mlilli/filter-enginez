/**
 * `createRxJsEngine` — the factory that wraps a `FilterEngine` in an `RxJsEngine` reactive
 * facade backed by RxJS Observables.
 *
 * @remarks
 * Per `docs/architecture.md` §11.2. The RxJS half of the Adapter+Facade pattern — bridges
 * the engine's plain `subscribe(callback)` API to a hot, multicast Observable graph
 * consumers compose with the full RxJS operator suite.
 *
 * **The fan-out.** Every `ChangeEvent` the engine emits routes to exactly the per-key
 * `BehaviorSubject`s it affects, mirroring the signals adapter's `switch` semantics. Each
 * exposed `$`-suffixed Observable is the underlying subject piped through
 * `distinctUntilChanged()` so consumers only see emissions when the value actually changes,
 * and through `shareReplay({ bufferSize, refCount: false })` so late subscribers see the
 * most recent value immediately.
 *
 * **Per-rule stream cache.** `engine.rule$('price-range')` returns an Observable derived
 * from `activeRules$` with `map + distinctUntilChanged`. Memoized by id so multiple consumers
 * asking for the same rule share one derivation — same React render-stability concern as the
 * signals adapter.
 *
 * **Why BehaviorSubjects instead of fromEventPattern.** The `BehaviorSubject` pattern gives
 * us synchronous current-value access via `.value` (handy for the React adapter's
 * `useObservable` initial-value parameter) AND clean disposal via `.complete()`. A
 * `fromEventPattern` approach over `core.subscribe` works for the events$ raw stream but
 * doesn't carry a "current value" out of the box, so we'd need a `BehaviorSubject` per
 * derived stream anyway. Cleaner to use them throughout.
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

import {
	BehaviorSubject,
	distinctUntilChanged,
	map,
	type Observable,
	shareReplay,
	Subject,
} from 'rxjs';

import type { RxJsEngine } from './RxJsEngine.js';

/**
 * Options for `createRxJsEngine`.
 */
export interface CreateRxJsEngineOptions {
	/**
	 * `shareReplay` buffer size for all derived streams. Default `1` — late subscribers see
	 * the most recent value on subscribe. Set to `0` to suppress replay (subscribers only see
	 * subsequent emissions; matches the cold-observable semantics consumers coming from older
	 * RxJS habits may expect).
	 */
	readonly replayBufferSize?: number;

	/**
	 * If `true`, the adapter eagerly creates per-rule streams for every currently-registered
	 * rule on construction (and on every `rule:added` event). Default `false` — per-rule
	 * streams are lazily created on first `engine.rule$(id)` call.
	 */
	readonly eagerPerRuleStreams?: boolean;
}

/**
 * Wrap a `FilterEngine` in an `RxJsEngine` reactive facade.
 *
 * @typeParam T - The item type the underlying engine operates over
 * @param core - The engine instance to adapt
 * @param options - Optional adapter configuration
 * @returns An `RxJsEngine<T>` exposing the engine state as RxJS Observables
 *
 * @example
 *   import { createFilterEngine } from '@filter-enginez/core';
 *   import { createRxJsEngine } from '@filter-enginez/reactive-rxjs';
 *   import { combineLatest, map } from 'rxjs';
 *
 *   const core = createFilterEngine<Wine>({ sourceData: wines });
 *   const engine = createRxJsEngine(core);
 *
 *   combineLatest([engine.results$, engine.activeRuleIds$])
 *     .pipe(map(([r, ids]) => `${r.length} matches across ${ids.length} filters`))
 *     .subscribe(console.log);
 *
 *   core.addRule('price', range('price', { min: 10, max: 50 }));
 *
 *   engine.dispose();
 */
export function createRxJsEngine<T>(
	core: FilterEngine<T>,
	options: CreateRxJsEngineOptions = {},
): RxJsEngine<T> {
	// #region docs:seeded-subjects-and-streams
	const bufferSize = options.replayBufferSize ?? 1;

	// ─── Underlying BehaviorSubjects — seeded from the engine's current state ──
	const eventsSubject = new Subject<ChangeEvent>();
	const resultsSubject = new BehaviorSubject<readonly T[]>(core.getResults());
	const resultCountSubject = new BehaviorSubject<number>(core.getResultCount());
	const sourceDataSubject = new BehaviorSubject<readonly T[]>(core.getSourceData());
	const workingSetSubject = new BehaviorSubject<readonly T[]>(core.store.workingSet.value);
	const activeRulesSubject = new BehaviorSubject<ReadonlyMap<RuleId, FilterRule>>(core.getRules());
	const activeRuleIdsSubject = new BehaviorSubject<readonly RuleId[]>(core.getActiveRuleIds());
	const expressionSubject = new BehaviorSubject<CompositeRule | null>(core.getExpression());
	const groupsSubject = new BehaviorSubject<readonly FilterGroup[]>(core.getGroups());
	const modeSubject = new BehaviorSubject<'expression' | 'flat-map'>(
		core.getExpression() !== null ? 'expression' : 'flat-map',
	);
	const lastChangeRuleIdSubject = new BehaviorSubject<RuleId | null>(core.store.lastChangeRuleId.value);
	const lastChangeTimestampSubject = new BehaviorSubject<number | null>(core.store.lastChangeTimestamp.value);
	const lastChangeEventSubject = new BehaviorSubject<ChangeEvent | null>(null);

	// ─── Public `$`-streams — each derived via distinctUntilChanged + shareReplay ──
	const events$ = eventsSubject.asObservable().pipe(shareReplay({ bufferSize, refCount: false }));
	const results$ = resultsSubject.pipe(distinctUntilChanged(), shareReplay({ bufferSize, refCount: false }));
	const resultCount$ = resultCountSubject.pipe(distinctUntilChanged(), shareReplay({ bufferSize, refCount: false }));
	const sourceData$ = sourceDataSubject.pipe(distinctUntilChanged(), shareReplay({ bufferSize, refCount: false }));
	const workingSet$ = workingSetSubject.pipe(distinctUntilChanged(), shareReplay({ bufferSize, refCount: false }));
	const activeRules$ = activeRulesSubject.pipe(distinctUntilChanged(), shareReplay({ bufferSize, refCount: false }));
	const activeRuleIds$ = activeRuleIdsSubject.pipe(distinctUntilChanged(), shareReplay({ bufferSize, refCount: false }));
	const expression$ = expressionSubject.pipe(distinctUntilChanged(), shareReplay({ bufferSize, refCount: false }));
	const groups$ = groupsSubject.pipe(distinctUntilChanged(), shareReplay({ bufferSize, refCount: false }));
	const mode$ = modeSubject.pipe(distinctUntilChanged(), shareReplay({ bufferSize, refCount: false }));
	const lastChangeRuleId$ = lastChangeRuleIdSubject.pipe(distinctUntilChanged(), shareReplay({ bufferSize, refCount: false }));
	const lastChangeTimestamp$ = lastChangeTimestampSubject.pipe(distinctUntilChanged(), shareReplay({ bufferSize, refCount: false }));
	const lastChangeEvent$ = lastChangeEventSubject.pipe(shareReplay({ bufferSize, refCount: false }));
	// #endregion docs:seeded-subjects-and-streams

	// ─── Per-rule stream cache (memoized lazy derivations) ─────────────────
	const perRuleStreams = new Map<RuleId, Observable<FilterRule | undefined>>();
	const buildRuleStream = (ruleId: RuleId): Observable<FilterRule | undefined> => {
		let cached = perRuleStreams.get(ruleId);

		if (!cached) {
			cached = activeRulesSubject.pipe(
				map((rules) => rules.get(ruleId)),
				distinctUntilChanged(),
				shareReplay({ bufferSize, refCount: false }),
			);
			perRuleStreams.set(ruleId, cached);
		}

		return cached;
	};

	if (options.eagerPerRuleStreams) {
		for (const id of core.getRules().keys()) {
			buildRuleStream(id);
		}
	}

	let isDisposed = false;

	// ─── The engine.subscribe fan-out loop ─────────────────────────────────
	const unsubscribe = core.subscribe((event: ChangeEvent) => {
		if (isDisposed) {
			return;
		}

		eventsSubject.next(event);
		lastChangeEventSubject.next(event);

		switch (event.type) {
			case 'expression':
				expressionSubject.next(core.getExpression());
				modeSubject.next(core.getExpression() !== null ? 'expression' : 'flat-map');
				resultsSubject.next(core.getResults());
				resultCountSubject.next(core.getResultCount());

				return;

			case 'reset':
				activeRulesSubject.next(core.getRules());
				activeRuleIdsSubject.next(core.getActiveRuleIds());
				expressionSubject.next(core.getExpression());
				modeSubject.next(core.getExpression() !== null ? 'expression' : 'flat-map');
				groupsSubject.next(core.getGroups());
				resultsSubject.next(core.getResults());
				resultCountSubject.next(core.getResultCount());
				workingSetSubject.next(core.store.workingSet.value);
				lastChangeRuleIdSubject.next(core.store.lastChangeRuleId.value);
				lastChangeTimestampSubject.next(core.store.lastChangeTimestamp.value);

				return;

			case 'results':
				resultsSubject.next(core.getResults());
				resultCountSubject.next(core.getResultCount());

				return;
			case 'rule:added':
			case 'rule:changed':
			case 'rule:removed':
				activeRulesSubject.next(core.getRules());
				activeRuleIdsSubject.next(core.getActiveRuleIds());
				lastChangeRuleIdSubject.next(core.store.lastChangeRuleId.value);
				lastChangeTimestampSubject.next(core.store.lastChangeTimestamp.value);
				resultsSubject.next(core.getResults());
				resultCountSubject.next(core.getResultCount());
				if (event.type === 'rule:added' && options.eagerPerRuleStreams) {
					buildRuleStream(event.ruleId);
				}

				return;

			case 'sourceData':
				sourceDataSubject.next(core.getSourceData());
				resultsSubject.next(core.getResults());
				resultCountSubject.next(core.getResultCount());
				workingSetSubject.next(core.store.workingSet.value);

				return;

			case 'workingSet':
				workingSetSubject.next(core.store.workingSet.value);
				resultsSubject.next(core.getResults());
				resultCountSubject.next(core.getResultCount());

				return;
		}
	});

	// ─── The RxJsEngine surface ────────────────────────────────────────────
	const facade: RxJsEngine<T> = {
		activeRuleIds$,
		activeRules$,
		core,
		dispose: () => {
			if (isDisposed) {
				return;
			}
			isDisposed = true;
			unsubscribe();
			// Complete every subject so live subscribers see the stream end cleanly.
			eventsSubject.complete();
			resultsSubject.complete();
			resultCountSubject.complete();
			sourceDataSubject.complete();
			workingSetSubject.complete();
			activeRulesSubject.complete();
			activeRuleIdsSubject.complete();
			expressionSubject.complete();
			groupsSubject.complete();
			modeSubject.complete();
			lastChangeRuleIdSubject.complete();
			lastChangeTimestampSubject.complete();
			lastChangeEventSubject.complete();
			perRuleStreams.clear();
		},
		events$,
		expression$,
		groups$,
		get isDisposed(): boolean {
			return isDisposed;
		},
		lastChangeEvent$,
		lastChangeRuleId$,
		lastChangeTimestamp$,
		mode$,
		resultCount$,
		results$,
		rule$: (ruleId: RuleId) => buildRuleStream(ruleId),
		sourceData$,
		// Sync engines have no SWR side-channel — simulate() returns synchronously, no cache
		// to revalidate, nothing to flush. The constant-0 observable satisfies the interface
		// uniformly so SWR-aware hooks don't have to branch on adapter type.
		swrRevision$: new BehaviorSubject<number>(0).pipe(shareReplay({ bufferSize, refCount: false })),
		workingSet$,
	};

	return facade;
}
