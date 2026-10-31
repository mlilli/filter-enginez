/**
 * @remarks
 * What `initializeBitmapAcceleration()` does when `roaring-wasm`, an optional peer dependency of
 * core, is not installed — and that an engine is unaffected either way.
 *
 * The missing package is simulated by replacing `roaring-wasm` with a mock whose factory throws
 * the error each runtime or bundler raises for an unresolvable module (Node's ES module loader,
 * Node's `require` and webpack's runtime, the three browser engines, Vite's development server), or
 * returns the empty module a bundler substitutes for an absent optional peer. Vitest reports a
 * throwing factory as its own error with the factory's error as `cause`, which is the same shape
 * as any wrapper between the runtime and the engine, so these cases also exercise the walk down
 * the `cause` chain. Each scenario resets the module graph, as `roaringInit.test.ts` does, so the
 * init state machine starts at `unstarted`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The exact message a missing peer produces: the one thing to do about it. */
const PEER_MISSING_MESSAGE = 'Bitmap acceleration needs the optional peer dependency `roaring-wasm`; install it with '
	+ '`npm install roaring-wasm` (or your package manager\'s equivalent).';

/** Controllable mock state for `roaring-wasm`, settable before each module load. */
interface MockState {
	/** When set, loading the module throws this. */
	loadFailure: unknown;
	/** How many times the module has been evaluated since the last reset. */
	loads: number;
	/** When set, loading the module yields this namespace instead of a working library. */
	namespace: Readonly<Record<string, unknown>> | undefined;
}

/** The hoisted mock state, reset before each scenario. */
const mockState = vi.hoisted((): MockState => ({ loadFailure: undefined, loads: 0, namespace: undefined }));

/** A module with neither of the library's exports, as a bundler substitutes for an absent optional peer. */
const EMPTY_MODULE: Readonly<Record<string, unknown>> = { RoaringBitmap32: undefined, roaringLibraryInitialize: undefined };

/** Minimal constructable stand-in for the WASM-backed bitmap class. */
class StubRoaringBitmap32 {
	readonly size = 0;
}

/**
 * The stand-in for `roaring-wasm`: throws {@link mockState.loadFailure} when set, otherwise
 * returns {@link mockState.namespace} or a working library.
 *
 * @returns The mocked module namespace
 */
function roaringWasmFactory(): Record<string, unknown> {
	if (mockState.loadFailure !== undefined) {
		// eslint-disable-next-line @typescript-eslint/only-throw-error -- one scenario rejects with a non-Error value, as some runtimes do
		throw mockState.loadFailure;
	}
	mockState.loads++;

	return mockState.namespace ?? {
		RoaringBitmap32: StubRoaringBitmap32,
		roaringLibraryInitialize: async (): Promise<void> => {
			await Promise.resolve();
		},
	};
}

/** The module-under-test's public surface, narrowed for the dynamic-import call sites. */
interface RoaringInitModule {
	initializeBitmapAcceleration: () => Promise<void>;
	isBitmapAccelerationReady: () => boolean;
}

/**
 * Load a fresh copy of the module graph with `roaring-wasm` mocked.
 *
 * @returns The adapter, its singleton state at `unstarted`
 */
async function loadFreshModule(): Promise<RoaringInitModule> {
	vi.resetModules();
	vi.doMock('roaring-wasm', roaringWasmFactory);

	return import('./roaringInit.js');
}

/**
 * Run init and capture its rejection.
 *
 * @param mod - The adapter
 * @returns What init rejected with, or `undefined` when it resolved
 */
async function initRejection(mod: RoaringInitModule): Promise<unknown> {
	return mod.initializeBitmapAcceleration().then(
		() => undefined,
		(rejection: unknown) => rejection,
	);
}

/**
 * An `Error` with a `code`, as Node and webpack raise for a module they cannot find.
 *
 * @param message - The message
 * @param code - The `code` property
 * @returns The error
 */
function codedError(message: string, code: string): Error {
	return Object.assign(new Error(message), { code });
}

beforeEach(() => {
	mockState.loadFailure = undefined;
	mockState.loads = 0;
	mockState.namespace = undefined;
});

afterEach(() => {
	vi.doUnmock('roaring-wasm');
	vi.resetModules();
});

describe('initializeBitmapAcceleration without roaring-wasm installed', () => {
	it.each([
		[
			'Node ES modules',
			codedError(
				'Cannot find package \'roaring-wasm\' imported from /app/node_modules/@filter-enginez/core/dist/internals/roaringInit.js',
				'ERR_MODULE_NOT_FOUND',
			),
		],
		['Node require and webpack\'s runtime', codedError('Cannot find module \'roaring-wasm\'', 'MODULE_NOT_FOUND')],
		[
			'Chromium',
			new TypeError('Failed to resolve module specifier "roaring-wasm". Relative references must start with either "/", "./", or "../".'),
		],
		[
			'Firefox',
			new TypeError('The specifier “roaring-wasm” was a bare specifier, but was not remapped to anything.'),
		],
		['WebKit', new TypeError('Module name, \'roaring-wasm\' does not resolve to a valid URL.')],
		['Vite\'s development server', new Error('Could not resolve "roaring-wasm" imported by "@filter-enginez/core". Is it installed?')],
		['a resolver that reports "module not found"', new Error('Module not found: roaring-wasm')],
	])('rejects with MODE_ACCELERATION_PEER_MISSING and the install command (%s)', async (_runtime, failure) => {
		mockState.loadFailure = failure;
		const mod = await loadFreshModule();
		const error = await initRejection(mod);

		// Matched structurally: `loadFreshModule` resets the module graph, so the error class here is a
		// fresh copy that a statically imported `FilterEngineModeError` would not be `instanceof`.
		expect(error).toMatchObject({ code: 'MODE_ACCELERATION_PEER_MISSING', name: 'FilterEngineModeError' });
		expect((error as Error).message).toBe(PEER_MISSING_MESSAGE);
		// The resolution error stays reachable for diagnosis, under Vitest's own wrapper.
		expect((error as { cause?: unknown }).cause).toMatchObject({ cause: failure });
		expect(mod.isBitmapAccelerationReady()).toBe(false);
	});

	// The exports are present-but-`undefined` rather than absent: Vitest's module mock throws on any
	// read of an export its factory did not return, where a bundler's empty module reads `undefined`.
	it.each([
		['an empty module, as Vite\'s production build substitutes', EMPTY_MODULE],
		[
			'a module without the bitmap class',
			{ RoaringBitmap32: undefined, roaringLibraryInitialize: async (): Promise<void> => Promise.resolve() },
		],
	])('treats %s as the peer missing', async (_label, namespace) => {
		mockState.namespace = namespace;
		const mod = await loadFreshModule();
		const error = await initRejection(mod);

		expect(error).toMatchObject({ code: 'MODE_ACCELERATION_PEER_MISSING', message: PEER_MISSING_MESSAGE });
		expect('cause' in (error as object)).toBe(false);
		expect(mod.isBitmapAccelerationReady()).toBe(false);
	});

	it('repeats the same error on every later call, without loading again', async () => {
		const failure = codedError('Cannot find module \'roaring-wasm\'', 'MODULE_NOT_FOUND');

		mockState.loadFailure = failure;
		const mod = await loadFreshModule();

		await initRejection(mod);
		mockState.loadFailure = undefined;
		const second = await initRejection(mod);

		expect(second).toMatchObject({ code: 'MODE_ACCELERATION_PEER_MISSING', message: PEER_MISSING_MESSAGE });
		expect((second as { cause?: unknown }).cause).toMatchObject({ cause: failure });
		expect(mockState.loads).toBe(0);
	});

	it('repeats the empty-module case without a cause', async () => {
		mockState.namespace = EMPTY_MODULE;
		const mod = await loadFreshModule();

		await initRejection(mod);
		const second = await initRejection(mod);

		expect(second).toMatchObject({ code: 'MODE_ACCELERATION_PEER_MISSING', message: PEER_MISSING_MESSAGE });
		expect('cause' in (second as object)).toBe(false);
		expect(mockState.loads).toBe(1);
	});
});

describe('initializeBitmapAcceleration — other load failures stay ACCELERATION_INIT_FAILED', () => {
	const selfCaused = new Error('roaring-wasm: unexpected end of input');

	Object.assign(selfCaused, { cause: selfCaused });

	it.each([
		// The library is installed and its chunk did not arrive: reinstalling would not help.
		['a chunk that failed to fetch', new TypeError('Failed to fetch dynamically imported module: https://app.example/assets/roaring-wasm-3f2a.js')],
		// A module-not-found error for some other package is not this one.
		['another package not found', codedError('Cannot find package \'left-pad\' imported from /app/index.js', 'ERR_MODULE_NOT_FOUND')],
		['a module-not-found code without the package name', codedError('Cannot find module', 'MODULE_NOT_FOUND')],
		['a cause chain that ends in null', Object.assign(new Error('roaring-wasm exploded'), { cause: null })],
		['a cause chain that loops', selfCaused],
		['a thrown string', 'Cannot find module \'roaring-wasm\''],
	])('%s', async (_label, failure) => {
		mockState.loadFailure = failure;
		const mod = await loadFreshModule();
		const error = await initRejection(mod);

		expect(error).toMatchObject({ code: 'ACCELERATION_INIT_FAILED', name: 'FilterEngineError' });
		expect(mod.isBitmapAccelerationReady()).toBe(false);
	});
});

describe('engines when roaring-wasm is not installed', () => {
	/** 600 items, above the `'auto'` threshold, alternating two colors. */
	const ITEMS = Array.from({ length: 600 }, (_, index) => ({ color: index % 2 === 0 ? 'red' : 'white', id: index }));

	/**
	 * Build an engine from the current (fresh) module graph and filter it to red items.
	 *
	 * @param bitmap - The `acceleration.bitmap` setting
	 * @returns The red count, the computed result count, and whether the library was loaded
	 */
	async function filterToRed(bitmap: 'auto' | 'on'): Promise<{ readonly computed: number; readonly count: number }> {
		const { createFilterEngine, ValueRule } = await import('../index.js');
		const engine = createFilterEngine<(typeof ITEMS)[number]>({ acceleration: { bitmap }, sourceData: ITEMS });

		engine.addRule('color', new ValueRule('color', 'red'));

		return { computed: engine.computeResults().length, count: engine.getResultCount() };
	}

	it.each(['on', 'auto'] as const)('filter on the predicate path after init failed (bitmap: %s)', async (bitmap) => {
		mockState.loadFailure = codedError('Cannot find module \'roaring-wasm\'', 'MODULE_NOT_FOUND');
		const mod = await loadFreshModule();

		await initRejection(mod);

		expect(await filterToRed(bitmap)).toStrictEqual({ computed: 300, count: 300 });
	});

	it('never load the library when nothing calls init', async () => {
		const mod = await loadFreshModule();

		expect(await filterToRed('on')).toStrictEqual({ computed: 300, count: 300 });
		expect(mod.isBitmapAccelerationReady()).toBe(false);
		expect(mockState.loads).toBe(0);
	});
});
