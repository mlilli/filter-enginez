/**
 * Tests for `useSignal` + `signalToStoreTuple` — the internal `useSyncExternalStore` primitive
 * every public `use*` hook in this package builds on.
 *
 * @remarks
 * Exercised against a minimal controllable signal (the structural `ReadonlySignalShape` the hook
 * is generic over) so the subscribe / snapshot / unsubscribe contract is tested in isolation; the
 * real `@preact/signals-core` path is covered transitively by the state-readout hook suites.
 */

import { describe, expect, it } from 'vitest';

import { act, renderHook } from '../test-support/renderWithEngine.js';
import { signalToStoreTuple, useSignal } from './useSignal.js';

/** A minimal mutable signal exposing its live subscriber count for subscribe/unsubscribe asserts. */
interface ControllableSignal<V> {
	setValue(next: V): void;
	readonly signal: { subscribe(onChange: (value: V) => void): () => void; readonly value: V };
	subscriberCount(): number;
}

/**
 * Build a signal satisfying `useSignal`'s structural contract, plus a `setValue` mutator and a
 * `subscriberCount` probe the tests assert against.
 */
function makeControllableSignal<V>(initial: V): ControllableSignal<V> {
	let current = initial;
	const subscribers = new Set<(value: V) => void>();

	return {
		setValue(next: V): void {
			current = next;
			for (const notify of subscribers) {
				notify(current);
			}
		},
		signal: {
			subscribe(onChange: (value: V) => void): () => void {
				subscribers.add(onChange);

				return (): void => {
					subscribers.delete(onChange);
				};
			},
			get value(): V {
				return current;
			},
		},
		subscriberCount: (): number => subscribers.size,
	};
}

describe('useSignal', () => {
	it('returns the current signal value on first render', () => {
		const controllable = makeControllableSignal(7);
		const { result } = renderHook(() => useSignal(controllable.signal));

		expect(result.current).toBe(7);
	});

	it('re-renders with the new value when the signal changes', () => {
		const controllable = makeControllableSignal('before');
		const { result } = renderHook(() => useSignal(controllable.signal));

		act(() => {
			controllable.setValue('after');
		});

		expect(result.current).toBe('after');
	});

	it('subscribes once and unsubscribes on unmount', () => {
		const controllable = makeControllableSignal(0);
		const { rerender, unmount } = renderHook(() => useSignal(controllable.signal));

		expect(controllable.subscriberCount()).toBe(1);

		// Re-rendering with the same signal identity must NOT re-subscribe (the memoized tuple).
		rerender();
		expect(controllable.subscriberCount()).toBe(1);

		unmount();
		expect(controllable.subscriberCount()).toBe(0);
	});
});

describe('signalToStoreTuple', () => {
	it('reads the current value from both snapshot getters', () => {
		const controllable = makeControllableSignal(42);
		const [, getSnapshot, getServerSnapshot] = signalToStoreTuple(controllable.signal);

		expect(getSnapshot()).toBe(42);
		expect(getServerSnapshot()).toBe(42);
	});

	it('adapts the value-carrying subscribe callback to an argument-less onChange', () => {
		const controllable = makeControllableSignal('x');
		const [subscribe] = signalToStoreTuple(controllable.signal);

		let notifications = 0;
		const unsubscribe = subscribe(() => {
			notifications += 1;
		});

		controllable.setValue('y');
		expect(notifications).toBe(1);

		unsubscribe();
		expect(controllable.subscriberCount()).toBe(0);
	});
});
