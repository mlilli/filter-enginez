/**
 * Barrel test — asserts the public surface is re-exported (covers `index.ts`).
 *
 * @packageDocumentation
 */

import { describe, expect, it } from 'vitest';

import * as api from './index.js';

describe('@filter-enginez/svelte-signals barrel', () => {
	it('re-exports the public surface', () => {
		expect(typeof api.toStore).toBe('function');
		expect(typeof api.createEngineStores).toBe('function');
		expect(typeof api.busyStore).toBe('function');
		expect(typeof api.setFilterEngine).toBe('function');
		expect(typeof api.getFilterEngine).toBe('function');
	});
});
