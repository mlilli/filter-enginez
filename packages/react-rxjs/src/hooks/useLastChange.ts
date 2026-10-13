/**
 * `useLastChange` — subscribe to the engine's last-mutation tracking streams.
 *
 * @packageDocumentation
 */

import type { ChangeEvent, RuleId } from '@filter-enginez/core';

import { useMemo } from 'react';

import { useFilterEngine } from './useFilterEngine.js';
import { useObservable } from './useObservable.js';

/**
 * Information about the most recent change the engine emitted.
 */
export interface LastChange {
	/** The id of the rule most recently mutated. `null` until the first rule mutation. */
	readonly ruleId: RuleId | null;
	/** Timestamp of the most recent rule mutation. `null` until the first rule mutation. */
	readonly timestamp: number | null;
	/** The most recent change event. `null` until the first event fires. */
	readonly event: ChangeEvent | null;
}

/**
 * Subscribe to the engine's last-change tracking — useful for animations, toasts, or
 * "recent activity" affordances.
 *
 * @returns A `LastChange` snapshot of the most recent mutation
 */
export function useLastChange(): LastChange {
	const engine = useFilterEngine();
	const ruleId = useObservable<RuleId | null>(engine.lastChangeRuleId$, null);
	const timestamp = useObservable<number | null>(engine.lastChangeTimestamp$, null);
	const event = useObservable<ChangeEvent | null>(engine.lastChangeEvent$, null);

	// Memoize so the returned object is stable across renders unless one of the underlying
	// values actually changed. See the sibling react-signals/useLastChange for the full
	// perf-fix rationale.
	return useMemo<LastChange>(
		() => ({ event, ruleId, timestamp }),
		[ruleId, timestamp, event],
	);
}
