/**
 * `useFilterEngine` — pull the `RxJsEngine` instance out of `FilterEngineContext`. The escape
 * hatch for hooks/components that need direct engine access (mutation via `engine.core.*`,
 * custom stream composition, the raw events$ stream).
 *
 * @packageDocumentation
 */

import type { RxJsEngine } from '@filter-enginez/reactive-rxjs';

import { FilterEngineConfigError } from '@filter-enginez/core';
import { useContext } from 'react';

import { FilterEngineContext } from '../FilterEngineContext.js';

/**
 * Retrieve the current `RxJsEngine` from React context. Throws `FilterEngineConfigError`
 * (`BINDING_ENGINE_NOT_PROVIDED`) if called outside a `<FilterEngineProvider>`.
 *
 * @typeParam T - The item type the engine operates over (consumer-asserted)
 * @returns The engine instance
 *
 * @example
 *   function ClearFiltersButton() {
 *     const engine = useFilterEngine<Wine>();
 *     return <button onClick={() => engine.core.clearRules()}>Clear all</button>;
 *   }
 */
export function useFilterEngine<T = unknown>(): RxJsEngine<T> {
	const engine = useContext(FilterEngineContext);

	if (engine === null) {
		throw new FilterEngineConfigError(
			'BINDING_ENGINE_NOT_PROVIDED',
			'useFilterEngine called outside a <FilterEngineProvider>. Wrap your component tree in ' +
			'<FilterEngineProvider engine={rxJsEngine}>...</FilterEngineProvider>.',
		);
	}

	return engine as unknown as RxJsEngine<T>;
}
