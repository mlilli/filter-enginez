/**
 * @remarks
 * Barrel live-binding test for `storage/browser/index.ts` — asserts the browser sub-export
 * surfaces all three browser-only adapters.
 */

import { describe, expect, it } from 'vitest';

import { IndexedDBAdapter, LocalStorageAdapter, SessionStorageAdapter } from './index.js';

describe('storage/browser barrel', () => {
	it('re-exports the three browser adapters', () => {
		expect(typeof LocalStorageAdapter).toBe('function');
		expect(typeof SessionStorageAdapter).toBe('function');
		expect(typeof IndexedDBAdapter).toBe('function');
	});
});
