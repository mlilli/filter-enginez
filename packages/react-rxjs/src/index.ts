/**
 * @filter-enginez/react-rxjs
 *
 * React hooks over `@filter-enginez/reactive-rxjs`. Uses `useSyncExternalStore` for concurrent-
 * mode-safe consumption of RxJS Observable state.
 *
 * @remarks
 * The surface: `FilterEngineProvider` + `FilterEngineContext`, the same hook set as
 * `@filter-enginez/react-signals` (`useFilterEngine`, `useResults`, `useResultCount`,
 * `useActiveRules`, `useRule`, `useExpression`, `useMode`, `useLastChange`, `useEngineBusy`,
 * `useSimulation`, `useUndoRedo`, `useExclusion`, `useSuggestedFilters`, `useSimilar`), plus
 * `useObservable` / `observableToStoreTuple` for writing custom hooks over other engine streams.
 *
 * **Hook-name convention.** The hooks return UNWRAPPED values (subscribed via `useObservable`)
 * rather than raw Observables — the React idiom is `const x = useFoo()` with `x` already at its
 * current value. Consumers needing the raw Observable for composition can pull it from
 * `engine.results$` etc. via `useFilterEngine()`.
 *
 * Browser-only keyboard handlers live in the `./keyboard` sub-export.
 *
 * See `docs/architecture.md` §12.2.
 *
 * @packageDocumentation
 */

// Context + Provider
export { FilterEngineContext } from './FilterEngineContext.js';
export { FilterEngineProvider, type FilterEngineProviderProps } from './FilterEngineProvider.js';

// Hooks barrel
export * from './hooks/index.js';
