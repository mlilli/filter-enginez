/**
 * `useEngineBusy` — React binding for an {@link EngineBusyStream}, the RxJS counterpart of
 * `react-signals`' `useEngineBusy`.
 *
 * @remarks
 * Reads the stream's replaying `isBusy$` through {@link useObservable}, seeded with the
 * tracker's current `getIsBusy()` so the first render already shows the real state. All the
 * logic (version comparison) lives framework-neutral in `@filter-enginez/reactive-rxjs`; this is
 * the React surface only, so both React bindings expose the same hook set.
 *
 * @packageDocumentation
 */

import type { EngineBusyStream } from '@filter-enginez/reactive-rxjs';

import { useObservable } from './useObservable.js';

/**
 * Subscribe to an engine-busy stream's state.
 *
 * @param busy - The stream to read (create once per engine/app via `createEngineBusyStream`).
 * @returns `true` while a user action is pending an as-yet-unresolved derived fetch.
 *
 * @example
 *   const isComputing = useEngineBusy(busyStream);
 *   return <div style={{ opacity: isComputing ? 0.55 : 1 }}>...</div>;
 */
export function useEngineBusy(busy: EngineBusyStream): boolean {
	return useObservable(busy.isBusy$, busy.getIsBusy());
}
