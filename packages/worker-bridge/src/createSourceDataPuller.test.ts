/**
 * `createSourceDataPuller` — the chunked source-data copy. Unit cases run against a scripted
 * engine (so a source change can land between two chunks); the end-to-end cases run the real
 * router over the in-jsdom MessageChannel.
 */

import { describe, expect, it } from 'vitest';

import type { FilterEngineAsync, SourceDataRange } from './FilterEngineAsync.js';
import type { WorkerHostedEngine } from './WorkerHostedEngine.js';

import { createSourceDataPuller, DEFAULT_SOURCE_DATA_CHUNK_SIZE } from './createSourceDataPuller.js';
import { data, type Item, itemEngineFactory } from './test-support/fixtures.js';
import { makeChannelWorker } from './test-support/workerHarness.js';
import { wrapInWorker } from './wrapInWorker.js';

/** A ranged engine over a mutable source, recording every call. */
interface ScriptedEngine {
	readonly calls: string[];
	readonly engine: FilterEngineAsync<number>;
	/** Runs after each range call, so a test can change the source between chunks. */
	afterRange: (call: number) => void;
	revision: number;
	source: readonly number[];
}

function scriptedEngine(source: readonly number[]): ScriptedEngine {
	let rangeCalls = 0;
	const scripted: ScriptedEngine = {
		afterRange: () => undefined,
		calls: [],
		engine: {
			getSourceData: async () => {
				scripted.calls.push('all');

				return Promise.resolve(scripted.source);
			},
			getSourceDataRange: async (offset: number, count: number) => {
				scripted.calls.push(`${offset}+${count}`);
				const reply: SourceDataRange<number> = {
					items: scripted.source.slice(offset, offset + count),
					revision: scripted.revision,
					total: scripted.source.length,
				};

				rangeCalls += 1;
				scripted.afterRange(rangeCalls);

				return Promise.resolve(reply);
			},
		} as unknown as FilterEngineAsync<number>,
		revision: 1,
		source,
	};

	return scripted;
}

const numbers = (length: number): number[] => Array.from({ length }, (_, i) => i);

describe('createSourceDataPuller', () => {
	it('copies the source in order, one chunk per request', async () => {
		const scripted = scriptedEngine(numbers(10));

		await expect(createSourceDataPuller(scripted.engine, 4)()).resolves.toEqual(numbers(10));
		expect(scripted.calls).toEqual(['0+4', '4+4', '8+4']);
	});

	it('handles an exact multiple of the chunk size and an empty source', async () => {
		const exact = scriptedEngine(numbers(8));
		const empty = scriptedEngine([]);

		await expect(createSourceDataPuller(exact.engine, 4)()).resolves.toEqual(numbers(8));
		expect(exact.calls).toEqual(['0+4', '4+4']);
		await expect(createSourceDataPuller(empty.engine, 4)()).resolves.toEqual([]);
		expect(empty.calls).toEqual(['0+4']);
	});

	it('defaults to 7,500 records per chunk', async () => {
		const scripted = scriptedEngine(numbers(DEFAULT_SOURCE_DATA_CHUNK_SIZE + 1));

		await createSourceDataPuller(scripted.engine)();

		expect(DEFAULT_SOURCE_DATA_CHUNK_SIZE).toBe(7500);
		expect(scripted.calls).toEqual(['0+7500', '7500+7500']);
	});

	it('returns the same array without copying again while the revision holds', async () => {
		const scripted = scriptedEngine(numbers(10));
		const pull = createSourceDataPuller(scripted.engine, 4);
		const first = await pull();

		scripted.calls.length = 0;

		await expect(pull()).resolves.toBe(first);
		expect(scripted.calls).toEqual(['0+0']);
	});

	it('copies again when the revision moved between pulls', async () => {
		const scripted = scriptedEngine(numbers(10));
		const pull = createSourceDataPuller(scripted.engine, 4);

		await pull();
		scripted.source = numbers(5);
		scripted.revision = 2;
		scripted.calls.length = 0;

		await expect(pull()).resolves.toEqual(numbers(5));
		expect(scripted.calls).toEqual(['0+0', '0+4', '4+4']);
	});

	it('starts over when the source changes between chunks', async () => {
		const scripted = scriptedEngine(numbers(10));

		scripted.afterRange = (call) => {
			if (call === 1) {
				scripted.source = numbers(6).map((n) => n * 10);
				scripted.revision = 2;
			}
		};

		await expect(createSourceDataPuller(scripted.engine, 4)()).resolves.toEqual([0, 10, 20, 30, 40, 50]);
		expect(scripted.calls).toEqual(['0+4', '4+4', '0+4', '4+4']);
	});

	it('starts over on an empty chunk short of the total', async () => {
		const scripted = scriptedEngine(numbers(10));
		const engine = scripted.engine as unknown as { getSourceDataRange: (o: number, c: number) => Promise<SourceDataRange<number>> };
		const realRange = engine.getSourceDataRange;
		let calls = 0;

		// The second request answers with nothing at the same revision: the copy restarts rather than loop.
		engine.getSourceDataRange = async (offset, count) => {
			calls += 1;
			const reply = await realRange(offset, count);

			return calls === 2 ? { ...reply, items: []} : reply;
		};

		await expect(createSourceDataPuller(scripted.engine, 4)()).resolves.toEqual(numbers(10));
		expect(scripted.calls).toEqual(['0+4', '4+4', '0+4', '4+4', '8+4']);
	});

	it('falls back to one getSourceData() call when the source keeps changing', async () => {
		const scripted = scriptedEngine(numbers(10));
		const pull = createSourceDataPuller(scripted.engine, 4);

		await pull();
		scripted.revision = 2;
		scripted.calls.length = 0;
		scripted.afterRange = () => {
			scripted.revision += 1;
		};

		await expect(pull()).resolves.toEqual(numbers(10));
		expect(scripted.calls).toEqual(['0+0', '0+4', '4+4', '0+4', '4+4', '0+4', '4+4', 'all']);

		// The fallback's revision is unknown, so the earlier copy is forgotten: the next pull copies in
		// chunks again, without a probe.
		scripted.afterRange = () => undefined;
		scripted.calls.length = 0;
		await pull();
		expect(scripted.calls).toEqual(['0+4', '4+4', '8+4']);
	});

	it('uses getSourceData() for an engine without getSourceDataRange', async () => {
		const scripted = scriptedEngine(numbers(3));
		const engine = { ...scripted.engine, getSourceDataRange: undefined } as FilterEngineAsync<number>;

		await expect(createSourceDataPuller(engine, 4)()).resolves.toEqual(numbers(3));
		expect(scripted.calls).toEqual(['all']);
	});

	it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects a chunk size of %s', (chunkSize) => {
		expect(() => createSourceDataPuller(scriptedEngine([]).engine, chunkSize)).toThrow(RangeError);
	});
});

describe('createSourceDataPuller over a worker', () => {
	/** The facade, typed with the `getSourceDataRange` it always has (optional on the interface). */
	type RangedEngine = FilterEngineAsync<Item> & Pick<WorkerHostedEngine<Item>, 'getSourceDataRange'>;

	async function bootEngine(): Promise<RangedEngine> {
		return wrapInWorker<Item>({
			factoryName: 'item',
			factoryOptions: { sourceData: data },
			worker: makeChannelWorker({ item: itemEngineFactory }),
		}) as Promise<RangedEngine>;
	}

	it('copies the worker source in one-record chunks, and again after setSourceData', async () => {
		const engine = await bootEngine();
		const pull = createSourceDataPuller(engine, 1);
		const first = await pull();

		expect(first).toEqual(data);
		await expect(pull()).resolves.toBe(first);

		const replacement: readonly Item[] = [{ color: 'rose', price: 12 }];

		await engine.setSourceData(replacement);
		await expect(pull()).resolves.toEqual(replacement);

		await engine.destroy();
	});

	it('serves slices with a revision that moves only when the source data is replaced', async () => {
		const engine = await bootEngine();
		const first = await engine.getSourceDataRange(1, 5);

		expect(first.items).toEqual(data.slice(1));
		expect(first.total).toBe(3);
		await expect(engine.getSourceDataRange(3, 1)).resolves.toEqual({ items: [], revision: first.revision, total: 3 });

		// A reset leaves the source data alone; replacing it moves the revision.
		await engine.reset();
		await expect(engine.getSourceDataRange(0, 0)).resolves.toEqual({ items: [], revision: first.revision, total: 3 });
		await engine.setSourceData([]);
		const replaced = await engine.getSourceDataRange(0, 0);

		expect(replaced.revision).not.toBe(first.revision);
		expect(replaced.total).toBe(0);

		await engine.destroy();
	});

	it.each([
		[-1, 1],
		[0, -1],
		[0.5, 1],
		[0, Number.NaN],
	])('rejects offset %s and count %s', async (offset, count) => {
		const engine = await bootEngine();

		await expect(engine.getSourceDataRange(offset, count)).rejects.toThrow(/offset and count must be non-negative integers/u);

		await engine.destroy();
	});
});
