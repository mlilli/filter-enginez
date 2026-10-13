/**
 * `useSignal` — the one primitive that bridges a Filter EngineZ reactive signal to a Vue 3 ref.
 *
 * @remarks
 * The engine's reactive primitive (`@preact/signals-core`'s `ReadonlySignal`) exposes
 * `subscribe(onChange) => unsubscribe` and calls `onChange` **synchronously on subscribe and on every
 * change**. Vue has no native "external store" contract like Svelte's `Readable`, so — like
 * `react-signals`' `useSignal` — this composable adapts the signal into Vue's reactivity: it seeds a
 * `shallowRef` with the current value, pushes every change into `ref.value`, and unsubscribes when the
 * surrounding effect scope (the component) is disposed.
 *
 * **`shallowRef`, deliberately — NOT `ref`.** A plain `ref`/`reactive` would DEEP-PROXY the value
 * (results arrays, rule instances, the change event), which both wastes work and — critically — would
 * wrap the engine's own objects in a Vue proxy. `shallowRef` tracks only `.value` reassignment (exactly
 * what a signal change is) and passes the value through untouched. This is the same reason the engine
 * itself must be held in `shallowRef`/`markRaw` at the boot site, never `ref` (the Vue counterpart to
 * Svelte's `$state.raw` rule — a plain reactive proxy breaks the engine's `.subscribe`/`.value` +
 * method `this`).
 *
 * The signal is accepted as a **structural** `ReadonlySignalLike<V>` rather than importing
 * `@preact/signals-core` directly (mirroring `svelte-signals` / `react-signals`) — keeping this
 * package's dependency graph to `core` + `reactive-signals` + the Vue peer.
 *
 * @packageDocumentation
 */

import { onScopeDispose, type ShallowRef, shallowRef } from 'vue';

/**
 * The structural shape of a Filter EngineZ reactive signal (a `@preact/signals-core` `ReadonlySignal`,
 * matched structurally). Every reactive field on a `SignalsEngine<T>` satisfies this.
 *
 * @typeParam V - The signal's value type.
 */
export interface ReadonlySignalLike<V> {
	/** Subscribe to changes; the callback fires synchronously on subscribe + on every mutation. */
	subscribe(onChange: (value: V) => void): () => void;
	/** The current value (a synchronous read). */
	readonly value: V;
}

/**
 * Adapt a Filter EngineZ signal into a read-only Vue `shallowRef`. Call inside `setup()` (or a
 * composable) so the subscription is torn down with the component via `onScopeDispose`.
 *
 * @typeParam V - The signal's value type.
 * @param signal - Any engine `ReadonlySignal` (e.g. `engine.results`, `engine.resultCount`).
 * @returns A read-only `ShallowRef<V>` mirroring the signal — read `.value` in templates / computed.
 *
 * @example
 *   const results = useSignal(engine.results);
 *   // in template: <li v-for="item in results.value" :key="item.id">…</li>
 */
export function useSignal<V>(signal: ReadonlySignalLike<V>): Readonly<ShallowRef<V>> {
	const state = shallowRef(signal.value) as ShallowRef<V>;
	// `subscribe` fires immediately with the current value (a no-op reseed) and on every change.
	const unsubscribe = signal.subscribe((value) => {
		state.value = value;
	});

	onScopeDispose(unsubscribe);

	return state;
}
