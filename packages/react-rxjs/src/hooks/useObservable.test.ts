/**
 * Tests for `useObservable` + `observableToStoreTuple` — the internal `useSyncExternalStore`
 * primitive every public `use*` hook in this package builds on.
 *
 * @remarks
 * Exercised against a plain RxJS `Subject` so the seed / latest-value / unsubscribe contract is
 * tested in isolation; the real hot `shareReplay(1)` engine streams are covered transitively by
 * the state-readout hook suites.
 */

import { Subject } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { act, renderHook } from '../test-support/renderWithEngine.js';
import { observableToStoreTuple, useObservable } from './useObservable.js';

describe('useObservable', () => {
	it('returns the initial value until the first emission', () => {
		const source = new Subject<number>();
		const { result } = renderHook(() => useObservable(source, 7));

		expect(result.current).toBe(7);
	});

	it('re-renders with each emitted value', () => {
		const source = new Subject<string>();
		const { result } = renderHook(() => useObservable(source, 'init'));

		act(() => {
			source.next('a');
		});
		expect(result.current).toBe('a');

		act(() => {
			source.next('b');
		});
		expect(result.current).toBe('b');
	});

	it('unsubscribes from the source on unmount', () => {
		const source = new Subject<number>();
		const { unmount } = renderHook(() => useObservable(source, 0));

		expect(source.observed).toBe(true);

		unmount();
		expect(source.observed).toBe(false);
	});
});

describe('observableToStoreTuple', () => {
	it('tracks the latest value via getSnapshot and keeps the seed for getServerSnapshot', () => {
		const source = new Subject<number>();
		const [subscribe, getSnapshot, getServerSnapshot] = observableToStoreTuple(source, 1);
		const unsubscribe = subscribe(() => {
			/* no-op — the tuple captures the latest value into its own closure */
		});

		expect(getSnapshot()).toBe(1);
		source.next(5);
		expect(getSnapshot()).toBe(5);
		expect(getServerSnapshot()).toBe(1);

		unsubscribe();
		expect(source.observed).toBe(false);
	});
});
