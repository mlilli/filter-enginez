/**
 * `createRxJsEngineFromAsync` — the adapter that wraps a `FilterEngineAsync<T>` (a
 * worker-hosted engine produced by `@filter-enginez/worker-bridge`'s `wrapInWorker(...)`)
 * in an `RxJsEngine<T>` reactive facade, so consumer code written against the sync engine
 * works unchanged when the engine moves into a Web Worker.
 *
 * @remarks
 * The RxJS twin of `createSignalsEngineFromAsync`. Same architectural contract — `.core` is a
 * sync `FilterEngine` shim backed by local `BehaviorSubject` mirror state, mutations dispatch
 * fire-and-forget to the async engine, and advanced facilities (including `simulate(...)`) throw
 * with a clear pointer. Chip-exclusion data ships via the `applyFiltersAndQuery` bundle (reachable
 * through the `asyncEngine` escape hatch), so, like the signals twin, this adapter needs no
 * per-candidate `simulate()` cache.
 *
 * See `createSignalsEngineFromAsync.ts` (in `@filter-enginez/reactive-signals`) for the full
 * design rationale — this file uses `BehaviorSubject` + the `shareReplay`/`distinctUntilChanged`
 * pipe instead of preact signals.
 *
 * @packageDocumentation
 */

import type {
	ChangeEvent,
	CompositeRule,
	FilterGroup,
	FilterRule,
	RuleId,
	Unsubscribe,
} from '@filter-enginez/core';

import { proxy as comlinkProxy, type FilterEngineAsync } from '@filter-enginez/worker-bridge';
import {
	BehaviorSubject,
	distinctUntilChanged,
	map,
	type Observable,
	shareReplay,
	Subject,
} from 'rxjs';

import type { RxJsEngine } from './RxJsEngine.js';

import { buildCoreShim } from './buildCoreShim.js';
import { createRxJsDevtoolsMirror } from './createRxJsDevtoolsMirror.js';
import { deserializeWireExpression, deserializeWireRules } from './rehydrateWireRules.js';

/**
 * Options for `createRxJsEngineFromAsync`. Shape-parallel with
 * `CreateSignalsEngineFromAsyncOptions` so consumers swapping between signals + rxjs
 * adapters don't relearn the options surface.
 */
export interface CreateRxJsEngineFromAsyncOptions {
	/**
	 * `shareReplay` buffer size for all derived streams. Default `1` — late subscribers see
	 * the most recent value on subscribe.
	 */
	readonly replayBufferSize?: number;

	/**
	 * If `true`, the adapter eagerly creates per-rule streams for every currently-registered
	 * rule on construction (and on every `rule:added` event). Default `false`.
	 */
	readonly eagerPerRuleStreams?: boolean;

	/**
	 * @deprecated No-op. This adapter keeps no simulate cache — chip exclusion data arrives in
	 * `applyFiltersAndQuery`'s bundled response. Accepted for options-shape parity with the signals
	 * adapter; the value is ignored.
	 */
	readonly simulateCacheMax?: number;
}

/**
 * Wrap a `FilterEngineAsync<T>` (typically from `wrapInWorker(...)`) in an `RxJsEngine<T>`
 * reactive facade. Resolves once initial state has been pulled from the worker.
 *
 * @typeParam T - The item type the underlying engine operates over
 * @param asyncEngine - The worker-hosted engine to adapt
 * @param options - Optional adapter configuration
 * @returns An `RxJsEngine<T>` whose surface matches `createRxJsEngine(coreEngine)` —
 *   drop-in for any consumer already coded against the sync version.
 *
 * @example
 *   import { wrapInWorker } from '@filter-enginez/worker-bridge';
 *   import { createRxJsEngineFromAsync } from '@filter-enginez/reactive-rxjs/worker';
 *
 *   const asyncEngine = await wrapInWorker<Wine>({
 *     worker: new Worker(new URL('./wine.worker.ts', import.meta.url), { type: 'module' }),
 *     factoryName: 'wineEngine',
 *   });
 *   const engine = await createRxJsEngineFromAsync(asyncEngine);
 */
export async function createRxJsEngineFromAsync<T>(
	asyncEngine: FilterEngineAsync<T>,
	options: CreateRxJsEngineFromAsyncOptions = {},
): Promise<RxJsEngine<T>> {
	const replayBufferSize = options.replayBufferSize ?? 1;

	// ─── Initial state pull — sourceData ONCE, then derived state ──────────
	// Same bandwidth contract as `createSignalsEngineFromAsync`: pull the ~110MB source corpus
	// exactly once at boot, then subsequent rule/expression events ship indices (Uint32Array,
	// postMessage-transferred zero-copy) and the main thread joins them against the bootstrapped
	// source mirror to hydrate results. See sibling adapter's intro comment for the full design.
	const initialSourceData = await asyncEngine.getSourceData();
	const [
		initialResults,
		initialResultCount,
		initialActiveRulesSerialized,
		initialActiveRuleIds,
		initialExpression,
		initialGroups,
		// Two more round trips at boot, not two more corpus transfers — the action log is capped
		// worker-side (default 100 entries) and the cursor is four numbers. Seeding here rather
		// than lazily is what lets a devtools panel render rows on its FIRST paint instead of
		// after the first engine event.
		initialActionLog,
		initialDevtoolsState,
	] = await Promise.all([
		asyncEngine.getResults(),
		asyncEngine.getResultCount(),
		asyncEngine.getRules(),
		asyncEngine.getActiveRuleIds(),
		asyncEngine.getExpression(),
		asyncEngine.getGroups(),
		asyncEngine.getActionLogSnapshot(),
		asyncEngine.getDevtoolsState(),
	]);

	const initialActiveRules = deserializeWireRules(initialActiveRulesSerialized);

	// ─── BehaviorSubjects — seeded from the initial pull ────────────────────
	const resultsSubject = new BehaviorSubject<readonly T[]>(initialResults);
	const resultCountSubject = new BehaviorSubject<number>(initialResultCount);
	const sourceDataSubject = new BehaviorSubject<readonly T[]>(initialSourceData);
	const workingSetSubject = new BehaviorSubject<readonly T[]>(initialSourceData);
	const activeRulesSubject = new BehaviorSubject<ReadonlyMap<RuleId, FilterRule>>(initialActiveRules);
	const activeRuleIdsSubject = new BehaviorSubject<readonly RuleId[]>(initialActiveRuleIds);
	const expressionSubject = new BehaviorSubject<CompositeRule | null>(
		deserializeWireExpression(initialExpression),
	);
	const groupsSubject = new BehaviorSubject<readonly FilterGroup[]>(initialGroups);
	const modeSubject = new BehaviorSubject<'expression' | 'flat-map'>(
		initialExpression !== null ? 'expression' : 'flat-map',
	);
	const lastChangeRuleIdSubject = new BehaviorSubject<RuleId | null>(null);
	const lastChangeTimestampSubject = new BehaviorSubject<number | null>(null);
	const lastChangeEventSubject = new BehaviorSubject<ChangeEvent | null>(null);
	const eventsSubject = new Subject<ChangeEvent>();

	const shareConfig = { bufferSize: replayBufferSize, refCount: false } as const;
	const wrapHot = <U>(subject: BehaviorSubject<U>): Observable<U> =>
		subject.pipe(distinctUntilChanged(), shareReplay(shareConfig));

	// ─── Per-rule stream cache ──────────────────────────────────────────────
	const perRuleStreams = new Map<RuleId, Observable<FilterRule | undefined>>();
	const buildRuleStream = (ruleId: RuleId): Observable<FilterRule | undefined> => {
		let cached = perRuleStreams.get(ruleId);

		if (!cached) {
			cached = activeRulesSubject.pipe(
				map((rules) => rules.get(ruleId)),
				distinctUntilChanged(),
				shareReplay(shareConfig),
			);
			perRuleStreams.set(ruleId, cached);
		}

		return cached;
	};

	if (options.eagerPerRuleStreams) {
		for (const id of initialActiveRules.keys()) {
			buildRuleStream(id);
		}
	}

	let isDisposed = false;
	// Read disposal state through a function so post-`await` guards stay meaningful: `dispose()`
	// can flip `isDisposed` to `true` while a refresh's `await` is in flight, but TS narrows the
	// closure-captured `let` to `false` after the synchronous top-of-function guard and can't see
	// the cross-tick mutation. Routing the post-await reads through a call defeats that narrowing
	// so the guard reflects real runtime state instead of being flagged as always-falsy.
	const checkDisposed = (): boolean => isDisposed;

	// ─── Indices → results projection ──────────────────────────────────────
	// Mirror of the signals adapter's helper — preallocated loop instead of `.map`, identity
	// fast-path when indices length === workingSet length (preserves referential stability for
	// memoized consumers).
	const projectResults = (indices: Uint32Array, workingSet: readonly T[]): readonly T[] => {
		if (indices.length === workingSet.length) {
			return workingSet;
		}
		const out = new Array<T>(indices.length);

		for (let i = 0; i < indices.length; i++) {
			out[i] = workingSet[indices[i] as number] as T;
		}

		return out;
	};

	// ─── Event-type-aware refresh family ───────────────────────────────────
	// Naively refreshing all 7 signals on every engine event floods the postMessage channel
	// during slider drag — each drag tick is a `rule:changed` event, each event posted 7
	// getter calls (each carrying potentially-megabyte payloads like the results array).
	// Instead, dispatch by event type and pull only what changed: a rule mutation refetches
	// rules + indices, an expression change refetches expression + indices, etc. `sourceData`
	// + `reset` are the only paths that re-pull the corpus.
	//
	// **Disposal contract.** These are invoked ONLY from `handleEvent`, which guards `isDisposed`
	// synchronously before dispatch — so each refresher needs only the POST-await `checkDisposed()`
	// re-check (dispose can flip during the in-flight worker round-trip), not a redundant pre-await
	// guard. (The signals twin keeps a pre-await guard because its refreshers are also callable
	// directly from the core shim; the rxjs shim doesn't call them.)
	let unsubscribePromise: Promise<Unsubscribe> | null = null;

	const refreshResultsAndCount = async (): Promise<void> => {
		const indices = await asyncEngine.getResultIndices();

		if (checkDisposed()) {
			return;
		}
		const projected = projectResults(indices, workingSetSubject.value);

		resultsSubject.next(projected);
		resultCountSubject.next(indices.length);
	};

	const refreshRulesAndResults = async (): Promise<void> => {
		const [arSerialized, ari, indices] = await Promise.all([
			asyncEngine.getRules(),
			asyncEngine.getActiveRuleIds(),
			asyncEngine.getResultIndices(),
		]);

		if (checkDisposed()) {
			return;
		}
		const ar = deserializeWireRules(arSerialized);
		const projected = projectResults(indices, workingSetSubject.value);

		// Independent next() calls — downstream `distinctUntilChanged()` suppresses no-op
		// emissions. Close enough to `signals.batch()` without the explicit primitive.
		activeRulesSubject.next(ar);
		activeRuleIdsSubject.next(ari);
		resultsSubject.next(projected);
		resultCountSubject.next(indices.length);
	};

	const refreshExpressionAndResults = async (): Promise<void> => {
		const [ex, indices] = await Promise.all([
			asyncEngine.getExpression(),
			asyncEngine.getResultIndices(),
		]);

		if (checkDisposed()) {
			return;
		}
		const projected = projectResults(indices, workingSetSubject.value);

		expressionSubject.next(deserializeWireExpression(ex));
		modeSubject.next(ex !== null ? 'expression' : 'flat-map');
		resultsSubject.next(projected);
		resultCountSubject.next(indices.length);
	};

	const refreshSourceAndDerived = async (): Promise<void> => {
		// SourceData mutation — must re-pull the corpus.
		const [s, indices] = await Promise.all([
			asyncEngine.getSourceData(),
			asyncEngine.getResultIndices(),
		]);

		if (checkDisposed()) {
			return;
		}
		const projected = projectResults(indices, s);

		sourceDataSubject.next(s);
		workingSetSubject.next(s);
		resultsSubject.next(projected);
		resultCountSubject.next(indices.length);
	};

	const refreshEverything = async (): Promise<void> => {
		const [s, indices, arSerialized, ari, ex, gs] = await Promise.all([
			asyncEngine.getSourceData(),
			asyncEngine.getResultIndices(),
			asyncEngine.getRules(),
			asyncEngine.getActiveRuleIds(),
			asyncEngine.getExpression(),
			asyncEngine.getGroups(),
		]);

		if (checkDisposed()) {
			return;
		}
		const ar = deserializeWireRules(arSerialized);
		const projected = projectResults(indices, s);

		sourceDataSubject.next(s);
		workingSetSubject.next(s);
		resultsSubject.next(projected);
		resultCountSubject.next(indices.length);
		activeRulesSubject.next(ar);
		activeRuleIdsSubject.next(ari);
		expressionSubject.next(deserializeWireExpression(ex));
		modeSubject.next(ex !== null ? 'expression' : 'flat-map');
		groupsSubject.next(gs);
	};

	// ─── Devtools mirror ────────────────────────────────────────────────────
	// The whole devtools concern — both mirrors, their refresher, the post-time-travel
	// reconciliation, and the collaborators the shared shim needs — lives in its own module. See
	// `createRxJsDevtoolsMirror.ts`; declared here, after `refreshEverything`, because the
	// reconciliation runs it.
	const {
		actionLogSubject,
		devtoolsShimDeps,
		devtoolsStateSubject,
		refreshDevtools,
	} = createRxJsDevtoolsMirror<T>({
		asyncEngine,
		getIsDisposed: checkDisposed,
		initialActionLog,
		initialDevtoolsState,
		lastChangeEventSubject,
		lastChangeTimestampSubject,
		refreshEverything,
	});

	const handleEvent = (event: ChangeEvent): void => {
		if (isDisposed) {
			return;
		}
		eventsSubject.next(event);

		// Route to the smallest refresh that satisfies this event's contract.
		let refresh: Promise<void>;

		switch (event.type) {
			case 'expression':
				refresh = refreshExpressionAndResults();
				break;
			case 'results':
				refresh = refreshResultsAndCount();
				break;
			case 'rule:added':
			case 'rule:changed':
			case 'rule:removed':
				refresh = refreshRulesAndResults();
				break;
			case 'sourceData':
			case 'workingSet':
				refresh = refreshSourceAndDerived();
				break;
			case 'reset':
			default:
				refresh = refreshEverything();
				break;
		}

		// **Critical ordering — the devtools refresh runs BEFORE the lastChange tick, in parallel
		// with the main refresh.** This is the one thing in the devtools mirror that typechecks,
		// lints, unit-tests and still misbehaves if written the obvious way.
		//
		// A devtools panel re-renders off `lastChangeTimestamp$`, not off the action-log stream
		// directly. So if `refreshDevtools()` is fired after the lastChange tick — or not awaited
		// alongside `refresh` — the panel renders on the tick that the log mirror has not caught up
		// to yet, and shows an EMPTY action log on its first render. The signals twin documents the
		// same constraint at `createSignalsEngineFromAsync.ts`, and both adapters share this shape.
		// `createRxJsEngineFromAsync.devtools.test.ts` pins the ordering, and that test is
		// mutation-verified by reversing it.
		void Promise.all([refresh, refreshDevtools()]).then(() => {
			if (isDisposed) {
				return;
			}
			lastChangeEventSubject.next(event);
			if (event.type === 'rule:added' || event.type === 'rule:removed' || event.type === 'rule:changed') {
				lastChangeRuleIdSubject.next(event.ruleId);
			}
			lastChangeTimestampSubject.next(Date.now());
			if (event.type === 'rule:added' && options.eagerPerRuleStreams) {
				buildRuleStream(event.ruleId);
			}
		});
	};

	unsubscribePromise = asyncEngine.subscribe(comlinkProxy(handleEvent));

	// ─── The `.core` sync FilterEngine shim ─────────────────────────────────
	// Extracted to `buildCoreShim.ts` to keep this file under the `max-lines` cap. Reads come from
	// the mirror subjects; mutations dispatch fire-and-forget to the async engine.
	const coreShim = buildCoreShim<T>({
		activeRuleIdsSubject,
		activeRulesSubject,
		asyncEngine,
		eventsSubject,
		expressionSubject,
		groupsSubject,
		resultCountSubject,
		resultsSubject,
		sourceDataSubject,
		...devtoolsShimDeps,
	});

	// ─── The RxJsEngine surface ─────────────────────────────────────────────
	const facade: RxJsEngine<T> = {
		activeRuleIds$: wrapHot(activeRuleIdsSubject),
		activeRules$: wrapHot(activeRulesSubject),
		// Escape hatch — the underlying worker-hosted engine, for consumers needing async-only
		// methods (e.g. `applyFiltersAndQuery` for one-round-trip chip exclusion + slider bounds).
		// Mirrors `SignalsEngine.asyncEngine`.
		asyncEngine,
		core: coreShim,
		dispose: () => {
			if (isDisposed) {
				return;
			}
			isDisposed = true;
			void unsubscribePromise.then((unsub) => {
				try {
					unsub();
				} catch { /* tolerate */ }
			});
			perRuleStreams.clear();
			actionLogSubject.complete();
			devtoolsStateSubject.complete();
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
			eventsSubject.complete();
		},
		events$: eventsSubject.pipe(shareReplay(shareConfig)),
		expression$: wrapHot(expressionSubject),
		groups$: wrapHot(groupsSubject),
		get isDisposed(): boolean {
			return isDisposed;
		},
		lastChangeEvent$: wrapHot(lastChangeEventSubject),
		lastChangeRuleId$: wrapHot(lastChangeRuleIdSubject),
		lastChangeTimestamp$: wrapHot(lastChangeTimestampSubject),
		mode$: wrapHot(modeSubject),
		resultCount$: wrapHot(resultCountSubject),
		results$: wrapHot(resultsSubject),
		rule$: (ruleId: RuleId) => buildRuleStream(ruleId),
		sourceData$: wrapHot(sourceDataSubject),
		workingSet$: wrapHot(workingSetSubject),
	};

	return facade;
}
