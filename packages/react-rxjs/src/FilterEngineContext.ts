/**
 * `FilterEngineContext` — the React context that carries an `RxJsEngine` instance down the
 * component tree to be consumed by the `use*` hooks.
 *
 * @remarks
 * Per `docs/architecture.md` §12.2. Mirror of the `react-signals` context but typed against
 * `RxJsEngine` instead of `SignalsEngine`. Two contexts (one per adapter package) — consumers
 * import from whichever adapter they're wiring; the two never need to coexist in one
 * component tree.
 *
 * **Browser-only.** The `react-*` packages depend on `react`'s `createContext` /
 * `useSyncExternalStore` and so are not isomorphic.
 *
 * @packageDocumentation
 */

import type { RxJsEngine } from '@filter-enginez/reactive-rxjs';

import { createContext } from 'react';

/**
 * React context carrying an `RxJsEngine<unknown>` instance.
 *
 * @remarks
 * Typed as `RxJsEngine<unknown> | null` because React contexts cannot be generic. The `use*`
 * hooks downcast to the consumer's expected `RxJsEngine<T>` via the hook's own type parameter.
 *
 * Default value `null` — hooks throw a clear error if called outside a Provider.
 */
export const FilterEngineContext = createContext<RxJsEngine<unknown> | null>(null);
