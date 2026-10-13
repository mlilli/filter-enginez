/**
 * @remarks
 * Type-level + usage test for the `StorageAdapter` contract (`StorageAdapter.ts` is types-only:
 * `MaybePromise<T>` + the `StorageAdapter` interface). Asserts a hand-rolled implementation
 * satisfies the three-method contract for both synchronous and Promise-returning adapters, and
 * that `MaybePromise` accepts both a plain value and a Promise via an awaited round-trip.
 */

import { describe, expect, it } from 'vitest';

import type { MaybePromise, StorageAdapter } from './StorageAdapter.js';

/** A synchronous adapter satisfying the contract. */
class SyncAdapter implements StorageAdapter {
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

/** A Promise-returning adapter satisfying the same contract. */
class AsyncAdapter implements StorageAdapter {
	private readonly _store = new Map<string, unknown>();

	async load(key: string): Promise<unknown> {
		return Promise.resolve(this._store.has(key) ? this._store.get(key) : null);
	}

	async remove(key: string): Promise<void> {
		this._store.delete(key);

		return Promise.resolve();
	}

	async save(key: string, value: unknown): Promise<void> {
		this._store.set(key, value);

		return Promise.resolve();
	}
}

describe('StorageAdapter contract', () => {
	it('a synchronous adapter satisfies the interface', async () => {
		const adapter: StorageAdapter = new SyncAdapter();

		await adapter.save('k', 42);

		expect(await adapter.load('k')).toBe(42);

		await adapter.remove('k');

		expect(await adapter.load('k')).toBeNull();
	});

	it('an async adapter satisfies the same interface', async () => {
		const adapter: StorageAdapter = new AsyncAdapter();

		await adapter.save('k', 'v');

		expect(await adapter.load('k')).toBe('v');
	});

	it('MaybePromise accepts both a plain value and a Promise', async () => {
		const plain: MaybePromise<number> = 1;
		const promised: MaybePromise<number> = Promise.resolve(2);

		// `await Promise.resolve(x)` is the idiomatic normalizer for a `MaybePromise<T>` —
		// it unwraps a thenable and passes a plain value straight through.
		expect(await Promise.resolve(plain)).toBe(1);
		expect(await Promise.resolve(promised)).toBe(2);
	});
});
