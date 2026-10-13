/**
 * `toStore` — the one primitive that bridges a Filter EngineZ reactive signal to a Svelte store.
 *
 * @remarks
 * The engine's reactive primitive (`@preact/signals-core`'s `ReadonlySignal`) exposes
 * `subscribe(onChange) => unsubscribe` and calls `onChange` **synchronously on subscribe and on every
 * change** — which is exactly Svelte's `Readable<V>` contract. So this bridge is essentially a typed
 * pass-through: it exists for a single import site, precise typing, and one place to adapt should the
 * signal contract ever diverge from Svelte's. It is the Svelte counterpart to `react-signals`' `useSignal`
 * (which needs a whole `useSyncExternalStore` adapter because React has no native store contract).
 *
 * The signal is accepted as a **structural** `ReadonlySignalLike<V>` rather than importing
 * `@preact/signals-core` directly, mirroring `react-signals`' approach — it keeps this package's
 * dependency graph to `core` + `reactive-signals` and off the concrete signals implementation.
 *
 * @packageDocumentation
 */

import type { Readable } from 'svelte/store';

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
 * Wrap a Filter EngineZ signal as a Svelte `Readable<V>` — consume it in a component with `$`.
 *
 * @typeParam V - The signal's value type.
 * @param signal - Any engine `ReadonlySignal` (e.g. `engine.results`, `engine.resultCount`).
 * @returns A Svelte `Readable<V>` mirroring the signal.
 *
 * @example
 *   const results = toStore(engine.results);
 *   // in markup: {#each $results as item (item.id)} … {/each}
 */
export function toStore<V>(signal: ReadonlySignalLike<V>): Readable<V> {
	return { subscribe: (run) => signal.subscribe(run) };
}
