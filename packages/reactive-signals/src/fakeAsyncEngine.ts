/**
 * `makeFakeAsyncEngine` — an in-memory, controllable `FilterEngineAsync<T>` fake for the
 * worker-path adapter test suites.
 *
 * @remarks
 * The real async engine on a worker-backed adapter is Comlink-proxied across a `postMessage`
 * boundary. Under test there is no worker, so this fake stands in: every async method
 * returns a Promise resolving from a seedable in-memory state, `subscribe` captures the
 * listener so a test can drive `ChangeEvent`s directly, and every mutation is recorded so a
 * test can assert exactly what crossed the (simulated) boundary and with what payload.
 *
 * **Wire-serialization mirror.** The refreshers reconstruct rules via
 * `ruleRegistry.deserialize(rule as unknown as SerializedRule)`, so the fake's `getRules`
 * returns rules in SERIALIZED form (each entry produced by `realRule.serialize()`), matching
 * what Comlink would actually carry. The same cast-through-`unknown` seam the production wire
 * layer uses is mirrored here at the typed boundary.
 *
 * This is a test-support module (no `.test` suffix) imported by the worker-path suites — it
 * ships no runtime behavior of its own and is excluded from package coverage by virtue of
 * being import-only test scaffolding.
 *
 * @packageDocumentation
 */

import type {
	ChangeEvent,
	ChangeListener,
	CompositeRule,
	FilterBundle,
	FilterEngineConfig,
	FilterGroup,
	FilterRule,
	RuleId,
	SimulationModification,
	SimulationResult,
	Unsubscribe,
} from '@filter-enginez/core';
import type {
	FilterEngineAsync,
	WireActionLogEntry,
	WireDevtoolsState,
} from '@filter-enginez/worker-bridge';

/**
 * One recorded mutation crossing the simulated postMessage boundary: the method name plus the
 * argument tuple it was called with.
 */
export interface RecordedCall {
	readonly args: readonly unknown[];
	readonly method: string;
}

/**
 * The seedable in-memory state the fake's getters read from. Every field is mutable so a test
 * can reseed mid-flight (e.g., to simulate the worker's state having advanced before a refresh
 * resolves).
 */
export interface FakeAsyncEngineState<T> {
	actionLog: readonly WireActionLogEntry[];
	activeRuleIds: readonly RuleId[];
	devtoolsState: WireDevtoolsState;
	expression: CompositeRule | null;
	groups: readonly FilterGroup[];
	resultCount: number;
	resultIndices: Uint32Array;
	results: readonly T[];
	/** Stored in SERIALIZED form — `getRules` returns this map cast to the wire shape. */
	rules: ReadonlyMap<RuleId, FilterRule>;
	sourceData: readonly T[];
}

/**
 * The fake plus its test-facing control surface.
 */
export interface FakeAsyncEngine<T> {
	/** The `FilterEngineAsync<T>` the adapter under test consumes. */
	readonly engine: FilterEngineAsync<T>;
	/** Drive a `ChangeEvent` into the captured subscribe listener (no-op if none captured). */
	emit(event: ChangeEvent): void;
	/** All recorded mutation calls, in dispatch order. */
	readonly calls: RecordedCall[];
	/** The most recent listener handed to `subscribe`, or `null` before any subscribe. */
	getListener(): ChangeListener | null;
	/** The unsubscribe spy `subscribe` resolved with — records its call count. */
	readonly unsubscribe: { (): void; callCount: number };
	/** Make the next (and all subsequent) `unsubscribe()` invocations throw. */
	makeUnsubscribeThrow(): void;
	/** Live, mutable in-memory state the getters read from. */
	readonly state: FakeAsyncEngineState<T>;
}

/**
 * Build a controllable fake `FilterEngineAsync<T>`.
 *
 * @typeParam T - The item type the engine operates over
 * @param seed - Partial initial state; unspecified fields default to empty/zero values.
 * @returns The fake engine plus its test control surface.
 */
export function makeFakeAsyncEngine<T>(
	seed: Partial<FakeAsyncEngineState<T>> = {},
): FakeAsyncEngine<T> {
	const state: FakeAsyncEngineState<T> = {
		actionLog: seed.actionLog ?? [],
		activeRuleIds: seed.activeRuleIds ?? [],
		devtoolsState: seed.devtoolsState
			?? { canRedo: false, canUndo: false, currentIndex: -1, total: 0 },
		expression: seed.expression ?? null,
		groups: seed.groups ?? [],
		resultCount: seed.resultCount ?? (seed.results?.length ?? 0),
		resultIndices: seed.resultIndices ?? new Uint32Array(0),
		results: seed.results ?? [],
		rules: seed.rules ?? new Map<RuleId, FilterRule>(),
		sourceData: seed.sourceData ?? [],
	};

	const calls: RecordedCall[] = [];
	const record = (method: string, ...args: readonly unknown[]): void => {
		calls.push({ args, method });
	};

	let listener: ChangeListener | null = null;
	let willThrowOnUnsubscribe = false;

	const unsubscribe = Object.assign(
		(): void => {
			unsubscribe.callCount += 1;
			if (willThrowOnUnsubscribe) {
				throw new Error('fake unsubscribe: worker already torn down');
			}
		},
		{ callCount: 0 },
	);

	const engine: FilterEngineAsync<T> = {
		addGroup: async (group: FilterGroup) => {
			record('addGroup', group);

			return Promise.resolve();
		},
		addRule: async (ruleId: RuleId, rule: FilterRule) => {
			record('addRule', ruleId, rule);

			return Promise.resolve();
		},
		applyFiltersAndQuery: async (query?) => {
			record('applyFiltersAndQuery', query);

			return Promise.resolve({} as unknown as FilterBundle);
		},
		clearRules: async () => {
			record('clearRules');

			return Promise.resolve();
		},
		destroy: async () => {
			record('destroy');

			return Promise.resolve();
		},
		exportConfig: async () => {
			record('exportConfig');

			return Promise.resolve({} as unknown as FilterEngineConfig);
		},
		getActionLogSnapshot: async () => Promise.resolve(state.actionLog),
		getActiveRuleIds: async () => Promise.resolve(state.activeRuleIds),
		getDevtoolsState: async () => Promise.resolve(state.devtoolsState),
		getExpression: async () => Promise.resolve(state.expression),
		getFilteredFieldValuesExcept: async (excludeRuleId: RuleId, fieldKey: string) => {
			record('getFilteredFieldValuesExcept', excludeRuleId, fieldKey);

			return Promise.resolve(new Float64Array(0));
		},
		getGroups: async () => Promise.resolve(state.groups),
		getResultCount: async () => Promise.resolve(state.resultCount),
		getResultIndices: async () => Promise.resolve(state.resultIndices),
		getResults: async () => Promise.resolve(state.results),
		// Stored serialized; the wire boundary carries `SerializedRule`, typed as `FilterRule`.
		getRule: async (ruleId: RuleId) => Promise.resolve(state.rules.get(ruleId)),
		getRules: async () => Promise.resolve(state.rules),
		getSourceData: async () => Promise.resolve(state.sourceData),
		jumpToDevtoolsIndex: async (index: number) => {
			record('jumpToDevtoolsIndex', index);

			return Promise.resolve();
		},
		loadConfig: async (config: FilterEngineConfig) => {
			record('loadConfig', config);

			return Promise.resolve();
		},
		redoDevtools: async () => {
			record('redoDevtools');

			return Promise.resolve();
		},
		removeGroup: async (groupId: string) => {
			record('removeGroup', groupId);

			return Promise.resolve();
		},
		removeRule: async (ruleId: RuleId) => {
			record('removeRule', ruleId);

			return Promise.resolve();
		},
		reset: async () => {
			record('reset');

			return Promise.resolve();
		},
		resetWorkingSet: async () => {
			record('resetWorkingSet');

			return Promise.resolve();
		},
		setExpression: async (expression: CompositeRule | null) => {
			record('setExpression', expression);

			return Promise.resolve();
		},
		setSourceData: async (items: readonly T[]) => {
			record('setSourceData', items);

			return Promise.resolve();
		},
		setWorkingSet: async (items: readonly T[]) => {
			record('setWorkingSet', items);

			return Promise.resolve();
		},
		simulate: async (modification: SimulationModification) => {
			record('simulate', modification);

			return Promise.resolve({} as unknown as SimulationResult<T>);
		},
		subscribe: async (incoming: ChangeListener) => {
			listener = incoming;
			record('subscribe');

			return Promise.resolve(unsubscribe as Unsubscribe);
		},
		undoDevtools: async () => {
			record('undoDevtools');

			return Promise.resolve();
		},
	};

	return {
		calls,
		emit: (event: ChangeEvent): void => {
			listener?.(event);
		},
		engine,
		getListener: () => listener,
		makeUnsubscribeThrow: (): void => {
			willThrowOnUnsubscribe = true;
		},
		state,
		unsubscribe,
	};
}
