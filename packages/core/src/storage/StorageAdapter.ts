/**
 * `StorageAdapter` — the pluggable persistence interface for the engine.
 *
 * @remarks
 * Strategy pattern. Used by the devtools cross-reload persistence (`devtools/DevtoolsPersistence`,
 * configured via the devtools `persistence` option) for time-travel scrubbing across sessions.
 *
 * Four built-in adapters ship with `core`:
 *   - `MemoryStorageAdapter` — default; works in any runtime; data lost on engine destroy
 *   - `LocalStorageAdapter` — browser sub-export (`@filter-enginez/core/storage/browser`)
 *   - `SessionStorageAdapter` — browser sub-export
 *   - `IndexedDBAdapter` — browser sub-export, for power users needing > 5MB
 *
 * Consumers can implement custom adapters (Redis, filesystem, Supabase, etc.) by satisfying
 * this three-method contract.
 *
 * @packageDocumentation
 */

// #region docs:storage-adapter
/**
 * A value returned either synchronously or as a `Promise`. Lets synchronous adapters
 * (`MemoryStorageAdapter`, `localStorage` / `sessionStorage`) return values directly — without
 * pretending to be `async` — while I/O-backed adapters (`IndexedDBAdapter`, network, filesystem)
 * return a `Promise`. Callers simply `await` the result, which is valid for both.
 */
export type MaybePromise<T> = Promise<T> | T;

/**
 * The three-method contract every storage adapter implements.
 *
 * Methods may be synchronous or asynchronous (see `MaybePromise`): sync backends return values
 * directly; I/O-backed backends return a `Promise`. Callers always `await` the result.
 */
export interface StorageAdapter {
	/**
	 * Load a value by key.
	 *
	 * @param key - The storage key
	 * @returns The stored value, or `null` if not present
	 */
	load(key: string): MaybePromise<unknown>;

	/**
	 * Save a value under a key, replacing any existing value.
	 *
	 * @param key - The storage key
	 * @param value - The value to store. Adapters are responsible for serialization
	 *                (typically JSON.stringify for browser/IndexedDB; arbitrary for memory).
	 */
	save(key: string, value: unknown): MaybePromise<void>;

	/**
	 * Remove a stored value by key. Idempotent — removing a non-existent key is a no-op.
	 *
	 * @param key - The storage key
	 */
	remove(key: string): MaybePromise<void>;
}
// #endregion docs:storage-adapter
