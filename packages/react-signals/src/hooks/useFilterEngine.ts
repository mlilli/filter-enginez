/**
 * `useFilterEngine` — pull the `SignalsEngine` instance out of `FilterEngineContext`. The
 * escape hatch for hooks/components that need direct engine access (mutation methods, raw
 * `core` reference, custom signal subscriptions).
 *
 * @packageDocumentation
 */

import type { SignalsEngine } from '@filter-enginez/reactive-signals';

import { FilterEngineConfigError } from '@filter-enginez/core';
import { useContext } from 'react';

import { FilterEngineContext } from '../FilterEngineContext.js';

/**
 * Retrieve the current `SignalsEngine` from React context. Throws `FilterEngineConfigError`
 * (`BINDING_ENGINE_NOT_PROVIDED`) if called outside a `<FilterEngineProvider>`.
 *
 * @typeParam T - The item type the engine operates over (consumer-asserted, NOT verified
 *   against the actual engine type — TypeScript can't carry the `T` through React context, so
 *   the consumer's annotation is treated as a downcast)
 * @returns The engine instance
 *
 * @example
 *   function ClearFiltersButton() {
 *     const engine = useFilterEngine<Wine>();
 *     return <button onClick={() => engine.core.clearRules()}>Clear all</button>;
 *   }
 */
export function useFilterEngine<T = unknown>(): SignalsEngine<T> {
	const engine = useContext(FilterEngineContext);

	if (engine === null) {
		throw new FilterEngineConfigError(
			'BINDING_ENGINE_NOT_PROVIDED',
			'useFilterEngine called outside a <FilterEngineProvider>. Wrap your component tree in ' +
			'<FilterEngineProvider engine={signalsEngine}>...</FilterEngineProvider>.',
		);
	}

	return engine as unknown as SignalsEngine<T>;
}
