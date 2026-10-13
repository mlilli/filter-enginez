/**
 * `@filter-enginez/vue-signals` — Vue 3 reactivity bindings over `@filter-enginez/reactive-signals`.
 *
 * @remarks
 * The Vue counterpart to `@filter-enginez/react-signals` / `@filter-enginez/svelte-signals`. Vue has no
 * native external-store contract, so the bridge is a small composable ({@link useSignal}) that adapts a
 * signal into a `shallowRef` + tears the subscription down with the component. On top of it: the
 * provide/inject engine context ({@link provideFilterEngine} / {@link useFilterEngine}), an ergonomic
 * refs bag ({@link useEngineRefs}), and a busy-state ref ({@link useBusy}). Writes go directly through
 * `engine.core` — no adapter needed. Browser-only.
 *
 * **The load-bearing gotcha:** hold the engine (and any signal value) in `shallowRef` / `markRaw`,
 * never a plain `ref`/`reactive` — a deep reactive proxy breaks the engine's `@preact/signals-core`
 * signals. See {@link useSignal}'s notes (the Vue equivalent of Svelte's `$state.raw` rule).
 *
 * @packageDocumentation
 */

export { provideFilterEngine, useFilterEngine } from './context.js';
export { type EngineRefs, type LastChange, useEngineRefs } from './engineRefs.js';
export { useBusy } from './useBusy.js';
export { type ReadonlySignalLike, useSignal } from './useSignal.js';
