/**
 * Tests for `createEngineBusyStream`.
 *
 * @remarks
 * These pin the SEMANTICS that `reactive-signals`' `createEngineBusyTracker` also implements — the two
 * surfaces duplicate ~15 lines of counter logic deliberately, so the shared contract has to be pinned
 * on both sides or they can drift.
 *
 * @packageDocumentation
 */

import { describe, expect, it } from 'vitest';

import { createEngineBusyStream } from './createEngineBusyStream.js';

/** Collect every value a stream emits, for order-sensitive assertions. */
function collect(busy: ReturnType<typeof createEngineBusyStream>): { stop: () => void; values: boolean[]; } {
	const values: boolean[] = [];
	const subscription = busy.isBusy$.subscribe((value) => {
		values.push(value);
	});

	return { stop: () => {
		subscription.unsubscribe();
	}, values };
}

describe('createEngineBusyStream', () => {
	it('starts idle and replays that to a late subscriber', () => {
		const busy = createEngineBusyStream();

		expect(busy.getIsBusy()).toBe(false);

		// The replay contract: subscribing after construction still yields the current value.
		const { stop, values } = collect(busy);

		expect(values).toEqual([false]);
		stop();
		busy.dispose();
	});

	it('flips busy synchronously on markUserAction — before any engine round-trip', () => {
		const busy = createEngineBusyStream();
		const { stop, values } = collect(busy);

		busy.markUserAction();

		// Synchronous: this is the whole point — the indicator lights on the same frame the user acts.
		expect(busy.getIsBusy()).toBe(true);
		expect(values).toEqual([false, true]);
		stop();
		busy.dispose();
	});

	it('clears once the captured version resolves', () => {
		const busy = createEngineBusyStream();

		busy.markUserAction();
		const version = busy.captureCurrentVersion();

		busy.markResolvedAtLeast(version);

		expect(busy.getIsBusy()).toBe(false);
		busy.dispose();
	});

	it('stays busy when a STALE resolution lands after a newer action', () => {
		const busy = createEngineBusyStream();

		busy.markUserAction();
		const staleVersion = busy.captureCurrentVersion();

		// A second action supersedes the first while the first fetch is still in flight.
		busy.markUserAction();
		busy.markResolvedAtLeast(staleVersion);

		// Monotonic: the stale resolution must NOT clear the newer action. An in-flight counter would
		// have decremented to zero here and wrongly reported idle.
		expect(busy.getIsBusy()).toBe(true);

		busy.markResolvedAtLeast(busy.captureCurrentVersion());
		expect(busy.getIsBusy()).toBe(false);
		busy.dispose();
	});

	it('is idempotent — replaying the same resolution never regresses', () => {
		const busy = createEngineBusyStream();

		busy.markUserAction();
		const version = busy.captureCurrentVersion();

		busy.markResolvedAtLeast(version);
		busy.markResolvedAtLeast(version);
		busy.markResolvedAtLeast(version - 1);

		expect(busy.getIsBusy()).toBe(false);
		busy.dispose();
	});

	it('does not emit duplicate values (distinctUntilChanged)', () => {
		const busy = createEngineBusyStream();
		const { stop, values } = collect(busy);

		busy.markUserAction();
		busy.markUserAction();
		busy.markUserAction();

		// Three actions, one transition false → true.
		expect(values).toEqual([false, true]);
		stop();
		busy.dispose();
	});

	it('dispose completes the stream and is idempotent', () => {
		const busy = createEngineBusyStream();
		let isCompleted = false;
		const subscription = busy.isBusy$.subscribe({
			complete: () => {
				isCompleted = true;
			},
		});

		busy.dispose();
		busy.dispose();

		expect(isCompleted).toBe(true);
		subscription.unsubscribe();
	});

	it('stops emitting after dispose', () => {
		const busy = createEngineBusyStream();
		const { stop, values } = collect(busy);

		busy.dispose();
		busy.markUserAction();

		expect(values).toEqual([false]);
		stop();
	});
});
