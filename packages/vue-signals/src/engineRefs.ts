/**
 * `useEngineRefs` — the ergonomic bag of Vue refs over a `SignalsEngine<T>`.
 *
 * @remarks
 * The Vue counterpart to `svelte-signals`' `createEngineStores` (and `react-signals`' per-signal
 * hooks). Called ONCE in a component's `setup()`, it returns a bag of read-only `shallowRef`s (+ a
 * `computed` `lastChange`) you read with `.value` in templates. Each field is `useSignal(engine.<signal>)`;
 * `lastChange` composes the three last-change signals into one object (matching the React/Svelte shape
 * so shared app logic reads identical fields across frameworks). Writes are NOT here — they go straight
 * through `engine.core.addRule(...)` etc., identical across every framework.
 *
 * @packageDocumentation
 */

import type { ChangeEvent, CompositeRule, FilterRule, RuleId } from '@filter-enginez/core';
import type { SignalsEngine } from '@filter-enginez/reactive-signals';

import { computed, type ComputedRef, type ShallowRef } from 'vue';

import { useFilterEngine } from './context.js';
import { useSignal } from './useSignal.js';

/**
 * The composed last-change value — mirrors `react-signals`' `useLastChange` / `svelte-signals`'
 * `LastChange` so shared app logic reads the same fields across frameworks.
 */
export interface LastChange {
	/** The change event that fired, or `null` before any change. */
	readonly event: ChangeEvent | null;
	/** The rule id that changed (for rule events), or `null`. */
	readonly ruleId: RuleId | null;
	/** The change timestamp (ms), or `null` before any change. */
	readonly timestamp: number | null;
}

/**
 * The bag of engine-state refs. Every field is a read-only Vue ref consumed with `.value`.
 *
 * @typeParam T - The item type the engine operates over.
 */
export interface EngineRefs<T> {
	/** Active rule ids, in insertion order. */
	readonly activeRuleIds: Readonly<ShallowRef<readonly RuleId[]>>;
	/** The active rule instances, keyed by id. */
	readonly activeRules: Readonly<ShallowRef<ReadonlyMap<RuleId, FilterRule>>>;
	/** The current boolean expression (expression mode), or `null` in flat-map mode. */
	readonly expression: Readonly<ShallowRef<CompositeRule | null>>;
	/** The composed last-change value (rule id + timestamp + event). */
	readonly lastChange: ComputedRef<LastChange>;
	/** The engine's composition mode. */
	readonly mode: Readonly<ShallowRef<'expression' | 'flat-map'>>;
	/** The current result count. */
	readonly resultCount: Readonly<ShallowRef<number>>;
	/** The current filtered results. */
	readonly results: Readonly<ShallowRef<readonly T[]>>;
	/** The full source corpus. */
	readonly sourceData: Readonly<ShallowRef<readonly T[]>>;
	/** The current working set (equals `sourceData` unless a working-set substitution is active). */
	readonly workingSet: Readonly<ShallowRef<readonly T[]>>;
	/**
	 * A ref for a single rule by id (memoized by the engine's own per-rule signal cache). Call in
	 * `setup()` so the subscription is torn down with the component.
	 */
	rule(ruleId: RuleId): Readonly<ShallowRef<FilterRule | undefined>>;
}

/**
 * Build the {@link EngineRefs} bag for an engine.
 *
 * @typeParam T - The item type the engine operates over.
 * @param engine - The engine to wrap. Defaults to the one provided via `provideFilterEngine` (inject) —
 *   so a component deep in the tree can call `useEngineRefs()` with no argument.
 * @returns A bag of read-only Vue refs mirroring the engine's reactive state.
 */
export function useEngineRefs<T>(engine: SignalsEngine<T> = useFilterEngine<T>()): EngineRefs<T> {
	const lastChangeRuleId = useSignal(engine.lastChangeRuleId);
	const lastChangeTimestamp = useSignal(engine.lastChangeTimestamp);
	const lastChangeEvent = useSignal(engine.lastChangeEvent);

	return {
		activeRuleIds: useSignal(engine.activeRuleIds),
		activeRules: useSignal(engine.activeRules),
		expression: useSignal(engine.expression),
		lastChange: computed<LastChange>(() => ({
			event: lastChangeEvent.value,
			ruleId: lastChangeRuleId.value,
			timestamp: lastChangeTimestamp.value,
		})),
		mode: useSignal(engine.mode),
		resultCount: useSignal(engine.resultCount),
		results: useSignal(engine.results),
		rule: (ruleId: RuleId) => useSignal(engine.rule(ruleId)),
		sourceData: useSignal(engine.sourceData),
		workingSet: useSignal(engine.workingSet),
	};
}
