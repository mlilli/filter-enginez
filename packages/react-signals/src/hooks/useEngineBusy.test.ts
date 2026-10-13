/**
 * Tests for `useEngineBusy` — the thin `useSyncExternalStore` wrapper over an `EngineBusyTracker`.
 */

import { createEngineBusyTracker } from '@filter-enginez/reactive-signals';
import { describe, expect, it } from 'vitest';

import { act, renderHook } from '../test-support/renderWithEngine.js';
import { useEngineBusy } from './useEngineBusy.js';

describe('useEngineBusy', () => {
	it('reports not-busy initially', () => {
		const tracker = createEngineBusyTracker();
		const { result } = renderHook(() => useEngineBusy(tracker));

		expect(result.current).toBe(false);
	});

	it('flips to busy on a user action and back when the action resolves', () => {
		const tracker = createEngineBusyTracker();
		const { result } = renderHook(() => useEngineBusy(tracker));

		act(() => {
			tracker.markUserAction();
		});
		expect(result.current).toBe(true);

		act(() => {
			tracker.markResolvedAtLeast(tracker.captureCurrentVersion());
		});
		expect(result.current).toBe(false);
	});
});
