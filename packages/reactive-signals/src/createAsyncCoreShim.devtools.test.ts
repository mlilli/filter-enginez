/**
 * Tests for the `devtools` surface of `createAsyncCoreShim` — the locally-mirrored,
 * synchronously-readable action log + cursor view plus the optimistic-then-confirmed
 * time-travel mutations (jumpTo / undo / redo).
 *
 * @remarks
 * Split from `createAsyncCoreShim.test.ts` to keep both files under the 500-line cap. Covers
 * the action-log read wrapper (toArray / size / currentIndex / get / maxEntries / iterator and
 * its unsupported mutators), the canRedo/canUndo/currentIndex getters, the no-op init/destroy,
 * the persistence/reduxBridge nulls, the unsupported deep methods, and the two-phase time-travel
 * flow: synchronous optimistic cursor batch + fire-and-forget worker call + `bumpAfterTimeTravel`
 * chaining (which refreshes mirrors and sets a `{ type: 'reset' }` lastChange). The
 * post-await disposal guard inside `bumpAfterTimeTravel` is covered by flipping disposed before
 * the time-travel promise resolves.
 */

import type { WireActionLogEntry, WireDevtoolsState } from '@filter-enginez/worker-bridge';

import {
	type ChangeEvent,
	type CompositeRule,
	type FilterGroup,
	type FilterRule,
	type RuleId,
} from '@filter-enginez/core';
import { signal } from '@preact/signals-core';
import { describe, expect, it, vi } from 'vitest';

import { type AsyncCoreShimContext, createAsyncCoreShim } from './createAsyncCoreShim.js';
import { type FakeAsyncEngine, makeFakeAsyncEngine } from './fakeAsyncEngine.js';

interface Item {
	readonly price: number;
}

interface DevtoolsLike {
	readonly actionLog: {
		[Symbol.iterator]: () => Iterator<WireActionLogEntry>;
		append: () => never;
		clear: () => never;
		readonly currentIndex: number;
		get: (i: number) => WireActionLogEntry | undefined;
		readonly maxEntries: number;
		setCurrentIndex: () => never;
		readonly size: number;
		toArray: () => readonly WireActionLogEntry[];
	};
	readonly canRedo: boolean;
	readonly canUndo: boolean;
	readonly currentIndex: number;
	destroy: () => Promise<void>;
	diff: () => never;
	init: () => Promise<void>;
	jumpTo: (index: number) => void;
	readonly persistence: unknown;
	recordAction: () => never;
	redo: () => void;
	readonly reduxBridge: unknown;
	replay: () => never;
	readonly replayer: unknown;
	readonly timeTravel: unknown;
	undo: () => void;
}

interface Harness {
	readonly core: ReturnType<typeof createAsyncCoreShim<Item>>;
	readonly ctx: AsyncCoreShimContext<Item>;
	readonly devtools: DevtoolsLike;
	readonly fake: FakeAsyncEngine<Item>;
	readonly refreshDevtoolsCalls: { count: number };
	readonly refreshEverythingCalls: { count: number };
	readonly setDisposed: (flag: boolean) => void;
}

function makeHarness(devtoolsState: WireDevtoolsState, actionLog: readonly WireActionLogEntry[] = []): Harness {
	const fake = makeFakeAsyncEngine<Item>();
	let isDisposed = false;
	const refreshEverythingCalls = { count: 0 };
	const refreshDevtoolsCalls = { count: 0 };
	const ctx: AsyncCoreShimContext<Item> = {
		actionLogSignal: signal<readonly WireActionLogEntry[]>(actionLog),
		activeRuleIdsSignal: signal<readonly RuleId[]>([]),
		activeRulesSignal: signal<ReadonlyMap<RuleId, FilterRule>>(new Map()),
		asyncEngine: fake.engine,
		devtoolsStateSignal: signal<WireDevtoolsState>(devtoolsState),
		expressionSignal: signal<CompositeRule | null>(null),
		getIsDisposed: () => isDisposed,
		groupsSignal: signal<readonly FilterGroup[]>([]),
		lastChangeEventSignal: signal<ChangeEvent | null>(null),
		lastChangeRuleIdSignal: signal<RuleId | null>(null),
		lastChangeTimestampSignal: signal<number | null>(null),
		refreshDevtools: async () => {
			refreshDevtoolsCalls.count += 1;

			return Promise.resolve();
		},
		refreshEverything: async () => {
			refreshEverythingCalls.count += 1;

			return Promise.resolve();
		},
		resultCountSignal: signal<number>(0),
		resultsSignal: signal<readonly Item[]>([]),
		sourceDataSignal: signal<readonly Item[]>([]),
	};
	const core = createAsyncCoreShim<Item>(ctx);

	return {
		core,
		ctx,
		devtools: (core as unknown as { devtools: DevtoolsLike }).devtools,
		fake,
		refreshDevtoolsCalls,
		refreshEverythingCalls,
		setDisposed: (value: boolean): void => {
			isDisposed = value;
		},
	};
}

/**
 * Flush the time-travel `.then(bumpAfterTimeTravel)` chain. A macrotask boundary drains every
 * queued microtask (the worker call's `.then`, the parallel refresh `Promise.all`, and the
 * async getters' extra unwrap ticks); a couple of microtask ticks settle the tail.
 */
async function flush(): Promise<void> {
	await new Promise((resolve) => {
		setTimeout(resolve, 0);
	});
	await Promise.resolve();
	await Promise.resolve();
}

describe('createAsyncCoreShim devtools', () => {
	describe('actionLog read wrapper', () => {
		it('exposes toArray / size / currentIndex / get / maxEntries / iterator', () => {
			const log: readonly WireActionLogEntry[] = [
				{ summary: 'a', timestamp: 1, type: 'RULE_ADDED' },
				{ summary: 'b', timestamp: 2, type: 'RULE_REMOVED' },
			];
			const { devtools } = makeHarness(
				{ canRedo: false, canUndo: true, currentIndex: 1, total: 2 },
				log,
			);
			const { actionLog } = devtools;

			expect(actionLog.toArray()).toEqual(log);
			expect(actionLog.size).toBe(2);
			expect(actionLog.currentIndex).toBe(1);
			expect(actionLog.get(0)).toEqual(log[0]);
			expect(actionLog.maxEntries).toBe(Infinity);
			expect([...actionLog]).toEqual(log);
		});

		it('throws via devtoolsUnsupported for append / clear / setCurrentIndex', () => {
			const { devtools } = makeHarness({ canRedo: false, canUndo: false, currentIndex: -1, total: 0 });
			const { actionLog } = devtools;

			expect(() => actionLog.append()).toThrow(/actionLog\.append/u);
			expect(() => actionLog.clear()).toThrow(/actionLog\.clear/u);
			expect(() => actionLog.setCurrentIndex()).toThrow(/actionLog\.setCurrentIndex/u);
		});
	});

	describe('cursor getters', () => {
		it('reads canRedo / canUndo / currentIndex from the devtools state signal', () => {
			const { ctx, devtools } = makeHarness({
				canRedo: true,
				canUndo: true,
				currentIndex: 3,
				total: 6,
			});

			expect(devtools.canRedo).toBe(true);
			expect(devtools.canUndo).toBe(true);
			expect(devtools.currentIndex).toBe(3);

			ctx.devtoolsStateSignal.value = { canRedo: false, canUndo: false, currentIndex: -1, total: 6 };
			expect(devtools.canRedo).toBe(false);
			expect(devtools.canUndo).toBe(false);
			expect(devtools.currentIndex).toBe(-1);
		});
	});

	describe('no-op + null surfaces', () => {
		it('init / destroy resolve as no-ops; persistence / reduxBridge are null', async () => {
			const { devtools } = makeHarness({ canRedo: false, canUndo: false, currentIndex: -1, total: 0 });

			await expect(devtools.init()).resolves.toBeUndefined();
			await expect(devtools.destroy()).resolves.toBeUndefined();
			expect(devtools.persistence).toBeNull();
			expect(devtools.reduxBridge).toBeNull();
		});

		it('diff / replay / recordAction / replayer / timeTravel throw devtoolsUnsupported', () => {
			const { devtools } = makeHarness({ canRedo: false, canUndo: false, currentIndex: -1, total: 0 });

			expect(() => devtools.diff()).toThrow(/diff/u);
			expect(() => devtools.replay()).toThrow(/replay/u);
			expect(() => devtools.recordAction()).toThrow(/recordAction/u);
			expect(() => devtools.replayer).toThrow(/replayer/u);
			expect(() => devtools.timeTravel).toThrow(/timeTravel/u);
		});
	});

	describe('jumpTo', () => {
		it('clamps below -1, optimistically updates the cursor, and fires the worker call', async () => {
			const { ctx, devtools, fake } = makeHarness({
				canRedo: true,
				canUndo: true,
				currentIndex: 2,
				total: 5,
			});

			devtools.jumpTo(-9);

			// Optimistic update is synchronous; -9 clamps to -1.
			expect(ctx.devtoolsStateSignal.value.currentIndex).toBe(-1);
			expect(ctx.devtoolsStateSignal.value.canUndo).toBe(false);
			expect(ctx.devtoolsStateSignal.value.canRedo).toBe(true);
			expect(ctx.lastChangeTimestampSignal.value).not.toBeNull();
			// The worker is asked to jump to the ORIGINAL (unclamped) index per the source.
			expect(fake.calls.at(-1)).toEqual({ args: [-9], method: 'jumpToDevtoolsIndex' });

			await flush();
		});

		it('clamps above max', () => {
			const { ctx, devtools } = makeHarness({
				canRedo: false,
				canUndo: true,
				currentIndex: 1,
				total: 3,
			});

			devtools.jumpTo(99);

			// max index is total - 1 === 2.
			expect(ctx.devtoolsStateSignal.value.currentIndex).toBe(2);
			expect(ctx.devtoolsStateSignal.value.canRedo).toBe(false);
			expect(ctx.devtoolsStateSignal.value.canUndo).toBe(true);
		});

		it('jumps in range and runs bumpAfterTimeTravel after the worker resolves', async () => {
			const { ctx, devtools, refreshDevtoolsCalls, refreshEverythingCalls } = makeHarness({
				canRedo: true,
				canUndo: true,
				currentIndex: 2,
				total: 5,
			});

			devtools.jumpTo(1);
			expect(ctx.devtoolsStateSignal.value.currentIndex).toBe(1);

			await flush();

			expect(refreshEverythingCalls.count).toBe(1);
			expect(refreshDevtoolsCalls.count).toBe(1);
			expect(ctx.lastChangeEventSignal.value).toEqual({ type: 'reset' });
			expect(ctx.lastChangeTimestampSignal.value).not.toBeNull();
		});

		it('bumpAfterTimeTravel skips the lastChange bump when disposed mid-flight', async () => {
			const { ctx, devtools, fake, setDisposed } = makeHarness({
				canRedo: true,
				canUndo: true,
				currentIndex: 2,
				total: 5,
			});
			let resolveJump: (() => void) | undefined;

			fake.engine.jumpToDevtoolsIndex = async () =>
				new Promise<void>((res) => {
					resolveJump = () => {
						res();
					};
				});

			devtools.jumpTo(0);
			setDisposed(true);
			resolveJump?.();
			await flush();

			// The optimistic cursor moved, but the post-await reset bump never fires.
			expect(ctx.lastChangeEventSignal.value).toBeNull();
		});
	});

	describe('undo', () => {
		it('is a no-op when !canUndo', () => {
			const { devtools, fake } = makeHarness({
				canRedo: true,
				canUndo: false,
				currentIndex: -1,
				total: 3,
			});

			devtools.undo();

			expect(fake.calls.some((c) => c.method === 'undoDevtools')).toBe(false);
		});

		it('optimistically decrements and chains bumpAfterTimeTravel when canUndo', async () => {
			const { ctx, devtools, fake, refreshEverythingCalls } = makeHarness({
				canRedo: false,
				canUndo: true,
				currentIndex: 2,
				total: 3,
			});

			devtools.undo();

			expect(ctx.devtoolsStateSignal.value.currentIndex).toBe(1);
			expect(ctx.devtoolsStateSignal.value.canRedo).toBe(true);
			expect(ctx.devtoolsStateSignal.value.canUndo).toBe(true);
			expect(fake.calls.some((c) => c.method === 'undoDevtools')).toBe(true);

			await flush();
			expect(refreshEverythingCalls.count).toBe(1);
			expect(ctx.lastChangeEventSignal.value).toEqual({ type: 'reset' });
		});

		it('clears canUndo when stepping to index -1', () => {
			const { ctx, devtools } = makeHarness({
				canRedo: false,
				canUndo: true,
				currentIndex: 0,
				total: 3,
			});

			devtools.undo();

			expect(ctx.devtoolsStateSignal.value.currentIndex).toBe(-1);
			expect(ctx.devtoolsStateSignal.value.canUndo).toBe(false);
		});
	});

	describe('redo', () => {
		it('is a no-op when !canRedo', () => {
			const { devtools, fake } = makeHarness({
				canRedo: false,
				canUndo: true,
				currentIndex: 2,
				total: 3,
			});

			devtools.redo();

			expect(fake.calls.some((c) => c.method === 'redoDevtools')).toBe(false);
		});

		it('optimistically increments and chains bumpAfterTimeTravel when canRedo', async () => {
			const { ctx, devtools, fake, refreshEverythingCalls } = makeHarness({
				canRedo: true,
				canUndo: true,
				currentIndex: 0,
				total: 3,
			});

			devtools.redo();

			expect(ctx.devtoolsStateSignal.value.currentIndex).toBe(1);
			expect(ctx.devtoolsStateSignal.value.canRedo).toBe(true);
			expect(ctx.devtoolsStateSignal.value.canUndo).toBe(true);
			expect(fake.calls.some((c) => c.method === 'redoDevtools')).toBe(true);

			await flush();
			expect(refreshEverythingCalls.count).toBe(1);
			expect(ctx.lastChangeEventSignal.value).toEqual({ type: 'reset' });
		});

		it('clears canRedo when stepping to the last index', () => {
			const { ctx, devtools } = makeHarness({
				canRedo: true,
				canUndo: true,
				currentIndex: 1,
				total: 3,
			});

			devtools.redo();

			// nextIdx 2 === total - 1, so canRedo flips off.
			expect(ctx.devtoolsStateSignal.value.currentIndex).toBe(2);
			expect(ctx.devtoolsStateSignal.value.canRedo).toBe(false);
		});
	});

	it('time-travel timestamp uses Date.now (smoke — fake timers)', () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000);
		const { ctx, devtools } = makeHarness({
			canRedo: true,
			canUndo: true,
			currentIndex: 1,
			total: 3,
		});

		devtools.jumpTo(0);
		expect(ctx.lastChangeTimestampSignal.value).toBe(1_000);
		vi.useRealTimers();
	});
});
