/**
 * @remarks
 * Behavior-asserting unit tests for the roaring-wasm init adapter
 * ({@link initializeBitmapAcceleration}, {@link isBitmapAccelerationReady},
 * {@link getRoaringBitmap32} and {@link createRoaringBitmap}). Exercises the full init state
 * machine — `unstarted` -> `pending` -> `ready` and `unstarted` -> `pending` -> `failed` — plus
 * idempotency (resolve-immediately when already ready, throw-on-retry when failed, shared
 * promise while pending), the on-demand load of the library itself, and the error a bitmap
 * request raises in each state before `ready`.
 *
 * The module carries singleton module-level state, so each scenario uses `vi.resetModules()`
 * and a dynamic `await import()` to start the state machine fresh. `roaring-wasm` is replaced
 * wholesale with a controllable manual mock — its `roaringLibraryInitialize` resolves or
 * rejects on demand, its `RoaringBitmap32` is a minimal constructable stub, and the factory
 * counts how often the module is loaded (or fails to load, like a chunk fetch that errors).
 * This suite is the ONLY internals test that mocks `roaring-wasm`; every sibling suite imports
 * the genuine library, and Vitest scopes module mocks per test-file, so the stub never leaks.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Controllable hoisted mock state for `roaring-wasm`, settable before each module load. */
const mockState = vi.hoisted(() => ({
	/** The init implementation the next module load will observe. */
	initialize: async (): Promise<void> => {
		await Promise.resolve();
	},
	/** When set, loading the module throws this — a library chunk that fails to fetch. */
	loadFailure: undefined as Error | undefined,
	/** How many times the module has been evaluated since the last reset. */
	loads: 0,
}));

/** Minimal constructable stand-in for the WASM-backed bitmap class (re-export test only). */
class StubRoaringBitmap32 {
	constructor(public readonly values: readonly number[] = []) {}

	get size(): number {
		return this.values.length;
	}
}

/**
 * The stand-in for `roaring-wasm`, registered afresh by {@link loadFreshModule} so each scenario
 * observes its own load: it counts evaluations and can fail like a chunk that does not fetch.
 *
 * @returns The mocked module namespace
 */
function roaringWasmFactory(): { RoaringBitmap32: typeof StubRoaringBitmap32; roaringLibraryInitialize: () => Promise<void> } {
	if (mockState.loadFailure !== undefined) {
		throw mockState.loadFailure;
	}
	mockState.loads++;

	return {
		RoaringBitmap32: StubRoaringBitmap32,
		roaringLibraryInitialize: async (): Promise<void> => mockState.initialize(),
	};
}

/** The module-under-test's public surface, narrowed for the dynamic-import call sites. */
interface RoaringInitModule {
	createRoaringBitmap: () => unknown;
	getRoaringBitmap32: () => unknown;
	initializeBitmapAcceleration: () => Promise<void>;
	isBitmapAccelerationReady: () => boolean;
}

/** Load a fresh copy of the module-under-test (singleton `initState` resets to `unstarted`). */
async function loadFreshModule(): Promise<RoaringInitModule> {
	vi.resetModules();
	// `doMock`, not a hoisted `vi.mock`: a hoisted factory's result outlives `resetModules`, so the
	// load counter and the load failure below would only ever see the first scenario's load.
	vi.doMock('roaring-wasm', roaringWasmFactory);

	return import('./roaringInit.js');
}

/**
 * Resolve once the mocked library's init has been called — it runs only after the dynamic import
 * of the library settles, a few microtasks after `initializeBitmapAcceleration()` returns.
 *
 * @param isCalled - Reports whether the init has been called yet
 */
async function untilLibraryInitCalled(isCalled: () => boolean): Promise<void> {
	await vi.waitFor(() => {
		expect(isCalled()).toBe(true);
	});
}

beforeEach(() => {
	mockState.initialize = async (): Promise<void> => {
		await Promise.resolve();
	};
	mockState.loadFailure = undefined;
	mockState.loads = 0;
});

afterEach(() => {
	vi.doUnmock('roaring-wasm');
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

		await untilLibraryInitCalled(() => release !== undefined);
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

		await untilLibraryInitCalled(() => release !== undefined);

		// While pending, the second caller reuses the cached promise — one library load, one WASM init.
		expect(initialize).toHaveBeenCalledTimes(1);
		expect(mockState.loads).toBe(1);

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

describe('loading roaring-wasm on demand', () => {
	it('does not load the library when the adapter is imported, only when init runs', async () => {
		const mod = await loadFreshModule();

		// Importing the adapter (and with it the whole engine) must not evaluate the library: that is
		// what keeps it out of an app that never enables bitmaps.
		expect(mockState.loads).toBe(0);

		await mod.initializeBitmapAcceleration();

		expect(mockState.loads).toBe(1);
	});

	it('fails init with ACCELERATION_INIT_FAILED when the library itself does not load', async () => {
		const failure = new Error('chunk fetch failed');

		mockState.loadFailure = failure;
		const mod = await loadFreshModule();
		const error: unknown = await mod.initializeBitmapAcceleration().then(
			() => undefined,
			(rejection: unknown) => rejection,
		);

		expect(error).toMatchObject({
			code: 'ACCELERATION_INIT_FAILED',
			message: expect.stringContaining('roaring-wasm or its WASM module failed to load') as unknown,
		});
		// The import's rejection is the `cause`. Vitest reports a throwing mock factory as its own
		// error with the factory's error as `cause`, so the original failure sits one level down.
		expect((error as { cause?: unknown }).cause).toMatchObject({ cause: failure });
		expect(mod.isBitmapAccelerationReady()).toBe(false);
		expect(mockState.loads).toBe(0);
	});
});

describe('getRoaringBitmap32 / createRoaringBitmap', () => {
	it('returns the constructor of the library init loaded, and builds bitmaps with it', async () => {
		const mod = await loadFreshModule();

		await mod.initializeBitmapAcceleration();

		expect(mod.getRoaringBitmap32()).toBe(StubRoaringBitmap32);
		const bitmap = mod.createRoaringBitmap();

		expect(bitmap).toBeInstanceOf(StubRoaringBitmap32);
		expect((bitmap as StubRoaringBitmap32).size).toBe(0);
	});

	it('throws MODE_ACCELERATION_NOT_READY before init has started', async () => {
		const mod = await loadFreshModule();

		expect(() => mod.getRoaringBitmap32()).toThrow(expect.objectContaining({
			code: 'MODE_ACCELERATION_NOT_READY',
			message: expect.stringContaining('bitmap acceleration is not initialized') as unknown,
			name: 'FilterEngineModeError',
		}));
		expect(() => mod.createRoaringBitmap()).toThrow('Await initializeBitmapAcceleration()');
	});

	it('names the pending state while init is still in flight', async () => {
		let release: (() => void) | undefined;

		mockState.initialize = async (): Promise<void> => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
		};
		const mod = await loadFreshModule();
		const pending = mod.initializeBitmapAcceleration();

		expect(() => mod.createRoaringBitmap()).toThrow(expect.objectContaining({
			code: 'MODE_ACCELERATION_NOT_READY',
			message: expect.stringContaining('bitmap acceleration is still loading') as unknown,
		}));

		await untilLibraryInitCalled(() => release !== undefined);
		release?.();
		await pending;

		expect(mod.createRoaringBitmap()).toBeInstanceOf(StubRoaringBitmap32);
	});

	it('names the failed state after init failed', async () => {
		mockState.initialize = async (): Promise<void> => {
			await Promise.resolve();
			throw new Error('wasm fetch failed');
		};
		const mod = await loadFreshModule();

		await expect(mod.initializeBitmapAcceleration()).rejects.toThrow('failed to load');

		expect(() => mod.getRoaringBitmap32()).toThrow('bitmap acceleration is unavailable, because initializeBitmapAcceleration() failed');
	});
});
