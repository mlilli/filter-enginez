/**
 * `IndexedDBAdapter` — browser-only `StorageAdapter` backed by IndexedDB, for cases where
 * localStorage's 5-10MB cap isn't enough (typically long-running devtools snapshot
 * persistence accumulating across many sessions).
 *
 * @remarks
 * **Browser-only.** Lives in the `@filter-enginez/core/storage/browser` sub-export. IndexedDB
 * is async-native (vs localStorage's sync API), which matches the `StorageAdapter` interface's
 * Promise-returning shape exactly.
 *
 * **Lazy db open.** The IDB database is opened on the first `load` / `save` / `remove` call,
 * not at construction time. This keeps construction synchronous (no awaitable side effect
 * needed) and means consumers can construct an adapter in non-IDB contexts (SSR, tests with
 * fake storage) without it trying to reach for the IDB global. The opened db handle is
 * cached for the lifetime of the adapter.
 *
 * **The IDB-to-Promise dance.** IndexedDB is event-driven, not Promise-based — every
 * `open` / `get` / `put` / `delete` operation returns an `IDBRequest` whose result is
 * delivered via `onsuccess` / `onerror` handlers. We wrap each request in a `Promise`
 * constructor for the rest of the codebase to consume cleanly.
 *
 * **Browser-global declarations.** Inlined via `declare const` rather than reaching for the
 * DOM lib — keeps the package compileable under the isomorphic-core tsconfig (the package
 * is browser-only at runtime but the type-check pass uses the lean ES2022 lib).
 *
 * @packageDocumentation
 */

import type { StorageAdapter } from '../StorageAdapter.js';

import { FilterEngineError } from '../../errors/index.js';

// Minimal IDB type surface — inlined to avoid pulling in lib.dom.d.ts. The browser provides
// these globals at runtime; we type just what we touch.
//

declare const indexedDB: {
	open(name: string, version?: number): IDBOpenDBRequest;
};
interface IDBOpenDBRequest {
	error: { message: string } | null;
	onerror: (() => void) | null;
	onsuccess: (() => void) | null;
	onupgradeneeded: ((event: { target: { result: IDBDatabase }}) => void) | null;
	result: IDBDatabase;
}
interface IDBDatabase {
	close(): void;
	createObjectStore(name: string): IDBObjectStore;
	objectStoreNames: { contains(name: string): boolean };
	transaction(storeNames: string, mode: 'readonly' | 'readwrite'): IDBTransaction;
}
interface IDBTransaction {
	objectStore(name: string): IDBObjectStore;
}
interface IDBObjectStore {
	delete(key: string): IDBRequest<void>;
	get(key: string): IDBRequest<unknown>;
	put(value: unknown, key: string): IDBRequest<void>;
}
interface IDBRequest<T> {
	error: { message: string } | null;
	onerror: (() => void) | null;
	onsuccess: (() => void) | null;
	result: T;
}

/**
 * Persist via IndexedDB. Used for engine state requiring > localStorage's typical 5-10MB cap.
 *
 * @example
 *   const engine = createFilterEngine({
 *     devtools: {
 *       persistence: {
 *         adapter: new IndexedDBAdapter('filter-enginez', 'devtools'),
 *         key: 'action-log',
 *       },
 *     },
 *   });
 */
export class IndexedDBAdapter implements StorageAdapter {
	private _dbPromise: Promise<IDBDatabase> | undefined;

	constructor(
		readonly dbName: string,
		readonly storeName: string = 'filter-enginez-storage',
		readonly version: number = 1,
	) {}

	async load(key: string): Promise<unknown> {
		const db = await this._ensureDb();

		return new Promise((resolve, reject) => {
			const tx = db.transaction(this.storeName, 'readonly');
			const request = tx.objectStore(this.storeName).get(key);

			request.onsuccess = (): void => resolve(request.result ?? null);
			request.onerror = (): void => reject(new FilterEngineError(
				'STORAGE_OPERATION_FAILED',
				`IndexedDBAdapter.load('${key}'): ${request.error?.message ?? 'unknown error'}`,
				{ cause: request.error },
			));
		});
	}

	async remove(key: string): Promise<void> {
		const db = await this._ensureDb();

		return new Promise((resolve, reject) => {
			const tx = db.transaction(this.storeName, 'readwrite');
			const request = tx.objectStore(this.storeName).delete(key);

			request.onsuccess = (): void => resolve();
			request.onerror = (): void => reject(new FilterEngineError(
				'STORAGE_OPERATION_FAILED',
				`IndexedDBAdapter.remove('${key}'): ${request.error?.message ?? 'unknown error'}`,
				{ cause: request.error },
			));
		});
	}

	async save(key: string, value: unknown): Promise<void> {
		const db = await this._ensureDb();

		return new Promise((resolve, reject) => {
			const tx = db.transaction(this.storeName, 'readwrite');
			const request = tx.objectStore(this.storeName).put(value, key);

			request.onsuccess = (): void => resolve();
			request.onerror = (): void => reject(new FilterEngineError(
				'STORAGE_OPERATION_FAILED',
				`IndexedDBAdapter.save('${key}'): ${request.error?.message ?? 'unknown error'}`,
				{ cause: request.error },
			));
		});
	}

	// ─── Internal ──────────────────────────────────────────────────────────

	/**
	 * Open the IDB database lazily, creating the object store on first run. Cached for the
	 * adapter's lifetime — subsequent calls return the same Promise (which resolves to the
	 * same open `IDBDatabase` handle).
	 */
	private async _ensureDb(): Promise<IDBDatabase> {
		if (this._dbPromise) {
			return this._dbPromise;
		}
		this._dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
			if (typeof indexedDB === 'undefined') {
				reject(new FilterEngineError(
					'STORAGE_UNAVAILABLE',
					'IndexedDBAdapter: `indexedDB` global is not available — IndexedDB is browser-only. '
					+ 'Use MemoryStorageAdapter for tests / SSR / Node contexts.',
				));

				return;
			}
			const openRequest = indexedDB.open(this.dbName, this.version);

			openRequest.onupgradeneeded = (event): void => {
				const db = event.target.result;

				if (!db.objectStoreNames.contains(this.storeName)) {
					db.createObjectStore(this.storeName);
				}
			};
			openRequest.onsuccess = (): void => resolve(openRequest.result);
			openRequest.onerror = (): void => reject(new FilterEngineError(
				'STORAGE_OPERATION_FAILED',
				`IndexedDBAdapter: failed to open database '${this.dbName}' v${this.version}: ${
					openRequest.error?.message ?? 'unknown error'}`,
				{ cause: openRequest.error },
			));
		});

		return this._dbPromise;
	}
}
