/**
 * `FilterEngineProvider` — the React component that puts an `RxJsEngine` into context for
 * descendant `use*` hooks to consume.
 *
 * @remarks
 * Per `docs/architecture.md` §12.2. Same external-construction convention as the signals
 * adapter — the caller builds the engine via `createRxJsEngine(createFilterEngine({ ... }))`
 * and is responsible for `engine.dispose()` / `core.destroy()` when it leaves scope.
 *
 * @packageDocumentation
 */

import type { RxJsEngine } from '@filter-enginez/reactive-rxjs';
import type { ReactNode } from 'react';

import { FilterEngineContext } from './FilterEngineContext.js';

/**
 * Props for `FilterEngineProvider`.
 */
export interface FilterEngineProviderProps<T> {
	/** The engine instance to provide to descendant hooks. */
	readonly engine: RxJsEngine<T>;
	/** Component subtree. */
	readonly children: ReactNode;
}

/**
 * Provides an `RxJsEngine` to descendant components via React context.
 *
 * @example
 *   const core = createFilterEngine<Wine>({ sourceData: wines });
 *   const engine = createRxJsEngine(core);
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
	const erased = engine as unknown as RxJsEngine<unknown>;

	return (
		<FilterEngineContext value={erased}>{children}</FilterEngineContext>
	);
};
