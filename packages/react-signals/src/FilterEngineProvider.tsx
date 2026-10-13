/**
 * `FilterEngineProvider` — the React component that puts a `SignalsEngine` into context for
 * descendant `use*` hooks to consume.
 *
 * @remarks
 * Per `docs/architecture.md` §12.1. The Provider is a thin wrapper around the
 * `FilterEngineContext` provider (rendered as `<FilterEngineContext>`, React 19's form) — no
 * extra state, no lifecycle ownership of the engine. The caller constructs the engine (via
 * `createSignalsEngine(createFilterEngine({ ... }))`), passes it in, and is responsible for
 * `engine.dispose()` / `core.destroy()` when the engine leaves scope.
 *
 * **Why no internal engine creation.** The naive design — `<FilterEngineProvider sourceData={data}>`
 * — would tie the engine lifecycle to the component tree, making it impossible to share one
 * engine across multiple Providers (mobile drawer + desktop sidebar both showing the same
 * filter state) or to construct the engine in a place that has data the React tree doesn't
 * (e.g., a server component handoff). External construction keeps both ergonomic.
 *
 * @packageDocumentation
 */

import type { SignalsEngine } from '@filter-enginez/reactive-signals';
import type { ReactNode } from 'react';

import { FilterEngineContext } from './FilterEngineContext.js';

/**
 * Props for `FilterEngineProvider`.
 */
export interface FilterEngineProviderProps<T> {
	/** The engine instance to provide to descendant hooks. */
	readonly engine: SignalsEngine<T>;
	/** Component subtree. */
	readonly children: ReactNode;
}

/**
 * Provides a `SignalsEngine` to descendant components via React context.
 *
 * @example
 *   const core = createFilterEngine<Wine>({ sourceData: wines });
 *   const engine = createSignalsEngine(core);
 *
 *   return (
 *     <FilterEngineProvider engine={engine}>
 *       <FilterPanel />
 *       <ResultsGrid />
 *     </FilterEngineProvider>
 *   );
 */
export const FilterEngineProvider = <T = unknown>({
	children,
	engine,
}: FilterEngineProviderProps<T>): ReactNode => {
	// Cast through unknown because React contexts cannot be generic — the per-hook downcast
	// (in `useFilterEngine<T>()`) recovers the concrete `T` for consumers.
	const erased = engine as unknown as SignalsEngine<unknown>;

	return (
		<FilterEngineContext value={erased}>{children}</FilterEngineContext>
	);
};
