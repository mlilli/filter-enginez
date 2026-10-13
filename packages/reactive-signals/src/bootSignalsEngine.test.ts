/**
 * Tests for `bootSignalsEngine` (the size-vs-threshold worker/main-thread boot selector) and
 * the `./worker` sub-export barrel.
 *
 * @remarks
 * `bootSignalsEngine` picks the worker path when `size > threshold` (wrapping a
 * `FilterEngineAsync<T>` from `spawnAsyncEngine` via `createSignalsEngineFromAsync`) and the
 * main-thread path otherwise (wrapping a sync `FilterEngine<T>` from `createMainEngine` via
 * `createSignalsEngine`). The fake async engine stands in for `wrapInWorker`'s output; a real
 * `createFilterEngine` backs the main-thread path. The `=== threshold` boundary takes the
 * main-thread arm. Both factories' options are forwarded.
 *
 * The worker barrel re-exports `createSignalsEngineFromAsync` + `bootSignalsEngine` as live
 * function bindings.
 */

import { createFilterEngine, type FilterEngine, type FilterRule, range } from '@filter-enginez/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { bootSignalsEngine } from './bootSignalsEngine.js';
import { type FakeAsyncEngine, makeFakeAsyncEngine } from './fakeAsyncEngine.js';

interface Item {
	readonly price: number;
}

const SOURCE: readonly Item[] = [{ price: 10 }, { price: 20 }, { price: 30 }];

const disposers: (() => void)[] = [];

afterEach(() => {
	while (disposers.length > 0) {
		disposers.pop()?.();
	}
	vi.restoreAllMocks();
});

describe('bootSignalsEngine', () => {
	it('takes the worker path when size > threshold', async () => {
		const fake: FakeAsyncEngine<Item> = makeFakeAsyncEngine<Item>({
			devtoolsState: { canRedo: false, canUndo: false, currentIndex: -1, total: 0 },
			resultCount: 3,
			results: SOURCE,
			sourceData: SOURCE,
		});
		const spawnAsyncEngine = vi.fn(async () => Promise.resolve(fake.engine));
		const createMainEngine = vi.fn<() => FilterEngine<Item>>();

		const { engine, mode } = await bootSignalsEngine<Item>({
			createMainEngine,
			size: 20_000,
			spawnAsyncEngine,
			threshold: 10_000,
		});

		disposers.push(() => {
			engine.dispose();
		});

		expect(mode).toBe('worker');
		expect(spawnAsyncEngine).toHaveBeenCalledTimes(1);
		expect(createMainEngine).not.toHaveBeenCalled();
		// Worker-path engine carries the async escape hatch === our fake.
		expect(engine.asyncEngine).toBe(fake.engine);
		expect(engine.resultCount.value).toBe(3);
	});

	it('forwards fromAsyncOptions on the worker path', async () => {
		const fake = makeFakeAsyncEngine<Item>({
			activeRuleIds: ['price'],
			devtoolsState: { canRedo: false, canUndo: false, currentIndex: -1, total: 0 },
			rules: new Map<string, FilterRule>([
				['price', range('price', { max: 25, min: 5 }).serialize() as unknown as FilterRule],
			]),
			sourceData: SOURCE,
		});
		const { engine, mode } = await bootSignalsEngine<Item>({
			createMainEngine: () => createFilterEngine<Item>({ sourceData: SOURCE }),
			fromAsyncOptions: { eagerPerRuleSignals: true },
			size: 50_000,
			spawnAsyncEngine: async () => Promise.resolve(fake.engine),
			threshold: 10_000,
		});

		disposers.push(() => {
			engine.dispose();
		});

		expect(mode).toBe('worker');
		// Eager option flowed through — the initial rule signal is pre-built (memoized).
		expect(engine.rule('price')).toBe(engine.rule('price'));
	});

	it('takes the main-thread path when size <= threshold', async () => {
		const core = createFilterEngine<Item>({ sourceData: SOURCE });
		const createMainEngine = vi.fn(() => core);
		const spawnAsyncEngine = vi.fn(async () => Promise.resolve(makeFakeAsyncEngine<Item>().engine));

		const { engine, mode } = await bootSignalsEngine<Item>({
			createMainEngine,
			size: 5_000,
			spawnAsyncEngine,
			threshold: 10_000,
		});

		disposers.push(() => {
			engine.dispose();
		});

		expect(mode).toBe('main-thread');
		expect(createMainEngine).toHaveBeenCalledTimes(1);
		expect(spawnAsyncEngine).not.toHaveBeenCalled();
		expect(engine.core).toBe(core);
		expect(engine.sourceData.value).toEqual(SOURCE);
	});

	it('takes the main-thread path at the exact threshold boundary (size === threshold)', async () => {
		const core = createFilterEngine<Item>({ sourceData: SOURCE });
		const { engine, mode } = await bootSignalsEngine<Item>({
			createMainEngine: () => core,
			size: 10_000,
			spawnAsyncEngine: async () => Promise.resolve(makeFakeAsyncEngine<Item>().engine),
			threshold: 10_000,
		});

		disposers.push(() => {
			engine.dispose();
		});

		expect(mode).toBe('main-thread');
	});

	it('awaits an async createMainEngine and forwards signalsOptions', async () => {
		const core = createFilterEngine<Item>({ sourceData: SOURCE });

		core.addRule('price', range('price', { max: 25, min: 5 }));
		const { engine, mode } = await bootSignalsEngine<Item>({
			createMainEngine: async () => Promise.resolve(core),
			signalsOptions: { eagerPerRuleSignals: true },
			size: 100,
			spawnAsyncEngine: async () => Promise.resolve(makeFakeAsyncEngine<Item>().engine),
			threshold: 10_000,
		});

		disposers.push(() => {
			engine.dispose();
		});

		expect(mode).toBe('main-thread');
		expect(engine.rule('price')).toBe(engine.rule('price'));
	});
});
