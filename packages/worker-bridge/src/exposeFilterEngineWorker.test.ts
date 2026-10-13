/**
 * Guard-throw tests for the worker-side router in `exposeFilterEngineWorker`, driven through a
 * RAW Comlink proxy (no `wrapInWorker` auto-init).
 *
 * @remarks
 * These guards are unreachable through the public facade — `wrapInWorker` always calls
 * `init` exactly once before returning — so a raw proxy is the only way to exercise them for
 * real: `init` twice, an unknown factory name, and an engine method called before `init`. Also
 * covers the idempotent second `destroy` (engine already torn down) and a call after it. Each
 * guard is asserted by class and `code` as well as message — the error transfer handler carries
 * both across the channel. We test rather than `v8 ignore` these guards: reaching them documents
 * the router's contract.
 */

import {
	createFilterEngine,
	type FilterEngine,
	FilterEngineConfigError,
	FilterEngineDestroyedError,
	FilterEngineModeError,
} from '@filter-enginez/core';
import { describe, expect, it } from 'vitest';

import { wrapRawWorker } from './test-support/workerHarness.js';

interface Item {
	readonly price: number;
}

const data: readonly Item[] = [{ price: 10 }, { price: 20 }];

/** A worker-side factory that builds a core engine from the init options' `sourceData`. */
function itemEngineFactory(options: Readonly<Record<string, unknown>>): FilterEngine<Item> {
	return createFilterEngine<Item>({ sourceData: options['sourceData'] as readonly Item[] });
}

describe('exposeFilterEngineWorker guards', () => {
	it('throws when init is called twice', async () => {
		const { proxy } = wrapRawWorker<Item>({ item: itemEngineFactory });

		await proxy.init({ factoryName: 'item', options: { sourceData: data }});

		await expect(proxy.init({ factoryName: 'item', options: { sourceData: data }}))
			.rejects.toThrow(/init\(\) called twice/);
		await expect(proxy.init({ factoryName: 'item', options: { sourceData: data }}))
			.rejects.toBeInstanceOf(FilterEngineModeError);
		await expect(proxy.init({ factoryName: 'item', options: { sourceData: data }}))
			.rejects.toMatchObject({ code: 'MODE_WORKER_ALREADY_INITIALIZED' });
	});

	it('throws when init names an unregistered factory', async () => {
		const { proxy } = wrapRawWorker<Item>({ item: itemEngineFactory });

		await expect(proxy.init({ factoryName: 'nope', options: {}}))
			.rejects.toThrow(/no factory registered under name 'nope'/);
		await expect(proxy.init({ factoryName: 'nope', options: {}}))
			.rejects.toBeInstanceOf(FilterEngineConfigError);
		await expect(proxy.init({ factoryName: 'nope', options: {}}))
			.rejects.toMatchObject({ code: 'WORKER_FACTORY_NOT_FOUND' });
	});

	it('does not mistake an Object.prototype member for a registered factory', async () => {
		// A lookup on the factories object itself would find `toString` and call it as a factory.
		const { proxy } = wrapRawWorker<Item>({ item: itemEngineFactory });

		await expect(proxy.init({ factoryName: 'toString', options: {}}))
			.rejects.toMatchObject({ code: 'WORKER_FACTORY_NOT_FOUND' });
		await expect(proxy.init({ factoryName: 'toString', options: {}}))
			.rejects.toThrow(/Registered factories: \[item\]/);
	});

	it('accepts factories for different item types in one map, each keeping its own type', async () => {
		interface Listing {
			readonly city: string;
		}

		const listingEngineFactory = (): FilterEngine<Listing> =>
			createFilterEngine<Listing>({ sourceData: [{ city: 'Lyon' }]});
		// Typed per name: no widening to `unknown` at the call, which is the call every worker file makes.
		const factories = { item: itemEngineFactory, listing: listingEngineFactory };
		const { proxy } = wrapRawWorker<Listing, { item: Item; listing: Listing }>(factories);

		await proxy.init({ factoryName: 'listing', options: {}});

		await expect(proxy.getResults()).resolves.toStrictEqual([{ city: 'Lyon' }]);
	});

	it('reports "(none)" when the worker has no factories registered', async () => {
		const { proxy } = wrapRawWorker<Item>({});

		await expect(proxy.init({ factoryName: 'nope', options: {}}))
			.rejects.toThrow(/Registered factories: \[\(none\)\]/);
	});

	it('throws when an engine method is called before init', async () => {
		const { proxy } = wrapRawWorker<Item>({ item: itemEngineFactory });

		await expect(proxy.getResults()).rejects.toThrow(/called before init\(\)/);
		await expect(proxy.getResults()).rejects.toBeInstanceOf(FilterEngineModeError);
		await expect(proxy.getResults()).rejects.toMatchObject({ code: 'MODE_WORKER_NOT_INITIALIZED' });
	});

	it('resolves destroy before init, with nothing to tear down', async () => {
		// A host whose main thread never got as far as `init` (the worker failed to boot, or the app
		// unmounted first) is still destroyed on teardown; that must not throw.
		const { proxy } = wrapRawWorker<Item>({ item: itemEngineFactory });

		await expect(proxy.destroy()).resolves.toBeUndefined();
		// And it leaves the host uninitialized rather than destroyed.
		await expect(proxy.getResults()).rejects.toMatchObject({ code: 'MODE_WORKER_NOT_INITIALIZED' });
	});

	it('is idempotent when destroy runs after the engine is already torn down', async () => {
		const { proxy } = wrapRawWorker<Item>({ item: itemEngineFactory });

		await proxy.init({ factoryName: 'item', options: { sourceData: data }});
		await proxy.destroy();

		await expect(proxy.destroy()).resolves.toBeUndefined();
	});

	it('keeps the destroyed engine, so a later call rejects as destroyed rather than uninitialized', async () => {
		const { proxy } = wrapRawWorker<Item>({ item: itemEngineFactory });

		await proxy.init({ factoryName: 'item', options: { sourceData: data }});
		await proxy.destroy();

		await expect(proxy.getResults()).rejects.toBeInstanceOf(FilterEngineDestroyedError);
		await expect(proxy.getResults()).rejects.toMatchObject({ code: 'ENGINE_DESTROYED' });
		// One engine per worker lifetime: a destroyed host does not re-initialize.
		await expect(proxy.init({ factoryName: 'item', options: { sourceData: data }}))
			.rejects.toMatchObject({ code: 'MODE_WORKER_ALREADY_INITIALIZED' });
	});
});
