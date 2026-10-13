/**
 * `useEngineBusy` — React binding for an {@link EngineBusyTracker}.
 *
 * @remarks
 * The thinnest possible wrapper: a `useSyncExternalStore` over the tracker's `subscribe` /
 * `getIsBusy` pair, so React's concurrent renderer sees a consistent busy snapshot. All the
 * actual logic (version-comparison, the signal mirror) lives framework-neutral in
 * `@filter-enginez/reactive-signals`; this is just the React surface.
 *
 * @packageDocumentation
 */

import type { EngineBusyTracker } from '@filter-enginez/reactive-signals';

import { useSyncExternalStore } from 'react';

/**
 * Subscribe to an engine-busy tracker's state.
 *
 * @param tracker - The tracker to read (create once per engine/app via `createEngineBusyTracker`).
 * @returns `true` while a user action is pending an as-yet-unresolved derived fetch.
 *
 * @example
 *   const isComputing = useEngineBusy(busyTracker);
 *   return <div style={{ opacity: isComputing ? 0.55 : 1 }}>...</div>;
 */
export function useEngineBusy(tracker: EngineBusyTracker): boolean {
	// Wrap each tracker method in an arrow so it's invoked with the tracker as the receiver.
	// The implementations close over factory-local state (no `this` use), but the explicit
	// binding keeps the call site honest and satisfies `@typescript-eslint/unbound-method`.
	const subscribe = (listener: () => void): (() => void) => tracker.subscribe(listener);
	const getIsBusy = (): boolean => tracker.getIsBusy();

	return useSyncExternalStore(subscribe, getIsBusy, getIsBusy);
}
