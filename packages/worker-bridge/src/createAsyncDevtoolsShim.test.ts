/**
 * Tests for `createAsyncDevtoolsShim` — the contract, not the behavior.
 *
 * @remarks
 * **This suite is deliberately NOT a copy of `createAsyncCoreShim.devtools.test.ts`.** That file's
 * 16 tests already exercise every branch of this module through the signals adapter, and they are
 * the behavioral safety net — duplicating them here would be two maintenance costs for one
 * guarantee.
 *
 * What it covers instead is the three things a consumer-side suite structurally cannot see, each of
 * which is a way the SHARED module could regress while serving two consumers (`reactive-signals`
 * and `reactive-rxjs`):
 *
 *   1. **`adapterName` reaches the error message.** The signals tests match the surface name only
 *      (`/diff/u`), so a shim that hardcoded one adapter's name would pass them both — and a shared
 *      error that names the wrong adapter sends the reader to the wrong package, which is the
 *      reason the parameter exists at all.
 *   2. **`applyOptimisticCursor` is called ONCE per mutator, with both cursor fields resolved.**
 *      This is the atomicity contract in assertable form. A future simplification to two setters
 *      would still pass every signals test — `batch()` makes the double-write invisible from the
 *      outside — and would flicker the panel's row tint on the worker tier. Counting the calls is
 *      what makes that regression fail a gate instead of a route.
 *   3. **Surface neutrality.** The context here is plain functions and plain objects: no `Signal`,
 *      no `Observable`, no `batch`. If this file ever needs a reactive primitive to compile, the
 *      module stopped being shareable.
 */

import { describe, expect, it, vi } from 'vitest';

import type { FilterEngineAsync, WireActionLogEntry, WireDevtoolsState } from './FilterEngineAsync.js';

import { type AsyncDevtoolsShim, createAsyncDevtoolsShim } from './createAsyncDevtoolsShim.js';

interface Item {
	readonly price: number;
}

interface Harness {
	readonly applyOptimisticCursor: ReturnType<typeof vi.fn>;
	readonly jumpToDevtoolsIndex: ReturnType<typeof vi.fn>;
	readonly onTimeTravelSettled: ReturnType<typeof vi.fn>;
	readonly redoDevtools: ReturnType<typeof vi.fn>;
	readonly shim: AsyncDevtoolsShim;
	readonly undoDevtools: ReturnType<typeof vi.fn>;
}

/**
 * Build a shim over spies.
 *
 * @remarks
 * The async engine is a three-method stub rather than either adapter's `makeFakeAsyncEngine` — not
 * a third copy of that fake, but the only three methods this module calls. Importing an adapter's
 * fake would invert the dependency direction (`worker-bridge` is upstream of both).
 *
 * @param devtoolsState - The mirrored cursor state the shim reads
 * @param actionLog - The mirrored action log the shim reads
 * @returns The shim plus every spy the assertions need
 */
function makeHarness(
	devtoolsState: WireDevtoolsState,
	actionLog: readonly WireActionLogEntry[] = [],
	adapterName = 'createRxJsEngineFromAsync',
): Harness {
	const jumpToDevtoolsIndex = vi.fn(async () => Promise.resolve());
	const redoDevtools = vi.fn(async () => Promise.resolve());
	const undoDevtools = vi.fn(async () => Promise.resolve());
	const applyOptimisticCursor = vi.fn();
	const onTimeTravelSettled = vi.fn();
	const asyncEngine = {
		jumpToDevtoolsIndex,
		redoDevtools,
		undoDevtools,
	} as unknown as FilterEngineAsync<Item>;

	return {
		applyOptimisticCursor,
		jumpToDevtoolsIndex,
		onTimeTravelSettled,
		redoDevtools,
		shim: createAsyncDevtoolsShim<Item>({
			adapterName,
			applyOptimisticCursor,
			asyncEngine,
			getActionLog: () => actionLog,
			getDevtoolsState: () => devtoolsState,
			onTimeTravelSettled,
		}),
		undoDevtools,
	};
}

describe('createAsyncDevtoolsShim — adapterName in unsupported errors', () => {
	it('names the calling adapter, not a hardcoded one', () => {
		const rxjs = makeHarness({ canRedo: false, canUndo: false, currentIndex: -1, total: 0 });
		const signals = makeHarness(
			{ canRedo: false, canUndo: false, currentIndex: -1, total: 0 },
			[],
			'createSignalsEngineFromAsync',
		);

		expect(() => rxjs.shim.diff()).toThrow(/^createRxJsEngineFromAsync: /u);
		expect(() => signals.shim.diff()).toThrow(/^createSignalsEngineFromAsync: /u);
		expect(() => signals.shim.diff()).toThrow(expect.objectContaining({ code: 'MODE_WORKER_UNSUPPORTED', name: 'FilterEngineModeError' }));
	});

	it('carries the adapter name through the nested actionLog surfaces too', () => {
		const { shim } = makeHarness({ canRedo: false, canUndo: false, currentIndex: -1, total: 0 });

		expect(() => shim.actionLog.append()).toThrow(/^createRxJsEngineFromAsync: /u);
		expect(() => shim.actionLog.append()).toThrow(/actionLog\.append/u);
	});
});

describe('createAsyncDevtoolsShim — the atomicity contract', () => {
	it('applies the cursor in exactly ONE call per mutator, both fields resolved', () => {
		// The count is the assertion. Two setters would satisfy every value-based check while
		// splitting one update the panel reads as atomic — see the module docblock.
		const jump = makeHarness({ canRedo: true, canUndo: true, currentIndex: 2, total: 5 });

		jump.shim.jumpTo(1);
		expect(jump.applyOptimisticCursor).toHaveBeenCalledTimes(1);
		expect(jump.applyOptimisticCursor).toHaveBeenCalledWith({
			canRedo: true,
			canUndo: true,
			currentIndex: 1,
			total: 5,
		});

		const undo = makeHarness({ canRedo: false, canUndo: true, currentIndex: 0, total: 3 });

		undo.shim.undo();
		expect(undo.applyOptimisticCursor).toHaveBeenCalledTimes(1);
		expect(undo.applyOptimisticCursor).toHaveBeenCalledWith({
			canRedo: true,
			canUndo: false,
			currentIndex: -1,
			total: 3,
		});

		const redo = makeHarness({ canRedo: true, canUndo: false, currentIndex: -1, total: 3 });

		redo.shim.redo();
		expect(redo.applyOptimisticCursor).toHaveBeenCalledTimes(1);
		expect(redo.applyOptimisticCursor).toHaveBeenCalledWith({
			canRedo: true,
			canUndo: true,
			currentIndex: 0,
			total: 3,
		});
	});

	it('never touches the cursor when the mutator is a no-op', () => {
		const noUndo = makeHarness({ canRedo: true, canUndo: false, currentIndex: -1, total: 3 });
		const noRedo = makeHarness({ canRedo: false, canUndo: true, currentIndex: 2, total: 3 });

		noUndo.shim.undo();
		noRedo.shim.redo();

		expect(noUndo.applyOptimisticCursor).not.toHaveBeenCalled();
		expect(noUndo.undoDevtools).not.toHaveBeenCalled();
		expect(noRedo.applyOptimisticCursor).not.toHaveBeenCalled();
		expect(noRedo.redoDevtools).not.toHaveBeenCalled();
	});
});

describe('createAsyncDevtoolsShim — clamping is local, not authoritative', () => {
	it('paints the clamped cursor but sends the UNCLAMPED index over the wire', () => {
		// The worker's TimeTravel owns the bound. Pre-clamping here would make the main thread's
		// idea of the log length authoritative over the engine's.
		const { applyOptimisticCursor, jumpToDevtoolsIndex, shim } = makeHarness({
			canRedo: true,
			canUndo: true,
			currentIndex: 2,
			total: 5,
		});

		shim.jumpTo(-9);

		expect(applyOptimisticCursor).toHaveBeenCalledWith({
			canRedo: true,
			canUndo: false,
			currentIndex: -1,
			total: 5,
		});
		expect(jumpToDevtoolsIndex).toHaveBeenCalledWith(-9);
	});
});
