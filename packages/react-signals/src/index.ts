/**
 * @filter-enginez/react-signals
 *
 * React hooks over `@filter-enginez/reactive-signals`. Uses `useSyncExternalStore` for
 * concurrent-mode-safe consumption of signal state.
 *
 * @remarks
 * Exports `FilterEngineProvider` + context and the hook surface: state subscriptions via
 * `useSyncExternalStore`, simulation / exclusion / suggestion / similarity hooks, and undo/redo.
 *
 * Browser-only keyboard handlers live in the `./keyboard` sub-export — pull them in
 * separately to keep DOM-dependent code out of SSR / test bundles by default.
 *
 * See `docs/architecture.md` §12.1.
 *
 * @packageDocumentation
 */

// Context + Provider
export { FilterEngineContext } from './FilterEngineContext.js';
export { FilterEngineProvider, type FilterEngineProviderProps } from './FilterEngineProvider.js';

// Hooks barrel
export * from './hooks/index.js';
