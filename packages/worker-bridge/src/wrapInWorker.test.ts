/**
 * Parity + lifecycle tests for `wrapInWorker` + `exposeFilterEngineWorker` — the main-thread ↔
 * worker Comlink bridge, exercised end-to-end over an in-jsdom MessageChannel (no real Worker).
 *
 * Covers the facade's delegation to the worker router: init + mutation delegation, rule +
 * expression serialization, `simulate`, the transfer-based typed-array projections
 * (`getResultIndices` / `getFilteredFieldValuesExcept` / `applyFiltersAndQuery`), subscribe event
 * forwarding (+ the wire-conversion failure path), the devtools remote-control methods (with and
 * without a devtools-bearing engine), `eagerly` pre-warm, `destroy` / `terminateOnDestroy`,
 * `factoryCallbacks`, and the `error` / `messageerror` diagnostic listeners. The plain
 * pass-through methods live in `wrapInWorker.delegation.test.ts`; the raw-proxy guard throws in
 * `exposeFilterEngineWorker.test.ts`.
 */

import {
	and,
	type ChangeEvent,
	type CompositeRule,
	createFilterEngine,
	type FilterEngine,
	FilterEngineDestroyedError,
	FilterEngineError,
	type FilterRule,
	range,
} from '@filter-enginez/core';
import { describe, expect, it, type Mock, vi } from 'vitest';

import {
	data,
	deferred,
	devtoolsEngineFactory,
	devtoolsLessEngineFactory,
	flush,
	type Item,
	itemEngineFactory,
	throwingEngineFactory,
	wire,
} from './test-support/fixtures.js';
import { makeChannelWorker } from './test-support/workerHarness.js';
import { type WorkerLike, wrapInWorker } from './wrapInWorker.js';

describe('wrapInWorker end-to-end', () => {
	it('inits the worker engine and round-trips results across the boundary', async () => {
		const worker = makeChannelWorker({ item: itemEngineFactory });
		const engine = await wrapInWorker<Item>({
			factoryName: 'item',
			factoryOptions: { sourceData: data },
			worker,
		});

		await expect(engine.getResults()).resolves.toEqual(data);

		await engine.destroy();
	});

	it('delegates mutations to the worker engine and reflects them in results', async () => {
		const worker = makeChannelWorker({ item: itemEngineFactory });
		const engine = await wrapInWorker<Item>({
			factoryName: 'item',
			factoryOptions: { sourceData: data },
			worker,
		});

		await engine.addRule('price', wire(range('price', { max: 100, min: 15 })));

		await expect(engine.getResultCount()).resolves.toBe(2);
		await expect(engine.getActiveRuleIds()).resolves.toEqual(['price']);

		await engine.destroy();
	});
});

describe('rule + expression serialization', () => {
	it('returns rules in serialized wire form from getRule / getRules', async () => {
		const worker = makeChannelWorker({ item: itemEngineFactory });
		const engine = await wrapInWorker<Item>({
			factoryName: 'item',
			factoryOptions: { sourceData: data },
			worker,
		});
		const priceRule = range('price', { max: 100, min: 15 });

		await engine.addRule('price', wire(priceRule));

		await expect(engine.getRule('price')).resolves.toEqual(priceRule.serialize());
		await expect(engine.getRule('missing')).resolves.toBeUndefined();

		const rules = await engine.getRules();

		expect(rules.get('price')).toEqual(priceRule.serialize());

		await engine.destroy();
	});

	it('round-trips expression mode through setExpression / getExpression', async () => {
		const worker = makeChannelWorker({ item: itemEngineFactory });
		const engine = await wrapInWorker<Item>({
			factoryName: 'item',
			factoryOptions: { sourceData: data },
			worker,
		});
		// The recursive `CompositeRule.serialize()` makes the whole tree structuredClone-safe, so
		// the composite survives the postMessage round-trip and the worker reconstructs a working
		// expression (prices in [15, 100] → 20 + 30 pass).
		const expression = and(range('price', { max: 100, min: 15 }));

		await engine.setExpression(expression.serialize() as unknown as CompositeRule);
		await expect(engine.getExpression()).resolves.toEqual(expression.serialize());
		await expect(engine.getResultCount()).resolves.toBe(2);

		await engine.setExpression(null);
		await expect(engine.getExpression()).resolves.toBeNull();

		await engine.destroy();
	});

	it('projects a hypothetical rule and passes plain modifications through simulate', async () => {
		const worker = makeChannelWorker({ item: itemEngineFactory });
		const engine = await wrapInWorker<Item>({
			factoryName: 'item',
			factoryOptions: { sourceData: data },
			worker,
		});

		const withRule = await engine.simulate({
			withRule: ['price', wire(range('price', { max: 100, min: 25 }))],
		});

		expect(withRule.resultCount).toBe(1);
		expect(withRule.wouldBeEmpty).toBe(false);

		const passthrough = await engine.simulate({ withoutRule: 'missing' });

		expect(passthrough.resultCount).toBe(3);

		await engine.destroy();
	});
});

describe('transfer-based projections', () => {
	it('round-trips getResultIndices as a Uint32Array', async () => {
		const worker = makeChannelWorker({ item: itemEngineFactory });
		const engine = await wrapInWorker<Item>({
			factoryName: 'item',
			factoryOptions: { sourceData: data },
			worker,
		});

		await engine.addRule('price', wire(range('price', { max: 100, min: 15 })));

		const indices = await engine.getResultIndices();

		// `constructor.name`, not `toBeInstanceOf` — the transferred array crosses the Comlink
		// boundary into a different realm's typed-array constructor under the jsdom pool.
		expect(indices.constructor.name).toBe('Uint32Array');
		expect(Array.from(indices)).toEqual([1, 2]);

		await engine.destroy();
	});

	it('round-trips getFilteredFieldValuesExcept as a Float64Array', async () => {
		const worker = makeChannelWorker({ item: itemEngineFactory });
		const engine = await wrapInWorker<Item>({
			factoryName: 'item',
			factoryOptions: { sourceData: data },
			worker,
		});

		await engine.addRule('price', wire(range('price', { max: 25, min: 15 })));

		// Excluding the price rule yields every item's price — nothing else constrains the set.
		const values = await engine.getFilteredFieldValuesExcept('price', 'price');

		expect(values.constructor.name).toBe('Float64Array');
		expect([...values].sort((a, b) => a - b)).toEqual([10, 20, 30]);

		await engine.destroy();
	});

	it('bundles results + field histograms in one applyFiltersAndQuery round-trip', async () => {
		const worker = makeChannelWorker({ item: itemEngineFactory });
		const engine = await wrapInWorker<Item>({
			factoryName: 'item',
			factoryOptions: { sourceData: data },
			worker,
		});

		const bundle = await engine.applyFiltersAndQuery({
			fields: [{ bucketCount: 2, fieldKey: 'price', ruleId: 'price' }],
		});

		expect(bundle.resultIndices.constructor.name).toBe('Uint32Array');
		expect(bundle.resultCount).toBe(3);
		expect(bundle.fields).toHaveLength(1);

		const [field] = bundle.fields;

		expect(field?.fieldKey).toBe('price');
		expect(field?.bounds).toEqual({ max: 30, min: 10 });
		expect(field?.histogram.bucketEdges.constructor.name).toBe('Float64Array');
		expect(field?.histogram.counts.constructor.name).toBe('Uint32Array');

		// No-arg call exercises the router's `query = {}` default + the no-fields path.
		const bare = await engine.applyFiltersAndQuery();

		expect(bare.resultCount).toBe(3);
		expect(bare.fields).toHaveLength(0);

		await engine.destroy();
	});
});

describe('subscribe forwarding', () => {
	it('forwards wire-formatted change events and stops after unsubscribe', async () => {
		const worker = makeChannelWorker({ item: itemEngineFactory });
		const engine = await wrapInWorker<Item>({
			factoryName: 'item',
			factoryOptions: { sourceData: data },
			worker,
		});

		const events: ChangeEvent[] = [];
		const firstEvent = deferred();
		const unsubscribe = await engine.subscribe((event) => {
			events.push(event);
			firstEvent.resolve();
		});

		await engine.addRule('price', wire(range('price', { max: 100, min: 15 })));
		await firstEvent.promise;
		await flush();

		expect(events.some((event) => event.type === 'rule:added' && event.ruleId === 'price')).toBe(true);

		const countAfterFirst = events.length;

		unsubscribe();
		await flush();
		await flush();

		await engine.addRule('second', wire(range('price', { max: 100, min: 5 })));
		await flush();
		await flush();

		expect(events).toHaveLength(countAfterFirst);

		await engine.destroy();
	});

	it('logs and swallows a wire-conversion failure without breaking the mutation', async () => {
		const worker = makeChannelWorker({ item: itemEngineFactory });
		const engine = await wrapInWorker<Item>({
			factoryName: 'item',
			factoryOptions: { sourceData: data },
			worker,
		});
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		await engine.subscribe(() => undefined);

		// A hand-built wire payload for a rule whose serialize() throws: the worker reconstructs
		// it, then toWireEvent throws serializing it back for the forwarded event, hitting the
		// router's subscribe catch. The addRule itself still succeeds.
		const throwingRule = { config: undefined, field: 'price', type: 'ThrowOnSerializeRule' } as unknown as FilterRule;

		await engine.addRule('boom', throwingRule);
		await flush();

		expect(errorSpy).toHaveBeenCalledWith('[WorkerHostedEngine] subscribe listener threw:', expect.any(Error));
		await expect(engine.getActiveRuleIds()).resolves.toContain('boom');

		errorSpy.mockRestore();
		await engine.destroy();
	});
});

describe('devtools remote control', () => {
	it('exposes the action log + time-travel controls when the engine has devtools', async () => {
		const worker = makeChannelWorker({ devtools: devtoolsEngineFactory });
		const engine = await wrapInWorker<Item>({
			factoryName: 'devtools',
			factoryOptions: { sourceData: data },
			worker,
		});

		await engine.addRule('price', wire(range('price', { max: 100, min: 15 })));

		const snapshot = await engine.getActionLogSnapshot();

		expect(snapshot.some((entry) => entry.type === 'RULE_ADDED' && entry.ruleId === 'price')).toBe(true);

		const state = await engine.getDevtoolsState();

		expect(state.total).toBeGreaterThan(0);
		expect(state.canUndo).toBe(true);

		await engine.undoDevtools();

		const afterUndo = await engine.getDevtoolsState();

		expect(afterUndo.canRedo).toBe(true);

		await engine.redoDevtools();
		await engine.jumpToDevtoolsIndex(0);

		await engine.destroy();
	});

	it('returns empty devtools views and no-ops time-travel for a devtools-less engine', async () => {
		const worker = makeChannelWorker({ stub: devtoolsLessEngineFactory });
		const engine = await wrapInWorker<Item>({ factoryName: 'stub', worker });

		await expect(engine.getActionLogSnapshot()).resolves.toEqual([]);
		await expect(engine.getDevtoolsState()).resolves.toEqual({
			canRedo: false,
			canUndo: false,
			currentIndex: -1,
			total: 0,
		});

		// No devtools coordinator — these resolve as safe no-ops (optional-chaining guards).
		await engine.jumpToDevtoolsIndex(0);
		await engine.undoDevtools();
		await engine.redoDevtools();

		await engine.destroy();
	});
});

describe('eagerly pre-warm', () => {
	it('pre-warms listed methods after init', async () => {
		const worker = makeChannelWorker({ item: itemEngineFactory });
		const engine = await wrapInWorker<Item>({
			eagerly: ['getResults'],
			factoryName: 'item',
			factoryOptions: { sourceData: data },
			worker,
		});

		await expect(engine.getResults()).resolves.toEqual(data);

		await engine.destroy();
	});

	it('swallows pre-warm errors so init still resolves', async () => {
		const worker = makeChannelWorker({ item: itemEngineFactory });
		// A non-existent method name rejects at the worker router; the pre-warm loop swallows it.
		const engine = await wrapInWorker<Item>({
			eagerly: ['noSuchMethod' as never],
			factoryName: 'item',
			factoryOptions: { sourceData: data },
			worker,
		});

		await expect(engine.getResults()).resolves.toEqual(data);

		await engine.destroy();
	});
});

describe('lifecycle: destroy + terminate', () => {
	it('terminates the worker on destroy by default', async () => {
		const worker = makeChannelWorker({ item: itemEngineFactory });
		const terminateSpy = vi.spyOn(worker, 'terminate');
		const engine = await wrapInWorker<Item>({
			factoryName: 'item',
			factoryOptions: { sourceData: data },
			worker,
		});

		await engine.destroy();

		expect(terminateSpy).toHaveBeenCalledTimes(1);
	});

	it('rejects every call after destroy with FilterEngineDestroyedError, and destroy stays idempotent', async () => {
		const worker = makeChannelWorker({ item: itemEngineFactory });
		const terminateSpy = vi.spyOn(worker, 'terminate');
		const engine = await wrapInWorker<Item>({
			factoryName: 'item',
			factoryOptions: { sourceData: data },
			worker,
		});

		await engine.destroy();
		await expect(engine.destroy()).resolves.toBeUndefined();
		expect(terminateSpy).toHaveBeenCalledTimes(1);

		// Without the guard these would hit a released proxy, or a terminated worker that never answers.
		await expect(engine.getResults()).rejects.toBeInstanceOf(FilterEngineDestroyedError);
		await expect(engine.subscribe(() => undefined)).rejects.toMatchObject({
			code: 'ENGINE_DESTROYED',
			message: expect.stringContaining('wrapInWorker: subscribe() was called after destroy()') as unknown,
		});
	});

	it('leaves the worker running when terminateOnDestroy is false', async () => {
		const worker = makeChannelWorker({ item: itemEngineFactory });
		const terminateSpy = vi.spyOn(worker, 'terminate');
		const engine = await wrapInWorker<Item>({
			factoryName: 'item',
			factoryOptions: { sourceData: data },
			terminateOnDestroy: false,
			worker,
		});

		await engine.destroy();

		expect(terminateSpy).not.toHaveBeenCalled();

		worker.terminate();
	});

	it('tears down the worker when init fails', async () => {
		const worker = makeChannelWorker({ boom: throwingEngineFactory });
		const terminateSpy = vi.spyOn(worker, 'terminate');

		// The worker-side factory throws → proxy.init rejects → wrapInWorker releases the proxy,
		// terminates the worker, and rethrows.
		await expect(wrapInWorker<Item>({ factoryName: 'boom', worker })).rejects.toThrow(/factory boom/);
		expect(terminateSpy).toHaveBeenCalledTimes(1);
	});
});

describe('factory callbacks', () => {
	it('proxies factoryCallbacks so the worker factory can call back to the main thread', async () => {
		const received = deferred<number>();
		const callbackFactory = (
			options: Readonly<Record<string, unknown>>,
			callbacks?: Readonly<Record<string, unknown>>,
		): FilterEngine<Item> => {
			const onProgress = callbacks?.['onProgress'] as ((value: number) => void) | undefined;

			onProgress?.(42);

			return createFilterEngine<Item>({ sourceData: options['sourceData'] as readonly Item[] });
		};
		const worker = makeChannelWorker({ callback: callbackFactory });
		const engine = await wrapInWorker<Item>({
			factoryCallbacks: { onProgress: (value: number) => received.resolve(value) },
			factoryName: 'callback',
			factoryOptions: { sourceData: data },
			worker,
		});

		await expect(received.promise).resolves.toBe(42);

		await engine.destroy();
	});
});

describe('worker load failure', () => {
	/** A worker that never posts the ready sentinel; the test fires its events by hand. */
	function makeSilentWorker(): {
		readonly fire: (type: string, event: unknown) => void;
		readonly listenerCount: () => number;
		readonly postMessage: Mock<WorkerLike['postMessage']>;
		readonly terminate: Mock<() => void>;
		readonly worker: WorkerLike;
	} {
		const listeners = new Map<string, Set<(ev: unknown) => void>>();
		const postMessage = vi.fn<WorkerLike['postMessage']>();
		const terminate = vi.fn<() => void>();

		return {
			fire: (type, event) => {
				for (const listener of listeners.get(type) ?? []) {
					listener(event);
				}
			},
			listenerCount: () => [...listeners.values()].reduce((total, set) => total + set.size, 0),
			postMessage,
			terminate,
			worker: {
				addEventListener: (type, listener) => {
					listeners.set(type, (listeners.get(type) ?? new Set()).add(listener));
				},
				postMessage,
				removeEventListener: (type, listener) => {
					listeners.get(type)?.delete(listener);
				},
				terminate,
			},
		};
	}

	it('rejects with WORKER_LOAD_FAILED and terminates the worker when it errors before the handshake', async () => {
		const silent = makeSilentWorker();
		const event = { message: 'Failed to fetch worker script' };
		const pending = wrapInWorker<Item>({ factoryName: 'item', worker: silent.worker });

		silent.fire('error', event);

		const error: unknown = await pending.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(FilterEngineError);
		expect(error).toMatchObject({ cause: event, code: 'WORKER_LOAD_FAILED', name: 'FilterEngineError' });
		expect((error as Error).message).toContain('(Failed to fetch worker script)');
		expect(silent.terminate).toHaveBeenCalledOnce();
		// Only the `messageerror` diagnostic remains; the handshake listeners are gone.
		expect(silent.listenerCount()).toBe(1);
		expect(silent.postMessage).not.toHaveBeenCalled();
	});

	it('omits the detail when the error event carries no message', async () => {
		const silent = makeSilentWorker();
		const pending = wrapInWorker<Item>({ factoryName: 'item', worker: silent.worker });

		silent.fire('error', {});

		await expect(pending).rejects.toThrow(/failed before its ready handshake\. Check/u);
	});
});

describe('diagnostic listeners', () => {
	it('logs worker error and messageerror events', async () => {
		const worker = makeChannelWorker({ item: itemEngineFactory });
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const engine = await wrapInWorker<Item>({
			factoryName: 'item',
			factoryOptions: { sourceData: data },
			worker,
		});

		// Both with and without the payload field, to cover the `?? ev` fallbacks.
		worker.dispatchWorkerEvent('error', { message: 'load failed' });
		worker.dispatchWorkerEvent('error');
		worker.dispatchWorkerEvent('messageerror', { data: 'clone failed' });
		worker.dispatchWorkerEvent('messageerror');

		expect(errorSpy).toHaveBeenCalledTimes(4);

		errorSpy.mockRestore();
		await engine.destroy();
	});
});
