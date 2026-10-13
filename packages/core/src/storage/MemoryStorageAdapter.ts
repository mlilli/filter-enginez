/**
 * `MemoryStorageAdapter` — the default in-memory `StorageAdapter`. Works in every JS runtime.
 *
 * @remarks
 * Used when no persistence is configured, or when explicitly requested. Data is held in an
 * internal `Map` and lost when the adapter instance is garbage-collected. Useful for:
 *
 *   - Default engine setup (no persistence required)
 *   - Tests (deterministic, no I/O)
 *   - SSR / pre-rendering (no browser storage available)
 *   - Edge functions (Cloudflare Workers etc. lacking persistent storage)
 *
 * @packageDocumentation
 */

import type { StorageAdapter } from './StorageAdapter.js';

// #region docs:memory-storage-adapter
/**
 * In-memory implementation of `StorageAdapter`. Stores values in a private `Map`.
 *
 * @example
 *   const engine = createFilterEngine({
 *     persistence: {
 *       adapter: new MemoryStorageAdapter(),
 *       key: 'wine-filters',
 *     },
 *   });
 */
export class MemoryStorageAdapter implements StorageAdapter {
	private readonly _store = new Map<string, unknown>();

	load(key: string): unknown {
		return this._store.has(key) ? this._store.get(key) : null;
	}

	remove(key: string): void {
		this._store.delete(key);
	}

	save(key: string, value: unknown): void {
		this._store.set(key, value);
	}
}
// #endregion docs:memory-storage-adapter
