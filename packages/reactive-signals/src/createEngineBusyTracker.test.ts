/**
 * Tests for `createEngineBusyTracker` — the framework-neutral version-comparison busy tracker.
 *
 * @remarks
 * Covers the monotonic `userActionVersion` / `resolvedVersion` predicate (both arms of
 * `userActionVersion > resolvedVersion`), the `isBusy` signal mirror only flipping when the
 * value actually changes (the `isBusyNext !== peek()` guard), `markResolvedAtLeast` monotonicity
 * + idempotency, `captureCurrentVersion`, the `subscribe`/unsubscribe pair, and the
 * listener-throws path (the `console.error` catch — `console.error` is stubbed, other listeners
 * still fire).
 */

import { effect } from '@preact/signals-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEngineBusyTracker } from './createEngineBusyTracker.js';

const disposers: (() => void)[] = [];

afterEach(() => {
	while (disposers.length > 0) {
		disposers.pop()?.();
	}
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('createEngineBusyTracker', () => {
	it('starts not busy', () => {
		const busy = createEngineBusyTracker();

		expect(busy.getIsBusy()).toBe(false);
		expect(busy.isBusy.value).toBe(false);
	});

	it('markUserAction flips busy true and bumps the captured version', () => {
		const busy = createEngineBusyTracker();

		expect(busy.captureCurrentVersion()).toBe(0);

		busy.markUserAction();

		expect(busy.getIsBusy()).toBe(true);
		expect(busy.isBusy.value).toBe(true);
		expect(busy.captureCurrentVersion()).toBe(1);

		busy.markUserAction();
		expect(busy.captureCurrentVersion()).toBe(2);
	});

	it('captureCurrentVersion snapshots the current user-action version', () => {
		const busy = createEngineBusyTracker();

		busy.markUserAction();
		const snapshot = busy.captureCurrentVersion();

		busy.markUserAction();

		// Resolving the earlier snapshot leaves us still busy (a newer action is outstanding).
		busy.markResolvedAtLeast(snapshot);
		expect(busy.getIsBusy()).toBe(true);
	});

	it('markResolvedAtLeast clears busy when it catches up to the action version', () => {
		const busy = createEngineBusyTracker();

		busy.markUserAction();
		const version = busy.captureCurrentVersion();

		busy.markResolvedAtLeast(version);

		expect(busy.getIsBusy()).toBe(false);
		expect(busy.isBusy.value).toBe(false);
	});

	it('markResolvedAtLeast is monotonic — a lower version is a no-op', () => {
		const busy = createEngineBusyTracker();

		busy.markUserAction();
		busy.markUserAction();
		busy.markResolvedAtLeast(2);
		expect(busy.getIsBusy()).toBe(false);

		// A stale, lower resolution must NOT regress resolvedVersion.
		const listener = vi.fn();
		const unsubscribe = busy.subscribe(listener);

		disposers.push(unsubscribe);
		busy.markResolvedAtLeast(1);
		expect(listener).not.toHaveBeenCalled();
		expect(busy.getIsBusy()).toBe(false);
	});

	it('markResolvedAtLeast is idempotent for the same version', () => {
		const busy = createEngineBusyTracker();

		busy.markUserAction();
		busy.markResolvedAtLeast(1);

		const listener = vi.fn();

		disposers.push(busy.subscribe(listener));
		busy.markResolvedAtLeast(1);
		expect(listener).not.toHaveBeenCalled();
	});

	it('getIsBusy covers both predicate arms', () => {
		const busy = createEngineBusyTracker();

		// userActionVersion === resolvedVersion → not busy.
		expect(busy.getIsBusy()).toBe(false);
		busy.markUserAction();
		// userActionVersion > resolvedVersion → busy.
		expect(busy.getIsBusy()).toBe(true);
	});

	it('isBusy signal only emits when the boolean actually changes (peek guard)', () => {
		const busy = createEngineBusyTracker();
		const seen: boolean[] = [];
		const stop = effect(() => {
			seen.push(busy.isBusy.value);
		});

		disposers.push(stop);

		// Two consecutive user actions both leave isBusy === true; the guard prevents a
		// redundant signal write on the second.
		busy.markUserAction();
		busy.markUserAction();

		expect(seen).toEqual([false, true]);
	});

	it('subscribe fires its listener on recompute and unsubscribe stops it', () => {
		const busy = createEngineBusyTracker();
		const listener = vi.fn();
		const unsubscribe = busy.subscribe(listener);

		busy.markUserAction();
		expect(listener).toHaveBeenCalledTimes(1);

		unsubscribe();
		busy.markUserAction();
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it('catches a throwing listener and still fires the others (console.error path)', () => {
		const errorSpy = vi.fn();

		vi.stubGlobal('console', { error: errorSpy });

		const busy = createEngineBusyTracker();
		const good = vi.fn();

		disposers.push(busy.subscribe(() => {
			throw new Error('boom');
		}));
		disposers.push(busy.subscribe(good));

		busy.markUserAction();

		expect(good).toHaveBeenCalledTimes(1);
		expect(errorSpy).toHaveBeenCalledTimes(1);
		expect(errorSpy.mock.calls[0]?.[0]).toContain('[engineBusyTracker]');
	});
});
