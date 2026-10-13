/**
 * `useLastChange` — subscribe to the engine's last-mutation tracking signals.
 *
 * @packageDocumentation
 */

import type { ChangeEvent, RuleId } from '@filter-enginez/core';

import { useMemo } from 'react';

import { useFilterEngine } from './useFilterEngine.js';
import { useSignal } from './useSignal.js';

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
 * Subscribe to the engine's last-change tracking — useful for animations, toasts, or "recent
 * activity" affordances that highlight the most recently-modified filter.
 *
 * @returns A `LastChange` snapshot of the most recent mutation
 *
 * @example
 *   function RecentChangeFlash() {
 *     const { ruleId, timestamp } = useLastChange();
 *     // ...flash the chip for `ruleId` when `timestamp` updates
 *   }
 */
export function useLastChange(): LastChange {
	const engine = useFilterEngine();
	const ruleId = useSignal(engine.lastChangeRuleId);
	const timestamp = useSignal(engine.lastChangeTimestamp);
	const event = useSignal(engine.lastChangeEvent);

	// **Memoize so the returned object is stable across renders unless one of the underlying
	// values actually changed.** Without this, every call returns a fresh object literal,
	// and any consumer using the return in a `useMemo` deps array invalidates on EVERY
	// parent re-render — not just on real engine events. For a filter panel with slider bounds
	// + histograms over a large corpus, that means 8 × 130k-record iterations re-firing on every
	// unrelated render. Memoizing here is the lowest-cost / highest-impact way to prevent it.
	return useMemo<LastChange>(
		() => ({ event, ruleId, timestamp }),
		[ruleId, timestamp, event],
	);
}
