/**
 * @remarks
 * Barrel live-binding test for `storage/index.ts` — asserts the isomorphic entry re-exports
 * `MemoryStorageAdapter` (and only the isomorphic surface; browser adapters live behind the
 * `./browser` sub-export).
 */

import { describe, expect, it } from 'vitest';

import { MemoryStorageAdapter } from './index.js';

describe('storage barrel', () => {
	it('re-exports MemoryStorageAdapter', () => {
		expect(typeof MemoryStorageAdapter).toBe('function');
		expect(new MemoryStorageAdapter().load('x')).toBeNull();
	});
});
