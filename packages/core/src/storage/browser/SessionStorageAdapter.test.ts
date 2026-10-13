/**
 * @remarks
 * Tests for `SessionStorageAdapter` — same contract as `LocalStorageAdapter` but backed by the
 * `declare const sessionStorage` global, here a `vi.stubGlobal` in-memory fake so the real code
 * paths run under the Node test project. Covers namespace scoping, save (JSON serialize), load
 * hit/miss, remove, and the malformed-JSON catch fallback to null.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionStorageAdapter } from './SessionStorageAdapter.js';

/** Minimal in-memory fake implementing the inlined `StorageLike` surface. */
class FakeStorage {
	readonly map = new Map<string, string>();

	getItem(key: string): string | null {
		return this.map.has(key) ? (this.map.get(key) as string) : null;
	}

	removeItem(key: string): void {
		this.map.delete(key);
	}

	setItem(key: string, value: string): void {
		this.map.set(key, value);
	}
}

let fake: FakeStorage;

beforeEach(() => {
	fake = new FakeStorage();
	vi.stubGlobal('sessionStorage', fake);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('SessionStorageAdapter', () => {
	it('save JSON-serializes the value under a namespaced key', () => {
		const adapter = new SessionStorageAdapter('app');

		adapter.save('filters', [1, 2]);

		expect(fake.map.get('app:filters')).toBe('[1,2]');
	});

	it('load JSON-parses a stored value on hit', () => {
		const adapter = new SessionStorageAdapter('app');

		adapter.save('filters', { x: 'y' });

		expect(adapter.load('filters')).toEqual({ x: 'y' });
	});

	it('load returns null when the namespaced key is absent', () => {
		const adapter = new SessionStorageAdapter('app');

		expect(adapter.load('missing')).toBeNull();
	});

	it('load returns null (catch fallback) when the stored value is malformed JSON', () => {
		const adapter = new SessionStorageAdapter('app');

		fake.map.set('app:filters', 'definitely-not-json}');

		expect(adapter.load('filters')).toBeNull();
	});

	it('remove deletes the namespaced key', () => {
		const adapter = new SessionStorageAdapter('app');

		adapter.save('filters', 1);
		adapter.remove('filters');

		expect(fake.map.has('app:filters')).toBe(false);
	});
});
