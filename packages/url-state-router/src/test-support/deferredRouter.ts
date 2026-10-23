/**
 * @fileoverview A router whose navigations commit when the test says so, in the order it says.
 *
 * @remarks
 * **What it models.** A browser router writes the address bar synchronously when the app calls
 * `navigate`, and hands React the new location in a state update. When the app navigates inside a
 * transition, React may render that location later than the call, and two quick navigations can
 * reach the screen in either order. This harness reproduces exactly that: `navigate` records the
 * entry in the history stack at once (as `history.pushState` / `replaceState` would) and queues the
 * location; {@link DeferredRouterHandle.commit} renders a queued location whenever, and in whatever
 * order, the test chooses. Back and in-app links commit at once, as a user's navigation does.
 *
 * **Import-only scaffolding**, like `renderWithRouter.ts`: `tsconfig.build.json` and the root
 * coverage config exclude `test-support/`.
 *
 * @packageDocumentation
 */

import { render } from '@testing-library/react';
import { createElement, type ReactElement, type ReactNode, useState } from 'react';
import { createPath, NavigationType, type Navigator, parsePath, Router, type To } from 'react-router';

/** One location the router can show. */
interface RouterView {
	/** The location, as a path string (`/wine?f=…`). */
	readonly path: string;
	/** How it was reached. */
	readonly type: NavigationType;
}

/** A navigation the component made that React has not rendered yet. */
export interface QueuedNavigation {
	/** The path it navigates to. */
	readonly path: string;
	/** `PUSH` or `REPLACE`. */
	readonly type: NavigationType;
}

/** The test's handle on a mounted {@link renderWithDeferredRouter}. */
export interface DeferredRouterHandle {
	/** Navigate as the app would through a link: recorded in history and rendered at once. */
	readonly appNavigate: (path: string, type: 'PUSH' | 'REPLACE') => void;
	/** Go back one history entry, as the browser's Back button does (a `POP`). */
	readonly back: () => void;
	/**
	 * Render a queued navigation now. Call inside `act`.
	 *
	 * @param index - Its position in {@link DeferredRouterHandle.queued}.
	 */
	readonly commit: (index: number) => void;
	/** The rendered location's `?param=` value, or `null`. */
	readonly param: (key?: string) => string | null;
	/** The navigations the component made that are waiting to render, oldest first. */
	readonly queued: () => readonly QueuedNavigation[];
}

/**
 * Mount `ui` under a router that defers the component's own navigations.
 *
 * @param ui - The element under test.
 * @param initialPath - The first history entry; defaults to `/`.
 * @returns The handle.
 */
export function renderWithDeferredRouter(ui: ReactElement, initialPath = '/'): DeferredRouterHandle {
	const history: string[] = [initialPath];
	const queue: QueuedNavigation[] = [];
	let index = 0;
	let rendered: RouterView = { path: initialPath, type: NavigationType.Pop };
	let show: (view: RouterView) => void = () => undefined;

	/**
	 * Record a navigation in the history stack, as the browser does at call time.
	 *
	 * @param path - Where to.
	 * @param type - `PUSH` adds an entry after the current one; `REPLACE` overwrites it.
	 */
	const record = (path: string, type: NavigationType): void => {
		if (type === NavigationType.Push) {
			history.splice(index + 1, history.length, path);
			index += 1;
		} else {
			history[index] = path;
		}
	};
	const navigator: Navigator = {
		createHref: (to: To): string => (typeof to === 'string' ? to : createPath(to)),
		go: (): void => undefined,
		push: (to: To): void => {
			const path = typeof to === 'string' ? to : createPath(to);

			record(path, NavigationType.Push);
			queue.push({ path, type: NavigationType.Push });
		},
		replace: (to: To): void => {
			const path = typeof to === 'string' ? to : createPath(to);

			record(path, NavigationType.Replace);
			queue.push({ path, type: NavigationType.Replace });
		},
	};

	/**
	 * The router, rendering whichever view the test last committed.
	 *
	 * @param props - The children to route.
	 * @returns The router element.
	 */
	const DeferredRouter = ({ children }: { readonly children: ReactNode }): ReactElement => {
		const [view, setView] = useState<RouterView>(rendered);

		show = (next: RouterView): void => {
			rendered = next;
			setView(next);
		};

		return createElement(Router, { location: parsePath(view.path), navigationType: view.type, navigator }, children);
	};

	render(createElement(DeferredRouter, null, ui));

	return {
		appNavigate: (path, type): void => {
			const navigationType = type === 'PUSH' ? NavigationType.Push : NavigationType.Replace;

			record(path, navigationType);
			show({ path, type: navigationType });
		},
		back: (): void => {
			index -= 1;
			show({ path: history[index] ?? '/', type: NavigationType.Pop });
		},
		commit: (position): void => {
			const [navigation] = queue.splice(position, 1);

			if (navigation === undefined) {
				throw new Error(`No queued navigation at ${String(position)}`);
			}
			show(navigation);
		},
		param: (key = 'f'): string | null => new URLSearchParams(parsePath(rendered.path).search ?? '').get(key),
		queued: (): readonly QueuedNavigation[] => [...queue],
	};
}
