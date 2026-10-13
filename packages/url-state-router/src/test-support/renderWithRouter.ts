/**
 * @fileoverview Test-support harness for the `@filter-enginez/url-state-router` pass-3 suites.
 *
 * @remarks
 * **Import-only scaffolding.** This module ships no runtime behavior into the package bundle: the
 * build config (`tsconfig.build.json`) and the root coverage config (`vitest.config.ts`) both
 * exclude the `test-support/` directory, so its `@testing-library/react` / `vitest` devDep imports
 * never leak into `dist` and it is not coverage-measured (the whole-file test-support exception).
 *
 * **Why `.ts` (not `.tsx`).** The router wrapper is built with `createElement` rather than JSX so
 * the file stays clear of the react / jsx-a11y lint surface (which scopes to `.tsx` / `.jsx`); the
 * suites that consume it are all plain `.test.ts` / `.test.tsx`-free.
 *
 * @packageDocumentation
 */

import { createFilterEngine, type FilterEngine, type FilterEngineOptions } from '@filter-enginez/core';
import { act, cleanup, render } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach } from 'vitest';

/** Teardown callbacks for engines minted during the current test — drained after each test. */
const engineDisposers: (() => void)[] = [];

afterEach((): void => {
	cleanup();
	while (engineDisposers.length > 0) {
		engineDisposers.pop()?.();
	}
});

/**
 * Build a REAL core engine (the type `FilterEngineUrlSync` binds to), tracked for `destroy()`
 * teardown after each test.
 *
 * @typeParam T - The item type the engine operates over
 * @param options - Core construction options
 * @returns A ready `FilterEngine<T>`
 */
export function makeEngine<T = unknown>(options?: FilterEngineOptions<T>): FilterEngine<T> {
	const engine = createFilterEngine<T>(options ?? {});

	engineDisposers.push((): void => {
		// Teardown is fire-and-forget in tests — `destroy()` is async but nothing awaits cleanup.
		void engine.destroy();
	});

	return engine;
}

/** The handle a router render returns — the live search string plus the underlying data router. */
export interface RouterRenderResult {
	readonly getSearch: () => string;
	readonly router: ReturnType<typeof createMemoryRouter>;
	readonly unmount: () => void;
}

/**
 * Mount `ui` under a `createMemoryRouter` at any path, exposing the live `location.search` so tests
 * can assert engine→URL writes and seed URL→engine reads via `initialEntries`.
 *
 * @param ui - The element under test (e.g. `<FilterEngineUrlSync .../>`)
 * @param initialEntries - Initial history entries; defaults to `['/']`
 * @returns A `{ getSearch, router }` handle
 */
export function renderWithRouter(
	ui: ReactElement,
	initialEntries: readonly string[] = ['/'],
): RouterRenderResult {
	const router = createMemoryRouter([{ element: ui, path: '*' }], {
		initialEntries: [...initialEntries],
	});
	const result = render(createElement(RouterProvider, { router }));

	return {
		getSearch: (): string => router.state.location.search,
		router,
		unmount: result.unmount,
	};
}

export { act };
