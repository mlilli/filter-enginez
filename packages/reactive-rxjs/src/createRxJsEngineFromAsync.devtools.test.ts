/**
 * The RxJS adapter's devtools mirror — boot seeding, the refresh ordering, and time-travel
 * reconciliation.
 *
 * @remarks
 * **The ordering test is the reason this file exists.** The refresh ordering is the one thing in
 * the devtools mirror that "typechecks, lints, unit-tests and still misbehaves" if written the
 * obvious way, and the symptom is concrete — a devtools panel rendering an EMPTY action log on its
 * first render (the signals adapter's comment describes the same constraint).
 *
 * The mechanism is worth stating, because it is invisible from the code. A panel re-renders off
 * `lastChangeTimestamp$`, **not** off the action-log mirror. So the log only has to be current *at
 * the moment the tick fires*; refreshing it one microtask later is indistinguishable from
 * refreshing it correctly in every test that inspects state after `await flush()`. Asserting
 * "the log is right eventually" would pass against the wrong ordering. This file asserts the log **at the
 * instant of the tick**, from inside the subscription, which is the only place the difference is
 * observable.
 */

import type { WireActionLogEntry } from '@filter-enginez/worker-bridge';

import { describe, expect, it, vi } from 'vitest';

import { createRxJsEngineFromAsync } from './createRxJsEngineFromAsync.js';
import { makeFakeAsyncEngine } from './fakeAsyncEngine.js';

interface Item {
	readonly price: number;
}

const SOURCE: readonly Item[] = [{ price: 10 }, { price: 20 }];

/** A wire log entry; only the fields the shim reads back matter. */
function entry(summary: string): WireActionLogEntry {
	return { summary, timestamp: 1, type: 'RULE_ADDED' };
}

/** Drain the adapter's refresh chain: a macrotask boundary plus a couple of microtask ticks. */
async function flush(): Promise<void> {
	await new Promise((resolve) => {
		setTimeout(resolve, 0);
	});
	await Promise.resolve();
	await Promise.resolve();
}

describe('createRxJsEngineFromAsync devtools mirror', () => {
	it('seeds both mirrors during the boot pull, so the first paint has rows', async () => {
		const fake = makeFakeAsyncEngine<Item>({
			actionLog: [entry('RangeRule <price>')],
			devtoolsState: { canRedo: false, canUndo: true, currentIndex: 0, total: 1 },
			results: SOURCE,
			sourceData: SOURCE,
		});
		const engine = await createRxJsEngineFromAsync(fake.engine);

		// No event has been emitted — everything here came from the boot `Promise.all`. Seeding
		// lazily instead would render an empty panel until the user's first filter action.
		expect(engine.core.devtools.actionLog.size).toBe(1);
		expect(engine.core.devtools.currentIndex).toBe(0);
		expect(engine.core.devtools.canUndo).toBe(true);

		engine.dispose();
	});

	it('refreshes the action log BEFORE the lastChange tick, not one microtask after', async () => {
		const fake = makeFakeAsyncEngine<Item>({ results: SOURCE, sourceData: SOURCE });
		const engine = await createRxJsEngineFromAsync(fake.engine);

		// The worker has recorded an action; the main-thread mirror is still empty.
		fake.state.actionLog = [entry('RangeRule <price>')];
		fake.state.devtoolsState = { canRedo: false, canUndo: true, currentIndex: 0, total: 1 };

		// Capture the log size AT THE MOMENT the tick fires — this is the whole test. Reading it
		// after `await flush()` would pass against the wrong ordering, because the mirror catches up either
		// way; what differs is whether it had caught up when the panel re-rendered.
		const logSizeAtTick: number[] = [];
		const subscription = engine.lastChangeTimestamp$.subscribe((timestamp) => {
			if (timestamp !== null) {
				logSizeAtTick.push(engine.core.devtools.actionLog.size);
			}
		});

		fake.emit({ ruleId: 'price', type: 'rule:added' } as never);
		await flush();

		expect(logSizeAtTick).toEqual([1]);

		subscription.unsubscribe();
		engine.dispose();
	});

	it('reconciles the optimistic cursor with engine truth after a time-travel settles', async () => {
		const fake = makeFakeAsyncEngine<Item>({
			actionLog: [entry('a'), entry('b'), entry('c')],
			devtoolsState: { canRedo: false, canUndo: true, currentIndex: 2, total: 3 },
			results: SOURCE,
			sourceData: SOURCE,
		});
		const engine = await createRxJsEngineFromAsync(fake.engine);

		// Worker-side time travel bypasses the dispatcher, so it emits no ChangeEvent — the only
		// way the main thread learns it happened is the re-fetch this asserts.
		fake.state.devtoolsState = { canRedo: true, canUndo: true, currentIndex: 1, total: 3 };
		engine.core.devtools.undo();

		// Painted immediately, before the round trip resolves.
		expect(engine.core.devtools.currentIndex).toBe(1);
		expect(fake.calls.some((call) => call.method === 'undoDevtools')).toBe(true);

		await flush();

		// And still 1 after the settle re-pulled from the worker — optimistic and truth agree.
		expect(engine.core.devtools.currentIndex).toBe(1);
		expect(engine.core.devtools.canRedo).toBe(true);

		engine.dispose();
	});

	it('stops refreshing the mirrors once disposed', async () => {
		const fake = makeFakeAsyncEngine<Item>({ results: SOURCE, sourceData: SOURCE });
		const engine = await createRxJsEngineFromAsync(fake.engine);

		engine.dispose();
		fake.state.actionLog = [entry('after disposal')];
		fake.emit({ ruleId: 'price', type: 'rule:added' } as never);
		await flush();

		// A `next()` on a completed subject is a no-op, but the guard is what keeps a disposed
		// adapter from issuing worker round trips at all.
		expect(engine.core.devtools.actionLog.size).toBe(0);
	});

	// ── The two post-disposal guards, which the cases above do not reach ──
	//
	// `dispose()` tears down the ChangeEvent subscription, so emitting after it never calls the
	// refreshers at all — which is why the case above leaves both of these lines uncovered. Time
	// travel is the path that survives: the devtools shim's mutators are plain method calls on an
	// object the consumer still holds, so they can be invoked after disposal or race it.
	//
	// These are not defensive-only. A panel whose component unmounts mid-round-trip does exactly
	// this, and the failure mode is a disposed adapter issuing worker calls and pushing onto
	// completed subjects.

	it('a time-travel started AFTER disposal issues no worker round trip', async () => {
		const fake = makeFakeAsyncEngine<Item>({
			actionLog: [entry('a'), entry('b')],
			devtoolsState: { canRedo: false, canUndo: true, currentIndex: 1, total: 2 },
			results: SOURCE,
			sourceData: SOURCE,
		});
		const engine = await createRxJsEngineFromAsync(fake.engine);

		engine.dispose();

		// Spied directly rather than read off `fake.calls`. The fake does NOT `record()` its
		// devtools getters, so a `fake.calls` filter for `getActionLogSnapshot` is empty whatever
		// the adapter does and would pass with the guard deleted. The spy is what makes the
		// assertion able to fail.
		const getActionLogSnapshot = vi.spyOn(fake.engine, 'getActionLogSnapshot');

		engine.core.devtools.undo();
		await flush();

		// `bumpAfterTimeTravel` runs, and the refreshers it awaits must bail at their FIRST guard —
		// before pulling anything. A call count distinguishes "returned early" from "fetched and
		// then discarded the result", which are identical when viewed through the mirrors.
		expect(getActionLogSnapshot).not.toHaveBeenCalled();
	});

	it('a disposal DURING the time-travel round trip stops the reconcile', async () => {
		const fake = makeFakeAsyncEngine<Item>({
			actionLog: [entry('a'), entry('b')],
			devtoolsState: { canRedo: false, canUndo: true, currentIndex: 1, total: 2 },
			results: SOURCE,
			sourceData: SOURCE,
		});
		const engine = await createRxJsEngineFromAsync(fake.engine);

		let lastChangeTicks = 0;
		const subscription = engine.lastChangeTimestamp$.subscribe(() => {
			lastChangeTicks += 1;
		});

		// Disposed synchronously after the mutator, so the in-flight `Promise.all` inside
		// `bumpAfterTimeTravel` resolves into an adapter that is already gone. That is the post-await
		// guard — the one a pre-await check cannot cover, because the state changed mid-flight.
		engine.core.devtools.undo();
		engine.dispose();

		// The baseline is taken HERE, not before `undo()`. `applyOptimisticCursor` ticks
		// `lastChangeTimestamp$` synchronously as part of painting the cursor, so a pre-undo
		// baseline counts that legitimate tick as a leak and the test fails against correct code.
		// What this case is about is the tick that would arrive AFTER the round trip resolves.
		const ticksBeforeSettle = lastChangeTicks;

		await flush();

		expect(lastChangeTicks).toBe(ticksBeforeSettle);
		subscription.unsubscribe();

		// **This case pins REACHABILITY, not behavior, and saying so is the point.**
		// Under mutation testing, deleting the post-await guard leaves it GREEN. That is not a
		// weak assertion, it is the guard having no observable effect — both writes it skips are
		// `next()` calls on subjects `dispose()` has already completed, which RxJS ignores (the
		// "stops refreshing the mirrors once disposed" case above says the same thing about its
		// own subject). The guard's value is not making the writes at all.
		//
		// Verified by instrumentation instead of a coverage run: replacing the
		// guard's `return` with a `throw` fires it from this test, so the line is genuinely
		// executed rather than merely reported. The pre-await guard in the case above IS
		// behaviorally pinned — stripping it turns that one red.
	});
});
