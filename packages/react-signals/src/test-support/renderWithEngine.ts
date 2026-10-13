/**
 * @fileoverview Test-support harness for the `@filter-enginez/react-signals` pass-3 suites.
 *
 * @remarks
 * **Import-only scaffolding.** This module ships no runtime behavior into the package bundle: the
 * build config (`tsconfig.build.json`) and the root coverage config (`vitest.config.ts`) both
 * exclude the `test-support/` directory, so its `@testing-library/react` / `vitest` devDep imports
 * never leak into `dist` and it is not coverage-measured — the whole-file coverage exception that
 * `@filter-enginez/reactive-signals`' `fakeAsyncEngine.ts` already carries.
 *
 * **Why `.ts` (not `.tsx`).** The provider wrapper is built with `createElement` rather than JSX
 * so the file stays clear of the react / jsx-a11y lint surface (which scopes to `.tsx` / `.jsx`);
 * the suites that consume it are all plain `.test.ts`.
 *
 * **Cleanup.** The module-level `afterEach` unmounts rendered trees (`cleanup`) and disposes any
 * engines minted via {@link makeSignalsEngine}. Vitest isolates each test file in its own module
 * graph (`isolate: true`, the default), so this import-time registration binds to the importing
 * file's suite — the DRY equivalent of the per-file `afterEach` disposer pattern the
 * `reactive-signals` suites use, without copy-pasting it into every file.
 *
 * @packageDocumentation
 */

import { createFilterEngine, type FilterEngineOptions } from '@filter-enginez/core';
import { createSignalsEngine, type SignalsEngine } from '@filter-enginez/reactive-signals';
import {
	act,
	cleanup,
	renderHook,
	type RenderHookOptions,
	type RenderHookResult,
} from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach } from 'vitest';

import { FilterEngineProvider } from '../FilterEngineProvider.js';

/** A minimal item shape covering the value / range / in-set / results / simulation suites. */
export interface DemoItem {
	readonly id: string;
	readonly color: string;
	readonly price: number;
}

/** A tiny, deterministic source-data fixture shared across the state-readout suites. */
export const demoData: readonly DemoItem[] = [
	{ color: 'red', id: 'a', price: 10 },
	{ color: 'blue', id: 'b', price: 20 },
	{ color: 'red', id: 'c', price: 30 },
];

/** Teardown callbacks for engines minted during the current test — drained after each test. */
const engineDisposers: (() => void)[] = [];

afterEach((): void => {
	// Unmount RTL-rendered trees first so their effect cleanups run against a live engine, then
	// tear the engines down.
	cleanup();
	while (engineDisposers.length > 0) {
		engineDisposers.pop()?.();
	}
});

/**
 * Build a REAL sync signals engine over a fresh core — the faithful fixture the hooks consume in
 * production. Teardown (adapter `dispose` + core `destroy`) is auto-registered for `afterEach`.
 *
 * @typeParam T - The item type the engine operates over
 * @param options - Core construction options (source data, devtools, similarity, ...)
 * @returns A ready `SignalsEngine<T>`
 */
export function makeSignalsEngine<T = unknown>(options?: FilterEngineOptions<T>): SignalsEngine<T> {
	const core = createFilterEngine<T>(options ?? {});
	const engine = createSignalsEngine(core);

	engineDisposers.push((): void => {
		engine.dispose();
		// Teardown is fire-and-forget in tests — `destroy()` is async but nothing awaits cleanup.
		void core.destroy();
	});

	return engine;
}

/**
 * Render a hook inside a `<FilterEngineProvider>` carrying `engine`, so the `use*` hooks resolve
 * the engine from context exactly as they do in a real component tree.
 *
 * @typeParam Result - The hook's return type
 * @typeParam Props - The hook's props type (defaults to `void` for zero-arg hooks)
 * @typeParam T - The engine's item type
 * @param hook - The hook callback to render
 * @param engine - The engine to provide via context
 * @param options - Optional RTL `renderHook` options (e.g., `initialProps`); `wrapper` is supplied
 * @returns The RTL `renderHook` result
 */
export function renderHookWithEngine<Result, Props = void, T = unknown>(
	hook: (props: Props) => Result,
	engine: SignalsEngine<T>,
	options?: Omit<RenderHookOptions<Props>, 'wrapper'>,
): RenderHookResult<Result, Props> {
	// Erase the generic exactly as `FilterEngineProvider` does internally — the provider is
	// invariant in `T` (via `SimilarityConfig<T>`), so `createElement` won't widen it for us.
	const providedEngine = engine as unknown as SignalsEngine<unknown>;
	const wrapper = ({ children }: { readonly children: ReactNode }): ReactNode =>
		createElement(FilterEngineProvider, { children, engine: providedEngine });

	return renderHook(hook, { ...options, wrapper });
}

export { act, renderHook };
