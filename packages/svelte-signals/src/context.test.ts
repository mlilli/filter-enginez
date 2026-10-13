/**
 * Unit tests for the Svelte engine-context helpers.
 *
 * @remarks
 * `getContext` / `setContext` only work during Svelte component initialization, so we mock `svelte`
 * with a plain in-memory map — enough to prove `setFilterEngine` stores under our key and
 * `getFilterEngine` reads it back (and throws when absent) without a component harness.
 *
 * @packageDocumentation
 */

import type { SignalsEngine } from '@filter-enginez/reactive-signals';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getFilterEngine, setFilterEngine } from './context.js';

// `vi.hoisted` so the map exists when the hoisted `vi.mock` factory closes over it.
const { contextStore } = vi.hoisted(() => ({ contextStore: new Map<unknown, unknown>() }));

vi.mock('svelte', () => ({
	getContext: (key: unknown): unknown => contextStore.get(key),
	setContext: (key: unknown, value: unknown): unknown => {
		contextStore.set(key, value);

		return value;
	},
}));

describe('context', () => {
	beforeEach(() => {
		contextStore.clear();
	});

	it('round-trips a provided engine through set/get', () => {
		const engine = { marker: 'fake-engine' } as unknown as SignalsEngine<unknown>;

		setFilterEngine(engine);

		expect(getFilterEngine()).toBe(engine);
	});

	it('throws a clear error when no engine has been provided', () => {
		expect(() => getFilterEngine()).toThrow(expect.objectContaining({
			code: 'BINDING_ENGINE_NOT_PROVIDED',
			message: expect.stringMatching(/no Filter EngineZ engine in context/u) as unknown,
			name: 'FilterEngineConfigError',
		}));
	});
});
