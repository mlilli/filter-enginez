/**
 * @remarks
 * Tests for `LocalStorageAdapter`. The adapter reads a `declare const localStorage` browser
 * global; we provide a minimal in-memory `StorageLike` fake via `vi.stubGlobal` so the real
 * code paths execute under the Node test project. Covers namespace scoping, save (JSON
 * serialize), load-hit (JSON parse), load-miss (null), remove, and the malformed-JSON catch
 * fallback to null.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalStorageAdapter } from './LocalStorageAdapter.js';

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
	vi.stubGlobal('localStorage', fake);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('LocalStorageAdapter', () => {
	it('save JSON-serializes the value under a namespaced key', () => {
		const adapter = new LocalStorageAdapter('app');

		adapter.save('filters', { a: 1 });

		expect(fake.map.get('app:filters')).toBe('{"a":1}');
	});

	it('load JSON-parses a stored value on hit', () => {
		const adapter = new LocalStorageAdapter('app');

		adapter.save('filters', { a: 1, b: [2, 3]});

		expect(adapter.load('filters')).toEqual({ a: 1, b: [2, 3]});
	});

	it('load returns null when the namespaced key is absent', () => {
		const adapter = new LocalStorageAdapter('app');

		expect(adapter.load('missing')).toBeNull();
	});

	it('load returns null (catch fallback) when the stored value is malformed JSON', () => {
		const adapter = new LocalStorageAdapter('app');

		fake.map.set('app:filters', '{not valid json');

		expect(adapter.load('filters')).toBeNull();
	});

	it('remove deletes the namespaced key', () => {
		const adapter = new LocalStorageAdapter('app');

		adapter.save('filters', 1);
		adapter.remove('filters');

		expect(fake.map.has('app:filters')).toBe(false);
		expect(adapter.load('filters')).toBeNull();
	});

	it('different namespaces scope to disjoint keys', () => {
		const a = new LocalStorageAdapter('one');
		const b = new LocalStorageAdapter('two');

		a.save('k', 'av');
		b.save('k', 'bv');

		expect(a.load('k')).toBe('av');
		expect(b.load('k')).toBe('bv');
		expect(fake.map.get('one:k')).toBe('"av"');
		expect(fake.map.get('two:k')).toBe('"bv"');
	});
});
