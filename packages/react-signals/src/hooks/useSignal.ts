/**
 * `useSignal` — internal React hook that subscribes a component to a `@preact/signals-core`
 * `ReadonlySignal` and returns its current value, using `useSyncExternalStore` for concurrent-
 * mode safety.
 *
 * @remarks
 * Per `docs/architecture.md` §12.1. The internal primitive every public `use*` hook in this
 * package is built on. Why `useSyncExternalStore` instead of `signal.subscribe(setState)`:
 *
 *   - Tearing-safe under React 18+ concurrent rendering (signal mutations during a render
 *     pass don't produce inconsistent reads across components in the same commit)
 *   - SSR-safe (the `getServerSnapshot` argument returns the same value as `getSnapshot`)
 *   - Strict-mode-safe (double-render in dev doesn't double-subscribe)
 *
 * **Not exported from the package barrel.** This is internal — consumers should reach for
 * the specific public hooks (`useResults`, `useResultCount`, etc.) rather than
 * `useSignal(someSignal)` directly. The package's React surface is the curated hooks, not
 * the underlying signal access primitive. `signalToStoreTuple` IS exported (via the hooks
 * barrel) as the escape hatch for advanced consumers writing custom hooks against signals
 * not covered by the curated set.
 *
 * @packageDocumentation
 */

import { useMemo, useSyncExternalStore } from 'react';

/**
 * Structural shape of a `@preact/signals-core` `ReadonlySignal<V>`. Defined locally rather
 * than imported so this package doesn't have to declare a direct dependency on
 * `@preact/signals-core` (it reaches it transitively through
 * `@filter-enginez/reactive-signals`, and via `@preact/signals-react` for the React
 * integration). Keeps the import graph tidy.
 *
 * @internal
 */
interface ReadonlySignalShape<V> {
	subscribe(onChange: (value: V) => void): () => void;
	readonly value: V;
}

// #region docs:use-signal
/**
 * Subscribe to a `ReadonlySignal` and return its current value.
 *
 * @typeParam V - The signal's value type
 * @param signal - The signal to subscribe to
 * @returns The signal's current value (auto-updated on signal mutation)
 */
export function useSignal<V>(signal: ReadonlySignalShape<V>): V {
	// Memoize the tuple by signal-identity so React's `useSyncExternalStore` sees stable
	// references across re-renders (avoids re-subscribing on every render).
	const [subscribe, getSnapshot, getServerSnapshot] = useMemo(
		() => signalToStoreTuple(signal),
		[signal],
	);

	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Convenience helper paired with `useSignal` — `useSyncExternalStore`-friendly subscribe
 * + snapshot tuple for a signal. Exposed for consumers writing custom hooks against signals
 * not covered by the curated `use*` hook set.
 *
 * @typeParam V - The signal's value type
 * @param signal - The signal to wrap
 * @returns A `[subscribe, getSnapshot, getServerSnapshot]` tuple
 *
 * @remarks
 * The `subscribe` callback adapts the signal's `onChange(value)` callback shape to React's
 * argumentless `onChange()` callback shape — React just wants to know "something changed,"
 * not what the new value is.
 */
export function signalToStoreTuple<V>(
	signal: ReadonlySignalShape<V>,
): [
		subscribe: (onChange: () => void) => () => void,
		getSnapshot: () => V,
		getServerSnapshot: () => V,
] {
	const subscribe = (onChange: () => void): (() => void) => signal.subscribe(() => onChange());
	const getSnapshot = (): V => signal.value;
	const getServerSnapshot = (): V => signal.value;

	return [subscribe, getSnapshot, getServerSnapshot];
}
// #endregion docs:use-signal
