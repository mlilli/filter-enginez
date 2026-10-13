/**
 * `createEngineStores` — the ergonomic bag of Svelte `Readable`s over a `SignalsEngine<T>`.
 *
 * @remarks
 * Svelte has no hooks/re-run model, so instead of `react-signals`' one-`use*`-hook-per-signal, the
 * idiom is a factory called ONCE per component that returns a bag of stores you consume with `$`. Each
 * field is just `toStore(engine.<signal>)`; `lastChange` is a `derived` composition of the three
 * last-change signals (matching `react-signals`' `useLastChange` shape). Writes are NOT here — they go
 * straight through `engine.core.addRule(...)` etc., exactly as in React.
 *
 * @packageDocumentation
 */

import type { ChangeEvent, CompositeRule, FilterRule, RuleId } from '@filter-enginez/core';
import type { SignalsEngine } from '@filter-enginez/reactive-signals';

import { derived, type Readable } from 'svelte/store';

import { getFilterEngine } from './context.js';
import { toStore } from './toStore.js';

/**
 * The composed last-change value — mirrors `react-signals`' `useLastChange` return shape so shared
 * app logic reads the same fields across frameworks.
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
 * The bag of engine-state stores. Every field is a Svelte `Readable` consumed with `$`.
 *
 * @typeParam T - The item type the engine operates over.
 */
export interface EngineStores<T> {
	/** Active rule ids, in insertion order. */
	readonly activeRuleIds: Readable<readonly RuleId[]>;
	/** The active rule instances, keyed by id. */
	readonly activeRules: Readable<ReadonlyMap<RuleId, FilterRule>>;
	/** The current boolean expression (expression mode), or `null` in flat-map mode. */
	readonly expression: Readable<CompositeRule | null>;
	/** The composed last-change signal (rule id + timestamp + event). */
	readonly lastChange: Readable<LastChange>;
	/** The engine's composition mode. */
	readonly mode: Readable<'expression' | 'flat-map'>;
	/** The current result count. */
	readonly resultCount: Readable<number>;
	/** The current filtered results. */
	readonly results: Readable<readonly T[]>;
	/** The full source corpus. */
	readonly sourceData: Readable<readonly T[]>;
	/** The current working set (equals `sourceData` unless a working-set substitution is active). */
	readonly workingSet: Readable<readonly T[]>;
	/**
	 * A store for a single rule by id (memoized by the engine's own per-rule signal cache, so repeated
	 * calls with the same id return equivalent stores over one underlying signal).
	 */
	rule(ruleId: RuleId): Readable<FilterRule | undefined>;
}

/**
 * Build the {@link EngineStores} bag for an engine.
 *
 * @typeParam T - The item type the engine operates over.
 * @param engine - The engine to wrap. Defaults to the one provided via `setFilterEngine` (context) —
 *   so a component deep in the tree can call `createEngineStores()` with no argument.
 * @returns A bag of Svelte `Readable`s mirroring the engine's reactive state.
 */
export function createEngineStores<T>(engine: SignalsEngine<T> = getFilterEngine<T>()): EngineStores<T> {
	return {
		activeRuleIds: toStore(engine.activeRuleIds),
		activeRules: toStore(engine.activeRules),
		expression: toStore(engine.expression),
		lastChange: derived(
			[toStore(engine.lastChangeRuleId), toStore(engine.lastChangeTimestamp), toStore(engine.lastChangeEvent)],
			([ruleId, timestamp, event]): LastChange => ({ event, ruleId, timestamp }),
		),
		mode: toStore(engine.mode),
		resultCount: toStore(engine.resultCount),
		results: toStore(engine.results),
		rule: (ruleId: RuleId) => toStore(engine.rule(ruleId)),
		sourceData: toStore(engine.sourceData),
		workingSet: toStore(engine.workingSet),
	};
}
