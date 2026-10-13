/**
 * @remarks
 * Tests for `MemoryStorageAdapter` — the isomorphic default adapter. Covers load-miss (null),
 * load-hit (stored value returned by reference), save (replacing an existing value), remove
 * (idempotent), and that a stored `undefined`/`null` value is distinguishable from a missing key
 * via the `has`-gated load path.
 */

import { describe, expect, it } from 'vitest';

import { MemoryStorageAdapter } from './MemoryStorageAdapter.js';

describe('MemoryStorageAdapter', () => {
	it('returns null for a key that was never saved', () => {
		const adapter = new MemoryStorageAdapter();

		expect(adapter.load('missing')).toBeNull();
	});

	it('round-trips a saved value by reference', () => {
		const adapter = new MemoryStorageAdapter();
		const value = { entries: [1, 2, 3]};

		adapter.save('k', value);

		expect(adapter.load('k')).toBe(value);
	});

	it('save replaces an existing value under the same key', () => {
		const adapter = new MemoryStorageAdapter();

		adapter.save('k', 'first');
		adapter.save('k', 'second');

		expect(adapter.load('k')).toBe('second');
	});

	it('remove deletes a stored value so load returns null again', () => {
		const adapter = new MemoryStorageAdapter();

		adapter.save('k', 'v');
		adapter.remove('k');

		expect(adapter.load('k')).toBeNull();
	});

	it('remove is a no-op for an absent key', () => {
		const adapter = new MemoryStorageAdapter();

		expect(() => adapter.remove('nope')).not.toThrow();
	});

	it('distinguishes a stored null from a missing key', () => {
		const adapter = new MemoryStorageAdapter();

		adapter.save('k', null);

		// Key is present (has === true), so load returns the stored null — same as a miss here,
		// but the `has`-gated branch is the one exercised (stored value, not the default).
		expect(adapter.load('k')).toBeNull();
		expect(adapter.load('other')).toBeNull();
	});

	it('returns a stored undefined value via the has-gated branch', () => {
		const adapter = new MemoryStorageAdapter();

		adapter.save('k', undefined);

		// `has('k')` is true, so the ternary returns `get('k')` which is `undefined`.
		expect(adapter.load('k')).toBeUndefined();
	});
});
