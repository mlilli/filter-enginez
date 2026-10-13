/**
 * `@filter-enginez/svelte-signals` — Svelte store bindings over `@filter-enginez/reactive-signals`.
 *
 * @remarks
 * The Svelte counterpart to `@filter-enginez/react-signals`. Because a Filter EngineZ signal already
 * satisfies Svelte's `Readable` store contract, this binding is a fraction of the React one: a typed
 * pass-through ({@link toStore}), the Svelte context glue ({@link setFilterEngine} / {@link getFilterEngine}),
 * an ergonomic store bag ({@link createEngineStores}), and a busy-state store ({@link busyStore}).
 * Writes go directly through `engine.core` — no adapter needed. Browser-only.
 *
 * @packageDocumentation
 */

export { busyStore } from './busyStore.js';
export { getFilterEngine, setFilterEngine } from './context.js';
export { createEngineStores, type EngineStores, type LastChange } from './engineStores.js';
export { type ReadonlySignalLike, toStore } from './toStore.js';
