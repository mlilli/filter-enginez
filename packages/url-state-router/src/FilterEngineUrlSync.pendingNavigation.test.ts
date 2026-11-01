/**
 * Tests for a write that lands while a navigation is waiting to render.
 *
 * @remarks
 * React Router commits a navigation inside a transition, so between the app's `navigate` and the
 * commit, the router is on the new entry and the rendered location is the old one. These cases hold
 * a navigation in that state with a route that suspends until the case releases it, make the engine
 * write meanwhile, and check where the user ends up: a write built from the old location would
 * replace the new entry with it and take the user back. `<MemoryRouter>` commits through a
 * transition like `<BrowserRouter>`, and exposes its history the same way.
 *
 * `debounceMs: 0` makes each engine change write at once. A navigation starts inside an async `act`:
 * one that suspends inside a synchronous `act` is never resumed in this environment.
 */

import { range } from '@filter-enginez/core';
import { render, screen, waitFor } from '@testing-library/react';
import { createElement, Fragment, type ReactElement, Suspense, use, useLayoutEffect } from 'react';
import { type Location, MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { describe, expect, it } from 'vitest';

import { FilterEngineUrlSync } from './FilterEngineUrlSync.js';
import { humanReadableSerializer } from './serializers.js';
import { act, makeEngine } from './test-support/renderWithRouter.js';

interface Item {
	readonly price: number;
}

const data: readonly Item[] = [{ price: 10 }, { price: 20 }, { price: 30 }];

/** A route that renders only once its gate opens, which holds the navigation to it. */
interface GatedRoute {
	/** The route's element. */
	readonly element: ReactElement;
	/** Open the gate and wait for the route to render. */
	readonly open: () => Promise<void>;
}

/**
 * A route element that suspends until {@link GatedRoute.open}.
 *
 * @param text - What it renders once open.
 * @returns The element and its gate.
 */
function gatedRoute(text: string): GatedRoute {
	let release = (): void => undefined;
	const gate = new Promise<undefined>((resolve) => {
		release = (): void => {
			resolve(undefined);
		};
	});
	const Gated = (): ReactElement => {
		use(gate);

		return createElement('p', null, text);
	};

	return {
		element: createElement(Gated),
		open: async (): Promise<void> => {
			release();
			// React resumes the suspended navigation once the promise settles; `findByText` waits for
			// that commit inside `act`, and fails when the route never renders.
			await screen.findByText(text);
		},
	};
}

/** What the harness exposes: the rendered location and the router's `navigate`. */
interface Seen {
	location: Location | null;
	navigate: ((to: string) => void) | null;
}

/**
 * Record the rendered location and the router's `navigate` into `seen`, in the commit itself: a held
 * transition renders without committing, so that render must not count, and a passive effect would
 * run after the DOM a case reads.
 *
 * @param seen - Where to record them.
 * @returns A component that renders nothing.
 */
function recorder(seen: Seen): () => null {
	return (): null => {
		const location = useLocation();
		const navigate = useNavigate();

		useLayoutEffect((): void => {
			seen.location = location;
			seen.navigate = (to: string): void => {
				void navigate(to);
			};
		});

		return null;
	};
}

/**
 * Render routes under a `<MemoryRouter>` whose Suspense boundary is already showing content, so a
 * navigation to a suspended route keeps the old screen (a held transition) instead of a fallback.
 *
 * @param initialPath - The first entry.
 * @param children - What to render inside the router.
 */
function renderRouter(initialPath: string, ...children: ReactElement[]): void {
	render(createElement(MemoryRouter, { initialEntries: [initialPath]}, createElement(Suspense, { fallback: 'loading' }, ...children)));
}

/** A price-ceiling rule change, which makes the sync write. */
function addPriceRule(engine: ReturnType<typeof makeEngine<Item>>): void {
	act(() => {
		engine.addRule('price', range('price', { max: 20, min: 0 }));
	});
}

describe('FilterEngineUrlSync — a write while a navigation waits to render', () => {
	it('leaving the route: the user lands on the new route, and the write is dropped with the route', async () => {
		const engine = makeEngine<Item>({ sourceData: data });
		const seen: Seen = { location: null, navigate: null };
		const hub = gatedRoute('hub');
		const books = createElement(Fragment, null, createElement(FilterEngineUrlSync<Item>, { debounceMs: 0, engine }), createElement('p', null, 'books'));

		renderRouter(
			'/books',
			createElement(recorder(seen)),
			createElement(Routes, null, createElement(Route, { element: hub.element, path: '/' }), createElement(Route, { element: books, path: '/books' })),
		);
		await act(async () => {
			seen.navigate?.('/');

			return Promise.resolve();
		});
		// The navigation is held: the router is on `/`, the screen still shows the route being left.
		expect(screen.getByText('books')).toBeDefined();

		addPriceRule(engine);
		await hub.open();

		expect(screen.getByText('hub')).toBeDefined();
		expect(seen.location?.pathname).toBe('/');
		expect(seen.location?.search).toBe('');
	});

	it('staying mounted: the write waits, then lands on the new location with the engine state', async () => {
		const engine = makeEngine<Item>({ sourceData: data });
		const seen: Seen = { location: null, navigate: null };
		const second = gatedRoute('second');

		renderRouter(
			'/first',
			createElement(recorder(seen)),
			createElement(FilterEngineUrlSync<Item>, { debounceMs: 0, engine, serializer: 'human-readable' }),
			createElement(Routes, null, createElement(Route, { element: createElement('p', null, 'first'), path: '/first' }), createElement(Route, { element: second.element, path: '/second' })),
		);
		await act(async () => {
			seen.navigate?.('/second');

			return Promise.resolve();
		});
		addPriceRule(engine);
		// Nothing written yet: the write waits for `/second` to render rather than replacing it.
		expect(seen.location?.pathname).toBe('/first');
		expect(seen.location?.search).toBe('');

		await second.open();
		// The waiting write runs once `/second` renders, and commits its own location after that.
		await waitFor(() => {
			expect(seen.location?.search).not.toBe('');
		});

		expect(seen.location?.pathname).toBe('/second');
		const written = new URLSearchParams(seen.location?.search).get('f');

		expect(humanReadableSerializer.decode(written ?? '')).toEqual(engine.exportConfig());
	});
});
