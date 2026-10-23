/**
 * Tests for how `FilterEngineUrlSync` tells its own writes from the user's navigations, under a
 * router whose locations render late and out of order.
 *
 * @remarks
 * An app that navigates inside a React transition can render the location of an older write after
 * a newer one. The sync must recognize that late location as its own and leave the engine alone,
 * while still loading every navigation the user makes: Back and Forward, including Back to a value
 * the sync wrote itself, and an in-app link to any `?f=`. `renderWithDeferredRouter` writes history
 * at call time and renders each of the sync's navigations only when a case commits it, which is
 * what lets these cases put locations on screen in the order the race produces.
 *
 * `debounceMs: 0` makes each engine change write at once.
 */

import { range } from '@filter-enginez/core';
import { createElement, type ReactElement } from 'react';
import { describe, expect, it, type MockInstance, vi } from 'vitest';

import { FilterEngineUrlSync, type FilterEngineUrlSyncProps, PENDING_WRITES_REMEMBERED } from './FilterEngineUrlSync.js';
import { humanReadableSerializer } from './serializers.js';
import { type DeferredRouterHandle, renderWithDeferredRouter } from './test-support/deferredRouter.js';
import { act, makeEngine } from './test-support/renderWithRouter.js';

interface Item {
	readonly price: number;
}

const data: readonly Item[] = [{ price: 10 }, { price: 20 }, { price: 30 }];

/** The engine type the sync binds to here. */
type Engine = ReturnType<typeof makeEngine<Item>>;

/** A mounted sync: its engine, a spy on `loadConfig`, and the router handle. */
interface Mounted {
	readonly engine: Engine;
	readonly loadConfig: MockInstance<Engine['loadConfig']>;
	readonly router: DeferredRouterHandle;
}

/**
 * Mount the sync over a fresh engine under a deferred router.
 *
 * @param props - Props beyond the engine and the zero debounce.
 * @param initialPath - The first history entry.
 * @returns The mounted sync.
 */
function mount(props: Partial<FilterEngineUrlSyncProps<Item>> = {}, initialPath = '/'): Mounted {
	const engine = makeEngine<Item>({ sourceData: data });
	const loadConfig = vi.spyOn(engine, 'loadConfig');
	const element: ReactElement = createElement<FilterEngineUrlSyncProps<Item>>(FilterEngineUrlSync, {
		debounceMs: 0,
		engine,
		...props,
	});

	return { engine, loadConfig, router: renderWithDeferredRouter(element, initialPath) };
}

/**
 * Add a price rule, which makes the sync write (and queue) one navigation.
 *
 * @param engine - The engine.
 * @param id - The rule id.
 * @param max - The price ceiling.
 */
function addPriceRule(engine: Engine, id: string, max: number): void {
	act(() => {
		engine.addRule(id, range('price', { max, min: 0 }));
	});
}

/**
 * Render a queued navigation.
 *
 * @param router - The router handle.
 * @param index - Its position in the queue.
 */
function commit(router: DeferredRouterHandle, index: number): void {
	act(() => {
		router.commit(index);
	});
}

describe('FilterEngineUrlSync — own writes and the user\'s navigations', () => {
	it('keeps the newer state when an older write\'s location renders after a newer one', () => {
		const { engine, loadConfig, router } = mount();

		addPriceRule(engine, 'under-25', 25);
		addPriceRule(engine, 'under-15', 15);
		expect(router.queued()).toHaveLength(2);

		// The newer write renders first, then the older one, late.
		commit(router, 1);
		commit(router, 0);

		expect(loadConfig).not.toHaveBeenCalled();
		expect(engine.getRule('under-25')).toBeDefined();
		expect(engine.getRule('under-15')).toBeDefined();
	});

	it('leaves the engine alone when its writes render in order', () => {
		const { engine, loadConfig, router } = mount();

		addPriceRule(engine, 'under-25', 25);
		addPriceRule(engine, 'under-15', 15);
		commit(router, 0);
		commit(router, 0);

		expect(loadConfig).not.toHaveBeenCalled();
	});

	it('loads Back to a state it wrote itself', () => {
		const { engine, loadConfig, router } = mount({ historyMode: 'push' });

		addPriceRule(engine, 'under-25', 25);
		commit(router, 0);
		addPriceRule(engine, 'under-15', 15);
		commit(router, 0);

		act(() => {
			router.back();
		});

		expect(loadConfig).toHaveBeenCalledTimes(1);
		expect(engine.getRule('under-25')).toBeDefined();
		expect(engine.getRule('under-15')).toBeUndefined();
	});

	it('loads Back to a state it wrote whose location never rendered', () => {
		const { engine, loadConfig, router } = mount({ historyMode: 'push' });

		addPriceRule(engine, 'under-25', 25);
		addPriceRule(engine, 'under-15', 15);
		// Only the newer write renders; the older one's history entry exists all the same.
		commit(router, 1);

		act(() => {
			router.back();
		});

		expect(loadConfig).toHaveBeenCalledTimes(1);
		expect(engine.getRule('under-15')).toBeUndefined();
	});

	it('loads an in-app link to a state it wrote earlier', () => {
		const { engine, loadConfig, router } = mount();

		addPriceRule(engine, 'under-25', 25);
		commit(router, 0);
		const earlier = router.param() ?? '';

		addPriceRule(engine, 'under-15', 15);
		commit(router, 0);

		act(() => {
			router.appNavigate(`/?${new URLSearchParams({ f: earlier }).toString()}`, 'PUSH');
		});

		expect(loadConfig).toHaveBeenCalledTimes(1);
		expect(engine.getRule('under-15')).toBeUndefined();
	});

	it('loads an in-app link to a state it never wrote', () => {
		const { engine, loadConfig, router } = mount();
		const donor = makeEngine<Item>({ sourceData: data });

		donor.addRule('under-15', range('price', { max: 15, min: 0 }));
		const link = humanReadableSerializer.encode(donor.exportConfig());

		act(() => {
			router.appNavigate(`/?${new URLSearchParams({ f: link }).toString()}`, 'REPLACE');
		});

		expect(loadConfig).toHaveBeenCalledTimes(1);
		expect(engine.getRule('under-15')).toBeDefined();
	});

	it('does not reload a state the engine already holds when the user returns to it', () => {
		const { engine, loadConfig, router } = mount({ historyMode: 'push' });

		addPriceRule(engine, 'under-25', 25);
		commit(router, 0);
		act(() => {
			router.appNavigate('/elsewhere', 'PUSH');
		});
		act(() => {
			router.back();
		});

		expect(router.param()).not.toBeNull();
		expect(loadConfig).not.toHaveBeenCalled();
	});

	it(`forgets the oldest of more than ${String(PENDING_WRITES_REMEMBERED)} writes that never rendered`, () => {
		const { engine, loadConfig, router } = mount();

		for (let index = 0; index <= PENDING_WRITES_REMEMBERED; index++) {
			addPriceRule(engine, `rule-${String(index)}`, 30 - index);
		}
		expect(router.queued()).toHaveLength(PENDING_WRITES_REMEMBERED + 1);

		// The second-oldest is still remembered; the oldest is not, so it reads as a navigation.
		commit(router, 1);
		expect(loadConfig).not.toHaveBeenCalled();
		commit(router, 0);
		expect(loadConfig).toHaveBeenCalledTimes(1);
	});

	it('loads a link to its last write once the engine has moved on, before the next write', async () => {
		const { engine, loadConfig, router } = mount({ debounceMs: 50 });

		addPriceRule(engine, 'under-25', 25);
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 60));
		});
		commit(router, 0);
		const written = router.param() ?? '';

		// A change inside the debounce window: the engine has left `written`, the URL has not yet.
		addPriceRule(engine, 'under-15', 15);
		act(() => {
			router.appNavigate(`/?${new URLSearchParams({ f: written }).toString()}`, 'PUSH');
		});

		expect(loadConfig).toHaveBeenCalledTimes(1);
		expect(engine.getRule('under-15')).toBeUndefined();
	});

	it('does not load the parameter it re-attaches after a route change', async () => {
		const { engine, loadConfig, router } = mount({ debounceMs: 50, routeChangeMode: 'replace' });

		addPriceRule(engine, 'under-25', 25);
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 60));
		});
		commit(router, 0);

		// A change still inside the debounce window, then a route change that drops the parameter: the
		// re-attached value is the last one written, one step behind the engine.
		addPriceRule(engine, 'under-15', 15);
		act(() => {
			router.appNavigate('/elsewhere', 'PUSH');
		});
		expect(router.queued()).toHaveLength(1);
		commit(router, 0);

		expect(router.param()).not.toBeNull();
		expect(loadConfig).not.toHaveBeenCalled();
		expect(engine.getRule('under-15')).toBeDefined();
	});

	it('keeps a debounced write pending while an earlier write\'s location renders', async () => {
		const { engine, router } = mount({ debounceMs: 50 });

		addPriceRule(engine, 'under-25', 25);
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 60));
		});
		// A newer change starts its debounce, then the first write's location renders inside it.
		addPriceRule(engine, 'under-15', 15);
		commit(router, 0);
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 60));
		});

		expect(router.queued()).toHaveLength(1);
		commit(router, 0);
		expect(decodeURIComponent(router.param() ?? '')).toContain('under-15');
	});

	it('writes to the route the app is on now, not the one it mounted on', () => {
		const { engine, router } = mount({}, '/first?x=1');

		act(() => {
			router.appNavigate('/second?y=2', 'PUSH');
		});
		addPriceRule(engine, 'under-25', 25);

		const [write] = router.queued();

		expect(write?.path).toMatch(/^\/second\?y=2&f=/u);
	});

	it('discards an in-flight export when the engine changes before it returns', async () => {
		let releaseExport: () => void = () => undefined;
		const donor = makeEngine<Item>({ sourceData: data });

		donor.addRule('under-25', range('price', { max: 25, min: 0 }));
		const exported = donor.exportConfig();
		const asyncConfig = {
			exportConfig: vi.fn(async () => new Promise<typeof exported>((resolve) => {
				releaseExport = () => {
					resolve(exported);
				};
			})),
		};
		const { engine, router } = mount({ asyncConfig, debounceMs: 50 });

		addPriceRule(engine, 'under-25', 25);
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 60));
		});
		expect(asyncConfig.exportConfig).toHaveBeenCalledTimes(1);

		// The change lands while the export is in flight and schedules its own write; the old one
		// must not reach the URL in between.
		addPriceRule(engine, 'under-15', 15);
		await act(async () => {
			releaseExport();
			await Promise.resolve();
		});

		expect(router.queued()).toHaveLength(0);
	});
});
