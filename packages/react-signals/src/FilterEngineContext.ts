/**
 * `FilterEngineContext` — the React context that carries a `SignalsEngine` instance down the
 * component tree to be consumed by the `use*` hooks.
 *
 * @remarks
 * Per `docs/architecture.md` §12.1. Lives in its own file (not bundled with the Provider
 * component) so consumer-side custom hooks can `useContext(FilterEngineContext)` directly
 * without pulling the Provider implementation into bundles that don't need it (e.g., a hook
 * file in a separately-built micro-frontend module).
 *
 * **Browser-only.** Per the `@filter-enginez` package boundary rules, the
 * `react-*` packages are NOT subject to the isomorphic constraint — React itself isn't
 * isomorphic at the API surface, and the hooks here rely on `useSyncExternalStore` /
 * `createContext` from `react`.
 *
 * @packageDocumentation
 */

import type { SignalsEngine } from '@filter-enginez/reactive-signals';

import { createContext } from 'react';

// #region docs:filter-engine-context
/**
 * React context carrying a `SignalsEngine<unknown>` instance.
 *
 * @remarks
 * Typed as `SignalsEngine<unknown> | null` (rather than a generic) because React contexts
 * cannot be generic. The `use*` hooks downcast to the consumer's expected `SignalsEngine<T>`
 * via the hook's own type parameter — TypeScript users carry the `T` through their hook calls
 * (`useResults<Wine>()`) without the context having to know about it.
 *
 * Default value `null` — hooks throw a clear error if called outside a Provider.
 */
export const FilterEngineContext = createContext<SignalsEngine<unknown> | null>(null);
// #endregion docs:filter-engine-context
