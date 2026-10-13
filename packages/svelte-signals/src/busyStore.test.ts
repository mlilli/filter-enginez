/**
 * Unit tests for `busyStore` — a Svelte `Readable<boolean>` over an `EngineBusyTracker`.
 *
 * @packageDocumentation
 */

import { createEngineBusyTracker } from '@filter-enginez/reactive-signals';
import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';

import { busyStore } from './busyStore.js';

describe('busyStore', () => {
	it('reflects the tracker busy state through mark/resolve', () => {
		const tracker = createEngineBusyTracker();
		const busy = busyStore(tracker);

		expect(get(busy)).toBe(false);

		tracker.markUserAction();
		expect(get(busy)).toBe(true);

		tracker.markResolvedAtLeast(tracker.captureCurrentVersion());
		expect(get(busy)).toBe(false);
	});

	it('pushes busy transitions to a live subscriber', () => {
		const tracker = createEngineBusyTracker();
		const seen: boolean[] = [];
		const unsubscribe = busyStore(tracker).subscribe((value) => seen.push(value));

		tracker.markUserAction();
		tracker.markResolvedAtLeast(tracker.captureCurrentVersion());

		expect(seen).toEqual([false, true, false]);
		unsubscribe();
	});
});
