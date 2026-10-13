/**
 * @remarks
 * Tests for `IndexedDBAdapter`. IndexedDB is event-driven and not present in Node, so we build a
 * minimal fake implementing exactly the inlined IDB surface the adapter touches: `open` returns
 * a request whose `onupgradeneeded` / `onsuccess` / `onerror` we fire on a microtask;
 * `transaction → objectStore → get/put/delete` return requests whose `onsuccess` / `onerror`
 * we fire likewise. Covers lazy-open caching (one open across many ops), the object-store
 * create-on-upgrade branch (present + absent), load hit/miss, save, remove, every `onerror`
 * reject branch (both with a populated `error.message` and with a null `error` that drives the
 * `?? 'unknown error'` fallback), and the `indexedDB === undefined` reject branch.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { FilterEngineError } from '../../errors/index.js';
import { IndexedDBAdapter } from './IndexedDBAdapter.js';

type Handler = (() => void) | null;

interface FakeRequest<T> {
	error: { message: string } | null;
	onerror: Handler;
	onsuccess: Handler;
	result: T;
}

/** Drives a request's handlers asynchronously, mimicking the IDB event loop. */
function fire<T>(request: FakeRequest<T>, isOk: boolean): void {
	queueMicrotask(() => {
		if (isOk) {
			request.onsuccess?.();
		} else {
			request.onerror?.();
		}
	});
}

/** A fake object store backed by a Map, with per-op failure injection. */
class FakeObjectStore {
	failOps = new Set<'delete' | 'get' | 'put'>();
	// Ops that fail with a null `error` — drives the adapter's `error?.message ?? 'unknown error'`
	// fallback (an errored request whose `.error` the browser left unpopulated).
	nullErrorOps = new Set<'delete' | 'get' | 'put'>();

	constructor(private readonly _data: Map<string, unknown>) {}

	delete(key: string): FakeRequest<void> {
		const willNullError = this.nullErrorOps.has('delete');
		const isOk = !willNullError && !this.failOps.has('delete');
		const request: FakeRequest<void> = {
			error: isOk || willNullError ? null : { message: 'delete failed' },
			onerror: null,
			onsuccess: null,
			result: undefined,
		};

		if (isOk) {
			this._data.delete(key);
		}
		fire(request, isOk);

		return request;
	}

	get(key: string): FakeRequest<unknown> {
		const willNullError = this.nullErrorOps.has('get');
		const isOk = !willNullError && !this.failOps.has('get');
		const request: FakeRequest<unknown> = {
			error: isOk || willNullError ? null : { message: 'get failed' },
			onerror: null,
			onsuccess: null,
			result: this._data.get(key),
		};

		fire(request, isOk);

		return request;
	}

	put(value: unknown, key: string): FakeRequest<void> {
		const willNullError = this.nullErrorOps.has('put');
		const isOk = !willNullError && !this.failOps.has('put');
		const request: FakeRequest<void> = {
			error: isOk || willNullError ? null : { message: 'put failed' },
			onerror: null,
			onsuccess: null,
			result: undefined,
		};

		if (isOk) {
			this._data.set(key, value);
		}
		fire(request, isOk);

		return request;
	}
}

/** A fake IDB database wrapping a single object store. */
class FakeDatabase {
	createdStores: string[] = [];
	readonly store: FakeObjectStore;

	constructor(
		data: Map<string, unknown>,
		private readonly _existingStores: Set<string>,
	) {
		this.store = new FakeObjectStore(data);
	}

	createObjectStore(name: string): FakeObjectStore {
		this.createdStores.push(name);
		this._existingStores.add(name);

		return this.store;
	}

	get objectStoreNames(): { contains(name: string): boolean } {
		return { contains: (name: string): boolean => this._existingStores.has(name) };
	}

	transaction(): { objectStore(name: string): FakeObjectStore } {
		return { objectStore: (): FakeObjectStore => this.store };
	}
}

interface FakeOpenRequest {
	error: { message: string } | null;
	onerror: Handler;
	onsuccess: Handler;
	onupgradeneeded: ((event: { target: { result: FakeDatabase }}) => void) | null;
	result: FakeDatabase;
}

interface FakeIndexedDBOptions {
	/** Whether the object store already exists (skips create-on-upgrade). */
	readonly storeExists?: boolean;
	/** Whether `open` should fail. */
	readonly failOpen?: boolean;
	/** Whether `open` should fail with a null `error` (drives the `?? 'unknown error'` fallback). */
	readonly failOpenNullError?: boolean;
	/** Whether to fire `onupgradeneeded` before success. */
	readonly fireUpgrade?: boolean;
}

/** Builds a fake `indexedDB` global + exposes the shared db for assertions. */
function makeFakeIndexedDB(options: FakeIndexedDBOptions = {}): {
	db: FakeDatabase;
	indexedDB: { open(name: string, version?: number): FakeOpenRequest };
	openCount: number;
} {
	const data = new Map<string, unknown>();
	const existing = new Set<string>(options.storeExists ? ['filter-enginez-storage'] : []);
	const db = new FakeDatabase(data, existing);
	const state = { openCount: 0 };

	return {
		db,
		indexedDB: {
			open(_name: string, _version?: number): FakeOpenRequest {
				state.openCount += 1;
				const willNullError = options.failOpenNullError === true;
				const isOk = !options.failOpen && !willNullError;
				const request: FakeOpenRequest = {
					error: isOk || willNullError ? null : { message: 'open failed' },
					onerror: null,
					onsuccess: null,
					onupgradeneeded: null,
					result: db,
				};

				queueMicrotask(() => {
					if (!isOk) {
						request.onerror?.();

						return;
					}
					if (options.fireUpgrade !== false) {
						request.onupgradeneeded?.({ target: { result: db }});
					}
					request.onsuccess?.();
				});

				return request;
			},
		},
		get openCount(): number {
			return state.openCount;
		},
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('IndexedDBAdapter', () => {
	describe('lazy open', () => {
		it('opens the db once and caches it across multiple operations', async () => {
			const fake = makeFakeIndexedDB();

			vi.stubGlobal('indexedDB', fake.indexedDB);
			const adapter = new IndexedDBAdapter('db');

			await adapter.save('a', 1);
			await adapter.save('b', 2);
			await adapter.load('a');

			expect(fake.openCount).toBe(1);
		});

		it('creates the object store on upgrade when it does not yet exist', async () => {
			const fake = makeFakeIndexedDB({ storeExists: false });

			vi.stubGlobal('indexedDB', fake.indexedDB);
			const adapter = new IndexedDBAdapter('db');

			await adapter.save('a', 1);

			expect(fake.db.createdStores).toContain('filter-enginez-storage');
		});

		it('does NOT create the object store when it already exists', async () => {
			const fake = makeFakeIndexedDB({ storeExists: true });

			vi.stubGlobal('indexedDB', fake.indexedDB);
			const adapter = new IndexedDBAdapter('db');

			await adapter.save('a', 1);

			expect(fake.db.createdStores).toHaveLength(0);
		});

		it('rejects when the indexedDB global is undefined', async () => {
			vi.stubGlobal('indexedDB', undefined);
			const adapter = new IndexedDBAdapter('db');

			await expect(adapter.load('a')).rejects.toThrow(/browser-only/);
			await expect(adapter.load('a')).rejects.toBeInstanceOf(FilterEngineError);
			await expect(adapter.load('a')).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
		});

		it('rejects when the open request errors', async () => {
			const fake = makeFakeIndexedDB({ failOpen: true });

			vi.stubGlobal('indexedDB', fake.indexedDB);
			const adapter = new IndexedDBAdapter('db');

			await expect(adapter.load('a')).rejects.toThrow(/failed to open database/);
			await expect(adapter.load('a')).rejects.toMatchObject({
				cause: { message: 'open failed' },
				code: 'STORAGE_OPERATION_FAILED',
			});
		});

		it('falls back to "unknown error" when the open request errors with a null error', async () => {
			const fake = makeFakeIndexedDB({ failOpenNullError: true });

			vi.stubGlobal('indexedDB', fake.indexedDB);
			const adapter = new IndexedDBAdapter('db');

			await expect(adapter.load('a')).rejects.toThrow(/unknown error/);
		});
	});

	describe('load', () => {
		it('resolves the stored value on a get hit', async () => {
			const fake = makeFakeIndexedDB();

			vi.stubGlobal('indexedDB', fake.indexedDB);
			const adapter = new IndexedDBAdapter('db');

			await adapter.save('a', { v: 1 });

			expect(await adapter.load('a')).toEqual({ v: 1 });
		});

		it('resolves null when the key is absent (result ?? null)', async () => {
			const fake = makeFakeIndexedDB();

			vi.stubGlobal('indexedDB', fake.indexedDB);
			const adapter = new IndexedDBAdapter('db');

			expect(await adapter.load('missing')).toBeNull();
		});

		it('rejects when the get request errors', async () => {
			const fake = makeFakeIndexedDB();

			vi.stubGlobal('indexedDB', fake.indexedDB);
			const adapter = new IndexedDBAdapter('db');

			// Prime the open, then make subsequent gets fail.
			await adapter.save('a', 1);
			fake.db.store.failOps.add('get');

			await expect(adapter.load('a')).rejects.toThrow(/IndexedDBAdapter\.load\('a'\)/);
			await expect(adapter.load('a')).rejects.toMatchObject({
				cause: { message: 'get failed' },
				code: 'STORAGE_OPERATION_FAILED',
			});
		});

		it('falls back to "unknown error" when the get request errors with a null error', async () => {
			const fake = makeFakeIndexedDB();

			vi.stubGlobal('indexedDB', fake.indexedDB);
			const adapter = new IndexedDBAdapter('db');

			await adapter.save('a', 1);
			fake.db.store.nullErrorOps.add('get');

			await expect(adapter.load('a')).rejects.toThrow(/IndexedDBAdapter\.load\('a'\): unknown error/);
		});
	});

	describe('save', () => {
		it('persists a value retrievable by load', async () => {
			const fake = makeFakeIndexedDB();

			vi.stubGlobal('indexedDB', fake.indexedDB);
			const adapter = new IndexedDBAdapter('db');

			await adapter.save('a', 'value');

			expect(await adapter.load('a')).toBe('value');
		});

		it('rejects when the put request errors', async () => {
			const fake = makeFakeIndexedDB();

			vi.stubGlobal('indexedDB', fake.indexedDB);
			const adapter = new IndexedDBAdapter('db');

			await adapter.save('seed', 1);
			fake.db.store.failOps.add('put');

			await expect(adapter.save('a', 1)).rejects.toMatchObject({
				cause: { message: 'put failed' },
				code: 'STORAGE_OPERATION_FAILED',
				message: expect.stringContaining("IndexedDBAdapter.save('a')") as unknown,
			});
		});

		it('falls back to "unknown error" when the put request errors with a null error', async () => {
			const fake = makeFakeIndexedDB();

			vi.stubGlobal('indexedDB', fake.indexedDB);
			const adapter = new IndexedDBAdapter('db');

			await adapter.save('seed', 1);
			fake.db.store.nullErrorOps.add('put');

			await expect(adapter.save('a', 1)).rejects.toThrow(/IndexedDBAdapter\.save\('a'\): unknown error/);
		});
	});

	describe('remove', () => {
		it('deletes a stored value', async () => {
			const fake = makeFakeIndexedDB();

			vi.stubGlobal('indexedDB', fake.indexedDB);
			const adapter = new IndexedDBAdapter('db');

			await adapter.save('a', 1);
			await adapter.remove('a');

			expect(await adapter.load('a')).toBeNull();
		});

		it('rejects when the delete request errors', async () => {
			const fake = makeFakeIndexedDB();

			vi.stubGlobal('indexedDB', fake.indexedDB);
			const adapter = new IndexedDBAdapter('db');

			await adapter.save('a', 1);
			fake.db.store.failOps.add('delete');

			await expect(adapter.remove('a')).rejects.toMatchObject({
				cause: { message: 'delete failed' },
				code: 'STORAGE_OPERATION_FAILED',
				message: expect.stringContaining("IndexedDBAdapter.remove('a')") as unknown,
			});
		});

		it('falls back to "unknown error" when the delete request errors with a null error', async () => {
			const fake = makeFakeIndexedDB();

			vi.stubGlobal('indexedDB', fake.indexedDB);
			const adapter = new IndexedDBAdapter('db');

			await adapter.save('a', 1);
			fake.db.store.nullErrorOps.add('delete');

			await expect(adapter.remove('a')).rejects.toThrow(/IndexedDBAdapter\.remove\('a'\): unknown error/);
		});
	});

	describe('constructor defaults', () => {
		it('exposes the provided db name and default store name + version', () => {
			const adapter = new IndexedDBAdapter('mydb');

			expect(adapter.dbName).toBe('mydb');
			expect(adapter.storeName).toBe('filter-enginez-storage');
			expect(adapter.version).toBe(1);
		});

		it('honors a custom store name and version', () => {
			const adapter = new IndexedDBAdapter('mydb', 'custom', 4);

			expect(adapter.storeName).toBe('custom');
			expect(adapter.version).toBe(4);
		});
	});
});
