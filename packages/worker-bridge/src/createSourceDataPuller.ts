/**
 * `createSourceDataPuller` — copy a worker-hosted engine's source data to the main thread in
 * chunks, so no single message blocks the main thread for long.
 *
 * @remarks
 * The reactive adapters keep a main-thread copy of the source data: the result indices that cross
 * the boundary on every filter change are joined against it. Shipped as one `getSourceData()`
 * call, the copy is one structured clone of the whole corpus, deserialized in a single main-thread
 * task: about 140 MB and 700+ ms for 150,000 wines on a mobile-class CPU, during which the page
 * cannot respond to input.
 *
 * The puller asks for `chunkSize` records at a time through `getSourceDataRange(offset, count)`,
 * one request after the other. Each reply is its own message, so the main thread deserializes
 * one chunk per task and handles input and rendering between chunks; at the default 7,500 wines a
 * chunk deserializes in about 40 ms on a 4×-throttled CPU. The records arrive in order and fill a
 * preallocated array of the reported `total`.
 *
 * **Consistency.** Every range reply carries the worker's source-data `revision`. If it changes
 * between chunks (the worker's source data was replaced mid-copy), the copy starts over; after
 * three such attempts it falls back to one `getSourceData()` call, which is a consistent snapshot
 * by construction.
 *
 * **Unchanged data is not copied again.** After the first pull, a later pull first asks for an
 * empty range: when the revision is the one already copied, it resolves to the same array, without
 * copying a record. Rules, expressions, groups and `reset()` never replace the source data, so a
 * reset or a time-travel jump costs one small round trip instead of a corpus.
 *
 * An engine without `getSourceDataRange` (it is optional on `FilterEngineAsync`) is pulled with
 * `getSourceData()`, as one message.
 *
 * @packageDocumentation
 */

import type { FilterEngineAsync, SourceDataRange } from './FilterEngineAsync.js';

/**
 * Records per chunk when the caller does not choose: 7,500 wines (about 7 MB) deserialize in
 * about 40 ms on a 4×-throttled CPU, inside the 50 ms long-task budget, in 20 chunks for 150,000.
 */
export const DEFAULT_SOURCE_DATA_CHUNK_SIZE = 7500;

/** How many chunked copies may be restarted by a source-data change before falling back. */
const MAX_CHUNKED_ATTEMPTS = 3;

/** A completed copy: the records plus the revision they were read at. */
interface PulledSourceData<T> {
	readonly items: readonly T[];
	readonly revision: number;
}

/**
 * Build a function that copies `asyncEngine`'s source data to the main thread in chunks.
 *
 * @typeParam T - The item type the engine holds
 * @param asyncEngine - The worker-hosted engine to read from
 * @param chunkSize - Records per request; a positive integer
 * @returns `pull()`, which resolves to the engine's current source data, in order. It resolves to
 *   the array it returned last time when the worker reports the same revision.
 * @throws {RangeError} When `chunkSize` is not a positive integer
 *
 * @example
 *   const pullSourceData = createSourceDataPuller(asyncEngine);
 *   const sourceData = await pullSourceData(); // 20 messages for 150,000 records
 */
export function createSourceDataPuller<T>(
	asyncEngine: FilterEngineAsync<T>,
	chunkSize: number = DEFAULT_SOURCE_DATA_CHUNK_SIZE,
): () => Promise<readonly T[]> {
	if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) {
		throw new RangeError(`createSourceDataPuller: chunkSize must be a positive integer, got ${chunkSize}.`);
	}

	let lastPull: PulledSourceData<T> | undefined;

	const readRange = async (offset: number, count: number): Promise<SourceDataRange<T>> =>
		// Called as a method, so an engine implemented as a class keeps its `this`.
		(asyncEngine as Required<Pick<FilterEngineAsync<T>, 'getSourceDataRange'>>).getSourceDataRange(offset, count);

	// #region docs:chunked-pull
	// One chunked copy. `undefined` when the revision moved under it and the copy must start over.
	const pullChunked = async (): Promise<PulledSourceData<T> | undefined> => {
		const first = await readRange(0, chunkSize);
		const items = new Array<T>(first.total);
		let offset = 0;
		let chunk: readonly T[] = first.items;

		for (;;) {
			for (const item of chunk) {
				items[offset] = item;
				offset += 1;
			}
			if (offset >= first.total) {
				return { items, revision: first.revision };
			}
			const next = await readRange(offset, chunkSize);

			// An empty chunk short of `total` can only come from a source that changed; never loop on it.
			if (next.revision !== first.revision || next.items.length === 0) {
				return undefined;
			}
			chunk = next.items;
		}
	};

	return async (): Promise<readonly T[]> => {
		if (asyncEngine.getSourceDataRange === undefined) {
			return asyncEngine.getSourceData();
		}
		if (lastPull !== undefined && (await readRange(0, 0)).revision === lastPull.revision) {
			return lastPull.items;
		}
		for (let attempt = 0; attempt < MAX_CHUNKED_ATTEMPTS; attempt++) {
			const pulled = await pullChunked();

			if (pulled !== undefined) {
				lastPull = pulled;

				return pulled.items;
			}
		}
		// The source data kept changing under the copy: one message is a consistent snapshot.
		lastPull = undefined;

		return asyncEngine.getSourceData();
	};
	// #endregion docs:chunked-pull
}
