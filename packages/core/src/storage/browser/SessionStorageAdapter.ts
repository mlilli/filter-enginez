/**
 * `SessionStorageAdapter` — browser-only `StorageAdapter` backed by `window.sessionStorage`.
 *
 * @remarks
 * **Browser-only.** Same shape as `LocalStorageAdapter`, but data persists only for the
 * lifetime of the browser tab/window — cleared on close. Useful for short-lived state that
 * shouldn't survive a full browser restart.
 *
 * @packageDocumentation
 */

import type { StorageAdapter } from '../StorageAdapter.js';

interface StorageLike {
	getItem(key: string): string | null;
	removeItem(key: string): void;
	setItem(key: string, value: string): void;
}
declare const sessionStorage: StorageLike;

/**
 * Persist via `window.sessionStorage` with a configurable namespace prefix.
 *
 * @example
 *   const engine = createFilterEngine({
 *     persistence: {
 *       adapter: new SessionStorageAdapter('my-app'),
 *       key: 'wine-filters',
 *     },
 *   });
 */
export class SessionStorageAdapter implements StorageAdapter {
	constructor(private readonly _namespace: string) {}

	load(key: string): unknown {
		const raw = sessionStorage.getItem(this._scopedKey(key));

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
		sessionStorage.removeItem(this._scopedKey(key));
	}

	save(key: string, value: unknown): void {
		sessionStorage.setItem(this._scopedKey(key), JSON.stringify(value));
	}

	private _scopedKey(key: string): string {
		return `${this._namespace}:${key}`;
	}
}
