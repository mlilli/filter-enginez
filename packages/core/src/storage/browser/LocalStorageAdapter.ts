/**
 * `LocalStorageAdapter` — browser-only `StorageAdapter` backed by `window.localStorage`.
 *
 * @remarks
 * **Browser-only.** Lives in the `@filter-enginez/core/storage/browser` sub-export to keep the
 * default entry point isomorphic. Reaching for `localStorage` from a Node or edge runtime
 * would throw; consumers selecting this adapter are signaling browser context.
 *
 * Storage capacity: typically 5-10MB per origin (browser-dependent). For larger persistence
 * needs (devtools snapshots accumulating across long dev sessions), use `IndexedDBAdapter`
 * instead.
 *
 * Namespacing: keys are prefixed with the adapter's `namespace` to prevent collisions between
 * multiple engine instances or unrelated localStorage usage in the same origin.
 *
 * @packageDocumentation
 */

import type { StorageAdapter } from '../StorageAdapter.js';

// localStorage is part of lib.dom.d.ts; this module is browser-only, but to avoid pulling DOM
// types into the entire isomorphic core, we declare the minimal contract inline. The actual
// runtime check (this only works in browsers) is the consumer's responsibility.
interface StorageLike {
	getItem(key: string): string | null;
	removeItem(key: string): void;
	setItem(key: string, value: string): void;
}
declare const localStorage: StorageLike;

// #region docs:local-storage-adapter
/**
 * Persist via `window.localStorage` with a configurable namespace prefix.
 *
 * @example
 *   const engine = createFilterEngine({
 *     persistence: {
 *       adapter: new LocalStorageAdapter('my-app'),
 *       key: 'wine-filters',
 *     },
 *   });
 */
export class LocalStorageAdapter implements StorageAdapter {
	constructor(private readonly _namespace: string) {}

	load(key: string): unknown {
		const raw = localStorage.getItem(this._scopedKey(key));

		if (raw === null) {
			return null;
		}
		try {
			return JSON.parse(raw) as unknown;
		} catch {
			return null;
		}
	}

	remove(key: string): void {
		localStorage.removeItem(this._scopedKey(key));
	}

	save(key: string, value: unknown): void {
		localStorage.setItem(this._scopedKey(key), JSON.stringify(value));
	}

	private _scopedKey(key: string): string {
		return `${this._namespace}:${key}`;
	}
}
// #endregion docs:local-storage-adapter
