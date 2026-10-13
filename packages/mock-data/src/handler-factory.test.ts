/**
 * Tests for the generic MSW dataset handler factory.
 *
 * @remarks
 * Node runtime. Exercised end-to-end through `msw/node`'s `setupServer` + global `fetch` against a
 * tiny synthetic dataset — deliberately NOT the real per-dataset data, so the suite stays fast and
 * deterministic (no 10k generation / large-JSON load at import). Covers pagination defaults +
 * bounds + cap, the `?tier` default/full split (present + not-generated), the `-slow` / `-fail`
 * variants, `/:id` hit + miss, and `/filter-config`.
 */

import type { FilterEngineConfig } from '@filter-enginez/core';

import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BaseRecord } from './shared.js';

import { createDatasetHandlers, type DatasetHandlerOptions } from './handler-factory.js';

/** Five default-tier records (enough to page through). */
const RECORDS: readonly BaseRecord[] = Array.from({ length: 5 }, (_unused, index) => ({
	id: `r${index}`,
	lastUpdated: '2024-01-01T00:00:00.000Z',
	tier: 'default',
}));

/** Eight full-tier records — a distinct set so tier switching is observable. */
const FULL: readonly BaseRecord[] = Array.from({ length: 8 }, (_unused, index) => ({
	id: `f${index}`,
	lastUpdated: '2024-06-01T00:00:00.000Z',
	tier: 'full',
}));

/** Minimal valid engine config for the `/filter-config` endpoint. */
const CONFIG: FilterEngineConfig = { label: 'test', rules: [], version: 1 };

const server = setupServer();

beforeAll(() => {
	server.listen();
});
afterEach(() => {
	server.resetHandlers();
});
afterAll(() => {
	server.close();
});

/** Register the standard handler set, with optional per-test overrides. */
function useHandlers(overrides: Partial<DatasetHandlerOptions<BaseRecord>> = {}): void {
	server.use(
		...createDatasetHandlers<BaseRecord>({
			// Absolute base URL: `setupServer` in the Node test env has no `location` to resolve a
			// relative path against, so MSW would pass a relative-path request through. `basePath` is
			// just interpolated by the factory, so an absolute base tests identical routing logic.
			basePath: 'http://localhost/api/test',
			loadDefaultRecords: async () => Promise.resolve(RECORDS),
			loadFilterConfig: async () => Promise.resolve(CONFIG),
			loadFullRecords: async () => Promise.resolve(FULL),
			...overrides,
		}),
	);
}

const get = async (path: string): Promise<Response> => fetch(`http://localhost${path}`);

describe('createDatasetHandlers — /filter-config', () => {
	it('serves the engine config JSON', async () => {
		useHandlers();
		const res = await get('/api/test/filter-config');

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual(CONFIG);
	});
});

describe('createDatasetHandlers — list + pagination', () => {
	it('returns the default tier with default pagination', async () => {
		useHandlers();
		const res = await get('/api/test');

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ items: RECORDS, limit: 50, offset: 0, total: 5 });
	});

	it('slices by limit + offset', async () => {
		useHandlers();
		const body = (await (await get('/api/test?limit=2&offset=1')).json()) as { items: BaseRecord[] };

		expect(body.items.map((r) => r.id)).toEqual(['r1', 'r2']);
	});

	it('caps limit at 500 and floors garbage/negative params to their defaults', async () => {
		useHandlers();
		const capped = (await (await get('/api/test?limit=9999')).json()) as { limit: number };

		expect(capped.limit).toBe(500);

		const garbage = (await (await get('/api/test?limit=abc&offset=-5')).json()) as {
			limit: number;
			offset: number;
		};

		expect(garbage).toMatchObject({ limit: 50, offset: 0 });
	});

	it('serves the full tier when the loader resolves records', async () => {
		useHandlers();
		const body = (await (await get('/api/test?tier=full')).json()) as { items: BaseRecord[]; total: number };

		expect(body.total).toBe(8);
		expect(body.items[0]?.id).toBe('f0');
	});

	it('404s the full tier with a recovery hint when it is not generated', async () => {
		useHandlers({ loadFullRecords: async () => Promise.resolve(null) });
		const res = await get('/api/test?tier=full');

		expect(res.status).toBe(404);
		expect(await res.json()).toMatchObject({ code: 'DATASET_NOT_GENERATED' });
	});
});

describe('createDatasetHandlers — variants', () => {
	it('serves the -slow variant after the (default 2000ms) delay', async () => {
		vi.useFakeTimers();
		try {
			useHandlers(); // no slowDelayMs → exercises the 2000ms default
			const pending = get('/api/test-slow');

			await vi.advanceTimersByTimeAsync(2000);
			const res = await pending;
			const body = (await res.json()) as { total: number };

			expect(res.status).toBe(200);
			expect(body.total).toBe(5);
		} finally {
			vi.useRealTimers();
		}
	});

	it('always 503s the -fail variant', async () => {
		useHandlers();
		const res = await get('/api/test-fail');

		expect(res.status).toBe(503);
		expect(await res.json()).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
	});
});

describe('createDatasetHandlers — /:id', () => {
	it('returns a single record by id', async () => {
		useHandlers();
		const res = await get('/api/test/r3');
		const body = (await res.json()) as { id: string };

		expect(res.status).toBe(200);
		expect(body.id).toBe('r3');
	});

	it('404s an unknown id with a descriptive body', async () => {
		useHandlers();
		const res = await get('/api/test/nope');

		expect(res.status).toBe(404);
		expect(await res.json()).toMatchObject({ code: 'NOT_FOUND' });
	});
});

describe('createDatasetHandlers — lazy loaders are memoized', () => {
	it('calls loadDefaultRecords once across list + /:id requests', async () => {
		const loadDefaultRecords = vi.fn(async () => Promise.resolve(RECORDS));

		useHandlers({ loadDefaultRecords });
		await get('/api/test');
		await get('/api/test?limit=2&offset=1');
		await get('/api/test/r3');

		expect(loadDefaultRecords).toHaveBeenCalledTimes(1);
	});

	it('calls loadFilterConfig once across repeated /filter-config requests', async () => {
		const loadFilterConfig = vi.fn(async () => Promise.resolve(CONFIG));

		useHandlers({ loadFilterConfig });
		await get('/api/test/filter-config');
		await get('/api/test/filter-config');

		expect(loadFilterConfig).toHaveBeenCalledTimes(1);
		// The config is still served correctly from the memoized promise.
		expect(await (await get('/api/test/filter-config')).json()).toEqual(CONFIG);
	});
});

describe('createDatasetHandlers — pageDelayMs (streaming realism)', () => {
	it('delays the list response by pageDelayMs when set', async () => {
		vi.useFakeTimers();
		try {
			useHandlers({ pageDelayMs: 300 });
			const pending = get('/api/test');
			let hasSettled = false;

			void pending.then(() => (hasSettled = true));
			// Flush the awaited memoized default-records promise without advancing the delay timer.
			await vi.advanceTimersByTimeAsync(0);
			expect(hasSettled).toBe(false);

			await vi.advanceTimersByTimeAsync(300);
			const body = (await pending).status;

			expect(body).toBe(200);
		} finally {
			vi.useRealTimers();
		}
	});

	it('does not delay by default (pageDelayMs = 0)', async () => {
		useHandlers();
		const res = await get('/api/test');

		expect(res.status).toBe(200);
		expect((await res.json()) as { total: number }).toMatchObject({ total: 5 });
	});
});
