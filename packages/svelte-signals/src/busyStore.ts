/**
 * `busyStore` — a Svelte `Readable<boolean>` over an `EngineBusyTracker`'s busy state.
 *
 * @remarks
 * The framework-neutral `createEngineBusyTracker()` (from `reactive-signals`) already exposes its busy
 * state as a `ReadonlySignal<boolean>` (`tracker.isBusy`), so this is just {@link toStore} over it —
 * the Svelte counterpart to `react-signals`' `useEngineBusy`. The WRITE side of the tracker
 * (`markUserAction` / `markResolvedAtLeast`) stays a set of direct calls in the app's commit + fetch
 * handlers, identical across frameworks.
 *
 * @packageDocumentation
 */

import type { EngineBusyTracker } from '@filter-enginez/reactive-signals';
import type { Readable } from 'svelte/store';

import { toStore } from './toStore.js';

/**
 * Wrap an engine-busy tracker's `isBusy` signal as a Svelte `Readable<boolean>`.
 *
 * @param tracker - The busy tracker to observe.
 * @returns A Svelte `Readable<boolean>` that is `true` while a user action is unreflected.
 */
export function busyStore(tracker: EngineBusyTracker): Readable<boolean> {
	return toStore(tracker.isBusy);
}
