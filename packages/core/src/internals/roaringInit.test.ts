/**
 * @remarks
 * Behavior-asserting unit tests for the roaring-wasm init adapter
 * ({@link initializeBitmapAcceleration}, {@link isBitmapAccelerationReady}, and the
 * `RoaringBitmap32` re-export). Exercises the full init state machine —
 * `unstarted` -> `pending` -> `ready` and `unstarted` -> `pending` -> `failed` — plus
 * idempotency (resolve-immediately when already ready, throw-on-retry when failed, shared
 * promise while pending).
 *
 * The module carries singleton module-level state, so each scenario uses `vi.resetModules()`
 * and a dynamic `await import()` to start the state machine fresh. `roaring-wasm` is replaced
 * wholesale with a controllable manual mock — its `roaringLibraryInitialize` resolves or
 * rejects on demand and its `RoaringBitmap32` is a minimal constructable stub. This suite is
 * the ONLY internals test that mocks `roaring-wasm`; every sibling suite imports the genuine
 * library, and Vitest scopes module mocks per test-file, so the stub never leaks.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Controllable hoisted mock state for `roaring-wasm`, settable before each module load. */
const mockState = vi.hoisted(() => ({
	/** The init implementation the next module load will observe. */
	initialize: async (): Promise<void> => {
		await Promise.resolve();
	},
}));

/** Minimal constructable stand-in for the WASM-backed bitmap class (re-export test only). */
class StubRoaringBitmap32 {
	constructor(public readonly values: readonly number[] = []) {}

	get size(): number {
		return this.values.length;
	}
}

vi.mock('roaring-wasm', () => ({
	RoaringBitmap32: StubRoaringBitmap32,
	roaringLibraryInitialize: async (): Promise<void> => mockState.initialize(),
}));

/** The module-under-test's public surface, narrowed for the dynamic-import call sites. */
interface RoaringInitModule {
	initializeBitmapAcceleration: () => Promise<void>;
	isBitmapAccelerationReady: () => boolean;
	RoaringBitmap32: unknown;
}

/** Load a fresh copy of the module-under-test (singleton `initState` resets to `unstarted`). */
async function loadFreshModule(): Promise<RoaringInitModule> {
	vi.resetModules();

	return import('./roaringInit.js');
}

beforeEach(() => {
	mockState.initialize = async (): Promise<void> => {
		await Promise.resolve();
	};
});

afterEach(() => {
	vi.resetModules();
});

describe('isBitmapAccelerationReady', () => {
	it('reports false before init starts', async () => {
		const mod = await loadFreshModule();

		expect(mod.isBitmapAccelerationReady()).toBe(false);
	});

	it('reports false while init is pending and true once resolved', async () => {
		let release: (() => void) | undefined;

		mockState.initialize = async (): Promise<void> => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
		};
		const mod = await loadFreshModule();

		const pending = mod.initializeBitmapAcceleration();

		expect(mod.isBitmapAccelerationReady()).toBe(false);

		release?.();
		await pending;

		expect(mod.isBitmapAccelerationReady()).toBe(true);
	});
});

describe('initializeBitmapAcceleration — happy path', () => {
	it('transitions unstarted -> pending -> ready', async () => {
		const initialize = vi.fn(async (): Promise<void> => {
			await Promise.resolve();
		});

		mockState.initialize = initialize;
		const mod = await loadFreshModule();

		await mod.initializeBitmapAcceleration();

		expect(mod.isBitmapAccelerationReady()).toBe(true);
		expect(initialize).toHaveBeenCalledTimes(1);
	});

	it('resolves immediately and does not re-init when already ready', async () => {
		const initialize = vi.fn(async (): Promise<void> => {
			await Promise.resolve();
		});

		mockState.initialize = initialize;
		const mod = await loadFreshModule();

		await mod.initializeBitmapAcceleration();
		await mod.initializeBitmapAcceleration();

		// The ready-state short-circuit means the underlying library init runs exactly once.
		expect(initialize).toHaveBeenCalledTimes(1);
	});

	it('shares a single in-flight promise across concurrent callers', async () => {
		let release: (() => void) | undefined;
		const initialize = vi.fn(async (): Promise<void> => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
		});

		mockState.initialize = initialize;
		const mod = await loadFreshModule();

		const first = mod.initializeBitmapAcceleration();
		const second = mod.initializeBitmapAcceleration();

		// While pending, the second caller reuses the cached promise — no duplicate WASM load.
		expect(initialize).toHaveBeenCalledTimes(1);

		release?.();
		await Promise.all([first, second]);

		expect(mod.isBitmapAccelerationReady()).toBe(true);
	});
});

describe('initializeBitmapAcceleration — failure path', () => {
	it('transitions to failed and rejects with ACCELERATION_INIT_FAILED, the original rejection as cause', async () => {
		const cause = new Error('wasm fetch failed');

		mockState.initialize = async (): Promise<void> => {
			await Promise.resolve();
			throw cause;
		};
		const mod = await loadFreshModule();

		// Matched structurally: `loadFreshModule` resets the module graph, so the error class here is
		// a fresh copy that a statically imported `FilterEngineError` would not be `instanceof`.
		await expect(mod.initializeBitmapAcceleration()).rejects.toMatchObject({
			cause,
			code: 'ACCELERATION_INIT_FAILED',
			name: 'FilterEngineError',
		});
		expect(mod.isBitmapAccelerationReady()).toBe(false);
	});

	it('is terminal — a subsequent call throws the prior-failure error without retrying', async () => {
		const initialize = vi.fn(async (): Promise<void> => {
			await Promise.resolve();
			throw new Error('wasm fetch failed');
		});

		mockState.initialize = initialize;
		const mod = await loadFreshModule();

		await expect(mod.initializeBitmapAcceleration()).rejects.toThrow('failed to load');

		// Second attempt: the failed branch throws synchronously and never calls the library again —
		// and still carries the first attempt's rejection as `cause`, the only record of WHY.
		await expect(mod.initializeBitmapAcceleration()).rejects.toMatchObject({
			cause: expect.objectContaining({ message: 'wasm fetch failed' }) as unknown,
			code: 'ACCELERATION_INIT_FAILED',
			message: expect.stringContaining('a prior init attempt failed') as unknown,
		});
		expect(initialize).toHaveBeenCalledTimes(1);
	});
});

describe('RoaringBitmap32 re-export', () => {
	it('re-exports the underlying library constructor (live binding)', async () => {
		const mod = await loadFreshModule();

		// The re-export points at whatever `roaring-wasm` exports (here, the stub).
		expect(mod.RoaringBitmap32).toBe(StubRoaringBitmap32);
		const Ctor = mod.RoaringBitmap32 as typeof StubRoaringBitmap32;
		const bitmap = new Ctor([1, 2, 3]);

		expect(bitmap.size).toBe(3);
	});
});
