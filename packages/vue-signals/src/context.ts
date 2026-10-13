/**
 * Vue provide/inject helpers for exposing + consuming a Filter EngineZ engine — the Vue counterpart to
 * `react-signals`' `<FilterEngineProvider>` + `useFilterEngine()` (and `svelte-signals`'
 * `setFilterEngine` / `getFilterEngine`).
 *
 * @remarks
 * Call {@link provideFilterEngine} in a parent component's `setup()` (typically the route boot
 * component that has just constructed the engine); descendant components read it with
 * {@link useFilterEngine}. Like React context / Svelte context, this is component-tree scoped — both
 * calls must run during component setup.
 *
 * @packageDocumentation
 */

import type { SignalsEngine } from '@filter-enginez/reactive-signals';

import { FilterEngineConfigError } from '@filter-enginez/core';
import { inject, type InjectionKey, provide } from 'vue';

/**
 * The injection key for the provided engine. A `Symbol`-backed `InjectionKey` so it can't collide with
 * consumer keys; typed at `unknown` because an `InjectionKey` can't be generic (call sites re-narrow).
 */
const ENGINE_KEY: InjectionKey<SignalsEngine<unknown>> = Symbol('filter-enginez.engine');

/**
 * Provide a `SignalsEngine<T>` to this component's descendants. Call during `setup()`.
 *
 * @typeParam T - The item type the engine operates over.
 * @param engine - The engine to expose via Vue provide.
 */
export function provideFilterEngine<T>(engine: SignalsEngine<T>): void {
	provide(ENGINE_KEY, engine as SignalsEngine<unknown>);
}

/**
 * Read the `SignalsEngine<T>` provided by an ancestor via {@link provideFilterEngine}.
 *
 * @typeParam T - The item type the engine operates over.
 * @returns The engine from provide/inject.
 * @throws `FilterEngineConfigError` (`BINDING_ENGINE_NOT_PROVIDED`) when no engine has been provided —
 *   the same misuse `useFilterEngine()` throws on in React.
 */
export function useFilterEngine<T>(): SignalsEngine<T> {
	const engine = inject(ENGINE_KEY);

	if (engine === undefined) {
		throw new FilterEngineConfigError(
			'BINDING_ENGINE_NOT_PROVIDED',
			'useFilterEngine: no Filter EngineZ engine provided — call provideFilterEngine(engine) in a parent component first.',
		);
	}

	return engine as SignalsEngine<T>;
}
