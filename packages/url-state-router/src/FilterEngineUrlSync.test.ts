/**
 * Tests for `FilterEngineUrlSync` — the react-router component that two-way-binds a `FilterEngine`
 * to the URL query string: engine→URL writes (sync + debounced), URL→engine loads, the
 * origin-sentinel no-loop guard, malformed-URL tolerance, timer/subscription teardown, and the
 * re-attach of the filter parameter after a route change (`routeChangeMode`).
 */

import { createFilterEngine, type FilterEngineConfig, range } from '@filter-enginez/core';
import { createElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FilterEngineUrlSync, type FilterEngineUrlSyncProps } from './FilterEngineUrlSync.js';
import { jsonBase64Serializer } from './serializers.js';
import { act, makeEngine, renderWithRouter } from './test-support/renderWithRouter.js';

interface Item {
	readonly price: number;
}

const data: readonly Item[] = [{ price: 10 }, { price: 20 }, { price: 30 }];

/**
 * Build the `<FilterEngineUrlSync>` element with the props generic pinned to `Item` — the component
 * is invariant in `T`, so `createElement` needs the explicit annotation to accept a typed engine.
 */
function urlSync(props: FilterEngineUrlSyncProps<Item>): ReactElement {
	return createElement<FilterEngineUrlSyncProps<Item>>(FilterEngineUrlSync, props);
}

/** A URL search string (`?f=...`) seeded with a json-base64-encoded config carrying a price rule. */
function seededSearch(): string {
	const seed = createFilterEngine<Item>({ sourceData: data });

	seed.addRule('price', range('price', { max: 100, min: 15 }));
	const serialized = jsonBase64Serializer.encode(seed.exportConfig());

	void seed.destroy();
	const search = new URLSearchParams();

	search.set('f', serialized);

	return `/?${search.toString()}`;
}

describe('FilterEngineUrlSync', () => {
	it('writes engine state into the URL on change (synchronous when debounceMs is 0)', async () => {
		const engine = makeEngine<Item>({ sourceData: data });
		const { getSearch } = renderWithRouter(urlSync({ debounceMs: 0, engine }));

		expect(getSearch()).not.toContain('f=');

		await act(async () => {
			engine.addRule('price', range('price', { max: 100, min: 15 }));
			// Flush the microtask the react-router navigation settles on.
			await Promise.resolve();
		});

		expect(getSearch()).toContain('f=');
		const encoded = new URLSearchParams(getSearch()).get('f') ?? '';

		expect(decodeURIComponent(encoded)).toContain('price');
	});

	it('does not re-load the engine from its own URL echo (origin sentinel)', async () => {
		const engine = makeEngine<Item>({ sourceData: data });
		const loadSpy = vi.spyOn(engine, 'loadConfig');

		renderWithRouter(urlSync({ debounceMs: 0, engine }));

		await act(async () => {
			engine.addRule('price', range('price', { max: 100, min: 15 }));
			// Flush the microtask the react-router navigation settles on.
			await Promise.resolve();
		});

		// The write echoed back into location.search, but the sentinel matched so no reload fired.
		expect(loadSpy).not.toHaveBeenCalled();
	});

	it('loads engine state from an initial URL param on mount', () => {
		const engine = makeEngine<Item>({ sourceData: data });

		// RTL `render` (inside `renderWithRouter`) flushes mount effects in `act`, so the URL→engine
		// load runs synchronously here.
		renderWithRouter(urlSync({ debounceMs: 0, engine, serializer: 'json-base64' }), [seededSearch()]);

		expect(engine.getActiveRuleIds()).toContain('price');
	});

	it('calls onError and leaves state unchanged on a malformed URL when tolerant', () => {
		const engine = makeEngine<Item>({ sourceData: data });
		const onError = vi.fn();
		const search = new URLSearchParams();

		// base64url of 'x' — decodes cleanly but is not valid JSON, so decode() throws.
		search.set('f', 'eA');
		renderWithRouter(urlSync({ engine, onError, serializer: 'json-base64' }), [`/?${search.toString()}`]);

		expect(onError).toHaveBeenCalledTimes(1);
		expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
		expect(engine.getActiveRuleIds()).toHaveLength(0);
	});

	it('rethrows a decode error when tolerateMalformedUrls is false', () => {
		const engine = makeEngine<Item>({ sourceData: data });
		const onError = vi.fn();
		// The rethrow happens inside a useEffect, so React surfaces it via console.error (an uncaught
		// error) rather than propagating a synchronous throw out of render — the opposite of the
		// tolerant path, which swallows it after onError. Silence the console noise.
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const search = new URLSearchParams();

		search.set('f', 'eA');
		renderWithRouter(
			urlSync({ engine, onError, serializer: 'json-base64', tolerateMalformedUrls: false }),
			[`/?${search.toString()}`],
		);

		expect(onError).toHaveBeenCalledTimes(1);
		expect(errorSpy).toHaveBeenCalled();

		errorSpy.mockRestore();
	});

	it('debounces engine→URL writes until the timer elapses', async () => {
		const engine = makeEngine<Item>({ sourceData: data });
		const { getSearch } = renderWithRouter(urlSync({ debounceMs: 20, engine, historyMode: 'push' }));

		act(() => {
			// Two rapid mutations — the second clears the first's pending timer (coalescing).
			engine.addRule('price', range('price', { max: 100, min: 15 }));
			engine.addRule('priceTwo', range('price', { max: 50, min: 0 }));
		});
		expect(getSearch()).not.toContain('f=');

		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 40));
		});

		expect(getSearch()).toContain('f=');
	});

	it('clears a pending write timer on unmount', () => {
		const engine = makeEngine<Item>({ sourceData: data });
		const { unmount } = renderWithRouter(urlSync({ debounceMs: 150, engine }));

		act(() => {
			engine.addRule('price', range('price', { max: 100, min: 15 }));
		});
		// Unmounting with a timer still pending exercises the cleanup clearTimeout path.
		expect(() => {
			unmount();
		}).not.toThrow();
	});

	/** Build a config carrying a single price rule under the given id (for the async-export fakes). */
	function configWith(id: string): FilterEngineConfig {
		const seed = createFilterEngine<Item>({ sourceData: data });

		seed.addRule(id, range('price', { max: 100, min: 0 }));
		const config = seed.exportConfig();

		void seed.destroy();

		return config;
	}

	it('exports through asyncConfig for worker-backed engines (bypassing the sync exportConfig)', async () => {
		const engine = makeEngine<Item>({ sourceData: data });
		// A worker-backed engine's `core.exportConfig()` throws; the async source provides the config.
		const syncExportSpy = vi.spyOn(engine, 'exportConfig');
		const asyncConfig = { exportConfig: vi.fn(async () => Promise.resolve(configWith('price'))) };
		const { getSearch } = renderWithRouter(urlSync({ asyncConfig, debounceMs: 0, engine }));

		await act(async () => {
			engine.addRule('trigger', range('price', { max: 100, min: 0 }));
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		expect(asyncConfig.exportConfig).toHaveBeenCalled();
		expect(syncExportSpy).not.toHaveBeenCalled();
		expect(decodeURIComponent(new URLSearchParams(getSearch()).get('f') ?? '')).toContain('price');
	});

	it('discards a stale in-flight async export superseded by a newer change (write token)', async () => {
		const engine = makeEngine<Item>({ sourceData: data });
		let releaseFirstExport: () => void = () => undefined;
		let call = 0;
		// The FIRST export is held open; every later export resolves immediately to the "latest" config.
		// Releasing the held first export AFTER a newer write must not clobber the URL (token discards it).
		const asyncConfig = {
			exportConfig: vi.fn(async () => {
				call += 1;
				if (call === 1) {
					return new Promise<FilterEngineConfig>((resolve) => {
						releaseFirstExport = () => resolve(configWith('stale-first'));
					});
				}

				return configWith('latest');
			}),
		};
		const { getSearch } = renderWithRouter(urlSync({ asyncConfig, debounceMs: 0, engine }));

		await act(async () => {
			engine.addRule('e1', range('price', { max: 100, min: 0 }));
			engine.addRule('e2', range('price', { max: 50, min: 0 }));
			await new Promise((resolve) => setTimeout(resolve, 0));
			releaseFirstExport();
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		const finalParam = decodeURIComponent(new URLSearchParams(getSearch()).get('f') ?? '');

		expect(finalParam).toContain('latest');
		expect(finalParam).not.toContain('stale-first');
	});

	describe('across routes', () => {
		/** Render at `/a`, write one rule into the URL, and return the router handle. */
		async function withStateOnA(props: Partial<FilterEngineUrlSyncProps<Item>> = {}): Promise<ReturnType<typeof renderWithRouter>> {
			const engine = makeEngine<Item>({ sourceData: data });
			const handle = renderWithRouter(urlSync({ debounceMs: 0, engine, ...props }), ['/a']);

			await act(async () => {
				engine.addRule('price', range('price', { max: 100, min: 15 }));
				await Promise.resolve();
			});

			return handle;
		}

		it('leaves the URL as the app wrote it when routeChangeMode is unset', async () => {
			const { getSearch, router } = await withStateOnA();

			await act(async () => {
				await router.navigate('/b');
			});

			expect(getSearch()).toBe('');
		});

		it('re-attaches the parameter to a new route, replacing the navigation entry, with routeChangeMode "replace"', async () => {
			const { getSearch, router } = await withStateOnA({ routeChangeMode: 'replace' });
			const written = new URLSearchParams(getSearch()).get('f');

			await act(async () => {
				await router.navigate('/b');
			});

			expect(router.state.location.pathname).toBe('/b');
			expect(new URLSearchParams(getSearch()).get('f')).toBe(written);
			expect(router.state.historyAction).toBe('REPLACE');
		});

		it('pushes a second entry with routeChangeMode "push"', async () => {
			const { getSearch, router } = await withStateOnA({ routeChangeMode: 'push' });

			await act(async () => {
				await router.navigate('/b');
			});

			expect(getSearch()).toContain('f=');
			expect(router.state.historyAction).toBe('PUSH');
		});

		it('leaves a parameter the new URL already carries, and carries state loaded from the URL', async () => {
			const engine = makeEngine<Item>({ sourceData: data });
			const seeded = seededSearch();
			const { getSearch, router } = renderWithRouter(
				urlSync({ debounceMs: 0, engine, routeChangeMode: 'replace', serializer: jsonBase64Serializer }),
				[seeded],
			);

			await act(async () => {
				await router.navigate('/b?f=other&x=1');
			});
			expect(new URLSearchParams(getSearch()).get('f')).toBe('other');

			await act(async () => {
				await router.navigate('/c');
			});
			expect(getSearch()).toBe(seeded.slice(1));
		});

		it('adds nothing when the engine has no URL state yet', async () => {
			const engine = makeEngine<Item>({ sourceData: data });
			const { getSearch, router } = renderWithRouter(urlSync({ debounceMs: 0, engine, routeChangeMode: 'replace' }), ['/a']);

			await act(async () => {
				await router.navigate('/b');
			});

			expect(getSearch()).toBe('');
		});
	});
});
