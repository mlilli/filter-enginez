/**
 * Svelte context helpers for providing + consuming a Filter EngineZ engine — the Svelte counterpart
 * to `react-signals`' `<FilterEngineProvider>` + `useFilterEngine()`.
 *
 * @remarks
 * Svelte's `setContext` / `getContext` replace the React Provider/hook pair. Call {@link setFilterEngine}
 * in a parent component's `<script>` (typically a route boot component that has just constructed the
 * engine); descendant components read it with {@link getFilterEngine}. Like React context, this is
 * component-tree scoped — both calls must happen during component initialization.
 *
 * @packageDocumentation
 */

import type { SignalsEngine } from '@filter-enginez/reactive-signals';

import { FilterEngineConfigError } from '@filter-enginez/core';
import { getContext, setContext } from 'svelte';

/** Context key for the provided engine. A `Symbol` so it can't collide with consumer context keys. */
const ENGINE_KEY = Symbol('filter-enginez.engine');

/**
 * Provide a `SignalsEngine<T>` to this component's descendants. Call during component initialization.
 *
 * @typeParam T - The item type the engine operates over.
 * @param engine - The engine to expose via Svelte context.
 */
export function setFilterEngine<T>(engine: SignalsEngine<T>): void {
	setContext(ENGINE_KEY, engine);
}

/**
 * Read the `SignalsEngine<T>` provided by an ancestor via {@link setFilterEngine}.
 *
 * @typeParam T - The item type the engine operates over.
 * @returns The engine from context.
 * @throws `FilterEngineConfigError` (`BINDING_ENGINE_NOT_PROVIDED`) when no engine has been provided —
 *   the same misuse `useFilterEngine()` throws on in React.
 */
export function getFilterEngine<T>(): SignalsEngine<T> {
	const engine = getContext<SignalsEngine<T> | undefined>(ENGINE_KEY);

	if (engine === undefined) {
		throw new FilterEngineConfigError(
			'BINDING_ENGINE_NOT_PROVIDED',
			'getFilterEngine: no Filter EngineZ engine in context — call setFilterEngine(engine) in a parent component first.',
		);
	}

	return engine;
}
