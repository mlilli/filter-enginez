/**
 * Tests for `useEngineBusy` — the `useObservable` wrapper over an `EngineBusyStream`.
 */

import { createEngineBusyStream } from '@filter-enginez/reactive-rxjs';
import { describe, expect, it } from 'vitest';

import { act, renderHook } from '../test-support/renderWithEngine.js';
import { useEngineBusy } from './useEngineBusy.js';

describe('useEngineBusy', () => {
	it('reports not-busy initially', () => {
		const busy = createEngineBusyStream();
		const { result } = renderHook(() => useEngineBusy(busy));

		expect(result.current).toBe(false);
	});

	it('renders an already-busy stream as busy on the first render', () => {
		const busy = createEngineBusyStream();

		busy.markUserAction();
		const { result } = renderHook(() => useEngineBusy(busy));

		expect(result.current).toBe(true);
	});

	it('flips to busy on a user action and back when the action resolves', () => {
		const busy = createEngineBusyStream();
		const { result } = renderHook(() => useEngineBusy(busy));

		act(() => {
			busy.markUserAction();
		});
		expect(result.current).toBe(true);

		act(() => {
			busy.markResolvedAtLeast(busy.captureCurrentVersion());
		});
		expect(result.current).toBe(false);
	});
});
