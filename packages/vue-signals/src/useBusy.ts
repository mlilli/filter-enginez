/**
 * `useBusy` — a read-only Vue ref over an `EngineBusyTracker`'s busy state.
 *
 * @remarks
 * The framework-neutral `createEngineBusyTracker()` (from `reactive-signals`) already exposes its busy
 * state as a `ReadonlySignal<boolean>` (`tracker.isBusy`), so this is just {@link useSignal} over it —
 * the Vue counterpart to `svelte-signals`' `busyStore` / `react-signals`' `useEngineBusy`. The WRITE
 * side of the tracker (`markUserAction` / `markResolvedAtLeast`) stays a set of direct calls in the
 * app's commit + fetch handlers, identical across frameworks.
 *
 * @packageDocumentation
 */

import type { EngineBusyTracker } from '@filter-enginez/reactive-signals';

import type { ShallowRef } from 'vue';

import { useSignal } from './useSignal.js';

/**
 * Adapt an engine-busy tracker's `isBusy` signal into a read-only Vue ref. Call in `setup()`.
 *
 * @param tracker - The busy tracker to observe.
 * @returns A read-only `ShallowRef<boolean>` that is `true` while a user action is unreflected.
 */
export function useBusy(tracker: EngineBusyTracker): Readonly<ShallowRef<boolean>> {
	return useSignal(tracker.isBusy);
}
