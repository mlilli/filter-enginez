/**
 * Pass-through delegation tests for `wrapInWorker` — the facade methods that forward straight to
 * the worker router with no transform: source-data / working-set, filter groups, rule removal +
 * clear, reset, and JSON config export / import. Exercised end-to-end over the in-jsdom
 * MessageChannel. The transform-bearing methods live in `wrapInWorker.test.ts`.
 */

import { range } from '@filter-enginez/core';
import { describe, expect, it } from 'vitest';

import type { FilterEngineAsync } from './FilterEngineAsync.js';

import { data, type Item, itemEngineFactory, wire } from './test-support/fixtures.js';
import { makeChannelWorker } from './test-support/workerHarness.js';
import { wrapInWorker } from './wrapInWorker.js';

/** Boot a worker-hosted engine over the sample corpus. */
async function bootEngine(): Promise<FilterEngineAsync<Item>> {
	const worker = makeChannelWorker({ item: itemEngineFactory });

	return wrapInWorker<Item>({ factoryName: 'item', factoryOptions: { sourceData: data }, worker });
}

describe('source data + working set delegation', () => {
	it('swaps source data via setSourceData / getSourceData', async () => {
		const engine = await bootEngine();
		const replacement: readonly Item[] = [{ color: 'red', price: 99 }];

		await engine.setSourceData(replacement);

		await expect(engine.getSourceData()).resolves.toEqual(replacement);

		await engine.destroy();
	});

	it('narrows and restores the working set', async () => {
		const engine = await bootEngine();

		await engine.setWorkingSet(data.slice(0, 1));
		await expect(engine.getResultCount()).resolves.toBe(1);

		await engine.resetWorkingSet();
		await expect(engine.getResultCount()).resolves.toBe(3);

		await engine.destroy();
	});
});

describe('group delegation', () => {
	it('adds, reads, and removes filter groups', async () => {
		const engine = await bootEngine();

		await engine.addRule('price', wire(range('price', { max: 100, min: 15 })));
		await engine.addGroup({ composition: 'or', filterIds: ['price'], id: 'g1' });

		await expect(engine.getGroups()).resolves.toHaveLength(1);

		await engine.removeGroup('g1');

		await expect(engine.getGroups()).resolves.toHaveLength(0);

		await engine.destroy();
	});
});

describe('rule removal delegation', () => {
	it('removes a single rule and clears all rules', async () => {
		const engine = await bootEngine();

		await engine.addRule('price', wire(range('price', { max: 100, min: 15 })));
		await engine.removeRule('price');

		await expect(engine.getActiveRuleIds()).resolves.toEqual([]);

		await engine.addRule('a', wire(range('price', { max: 100, min: 0 })));
		await engine.addRule('b', wire(range('price', { max: 100, min: 0 })));
		await engine.clearRules();

		await expect(engine.getActiveRuleIds()).resolves.toEqual([]);

		await engine.destroy();
	});

	it('resets the engine to its unfiltered state', async () => {
		const engine = await bootEngine();

		await engine.addRule('price', wire(range('price', { max: 100, min: 25 })));
		await engine.reset();

		await expect(engine.getActiveRuleIds()).resolves.toEqual([]);
		await expect(engine.getResultCount()).resolves.toBe(3);

		await engine.destroy();
	});
});

describe('JSON config delegation', () => {
	it('round-trips through exportConfig / loadConfig', async () => {
		const engine = await bootEngine();

		await engine.addRule('price', wire(range('price', { max: 100, min: 15 })));

		const config = await engine.exportConfig();

		await engine.clearRules();
		await expect(engine.getActiveRuleIds()).resolves.toEqual([]);

		await engine.loadConfig(config);
		await expect(engine.getActiveRuleIds()).resolves.toContain('price');

		await engine.destroy();
	});
});
