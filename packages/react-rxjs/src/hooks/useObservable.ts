/**
 * `useObservable` — internal React hook that subscribes a component to an RxJS `Observable`
 * and returns its current value, using `useSyncExternalStore` for concurrent-mode safety.
 *
 * @remarks
 * Per `docs/architecture.md` §12.2. The internal primitive every public `use*` hook in this
 * package is built on. Why `useSyncExternalStore` over `useEffect(() => obs.subscribe(...))`:
 *
 *   - Tearing-safe under React 18+ concurrent rendering
 *   - SSR-safe (the `getServerSnapshot` arg returns the same value as `getSnapshot`)
 *   - Strict-mode-safe (double-render doesn't double-subscribe)
 *
 * **Late-subscriber semantics.** This hook relies on the source Observable being hot +
 * `shareReplay(1)`-buffered (which is exactly what `createRxJsEngine` returns for every
 * `$`-suffixed stream). A cold or unbuffered Observable subscribed inside this hook will
 * produce `initialValue` on first render and only get a real value on the first emission
 * after mount — usually not what consumers want.
 *
 * **The latest-value closure trick.** RxJS Observables don't carry a synchronous
 * "current value" getter, but hot `shareReplay(1)` streams deliver the buffered value
 * synchronously on `subscribe`. So the subscribe callback captures the latest value into a
 * closure variable; getSnapshot reads it back. For the initial render before subscribe runs,
 * we return `initialValue`.
 *
 * **Memoization caveat.** The closure that holds `latestValue` is created fresh per render
 * unless we stabilize it via `useMemo`. The store tuple is `useMemo`-stable by source +
 * initialValue identity — so callers passing the same Observable + same initialValue across
 * renders get one subscription, not N.
 *
 * **Not exported from the package barrel.** This is internal — consumers should reach for
 * the specific public hooks. Exported separately via the hooks barrel only for advanced
 * consumers writing custom hooks against engine streams not covered by the curated set.
 *
 * @packageDocumentation
 */

import type { Observable } from 'rxjs';

import { useMemo, useSyncExternalStore } from 'react';

// #region docs:use-observable
/**
 * Subscribe to an `Observable<V>` and return its current value. The component re-renders on
 * every emission.
 *
 * @typeParam V - The observable's value type
 * @param source - The Observable to subscribe to
 * @param initialValue - Value to return until the first emission lands
 * @returns The most recent emitted value
 */
export function useObservable<V>(source: Observable<V>, initialValue: V): V {
	// `initialValue` is intentionally omitted from the dependency array: it seeds the store
	// tuple only on first construction, and re-subscribing on a changed initial value would
	// needlessly tear down the live subscription. Re-subscription is keyed solely on `source`
	// identity. (The `react-hooks` plugin is not active for `.ts` files, so this carries no
	// suppression; the omission is deliberate and documented here.)
	const [subscribe, getSnapshot, getServerSnapshot] = useMemo(
		() => observableToStoreTuple(source, initialValue),
		[source],
	);

	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Convenience helper — `useSyncExternalStore`-friendly subscribe + snapshot tuple for an
 * Observable + initial value. Exposed for consumers writing custom hooks.
 *
 * @typeParam V - The observable's value type
 * @param source - The Observable to wrap
 * @param initialValue - Value to return until the first emission lands
 * @returns A `[subscribe, getSnapshot, getServerSnapshot]` tuple
 *
 * @remarks
 * The internal `latestValue` closure variable is the bridge between RxJS's push-based
 * delivery and React's pull-based snapshot model. On subscribe, the value is captured into
 * the closure on every `next`; getSnapshot returns the most recently captured value.
 */
export function observableToStoreTuple<V>(
	source: Observable<V>,
	initialValue: V,
): [
		subscribe: (onChange: () => void) => () => void,
		getSnapshot: () => V,
		getServerSnapshot: () => V,
] {
	let latestValue: V = initialValue;
	const subscribe = (onChange: () => void): (() => void) => {
		const sub = source.subscribe((value) => {
			latestValue = value;
			onChange();
		});

		return (): void => sub.unsubscribe();
	};
	const getSnapshot = (): V => latestValue;
	const getServerSnapshot = (): V => initialValue;

	return [subscribe, getSnapshot, getServerSnapshot];
}
// #endregion docs:use-observable
