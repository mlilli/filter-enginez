/**
 * Unit tests for `useSignal` — the signal → Vue `shallowRef` bridge + its scope-disposal cleanup.
 *
 * @remarks
 * Driven with a hand-rolled signal fake matching the engine's contract (`subscribe` fires immediately
 * + on every `set`) inside a Vue `effectScope`, so no `@vue/test-utils` or component mount is needed to
 * exercise the composable + its `onScopeDispose` teardown.
 *
 * @packageDocumentation
 */

import { afterEach, describe, expect, it } from 'vitest';
import { effectScope } from 'vue';

import { type ReadonlySignalLike, useSignal } from './useSignal.js';

/** A minimal signal fake: `subscribe` fires now + on every `set`; exposes its subscriber count. */
function makeSignal<V>(initial: V): { readonly subscriberCount: number; set(next: V): void } & ReadonlySignalLike<V> {
	let current = initial;
	const subscribers = new Set<(value: V) => void>();

	return {
		set(next: V): void {
			current = next;
			for (const notify of subscribers) {
				notify(next);
			}
		},
		get subscriberCount(): number {
			return subscribers.size;
		},
		subscribe(onChange: (value: V) => void): () => void {
			subscribers.add(onChange);
			onChange(current);

			return () => subscribers.delete(onChange);
		},
		get value(): V {
			return current;
		},
	};
}

const scopes: { stop(): void }[] = [];

/** Run `fn` inside a tracked effect scope so `onScopeDispose` has somewhere to register. */
function inScope<R>(fn: () => R): R {
	const scope = effectScope();

	scopes.push(scope);

	return scope.run(fn) as R;
}

afterEach(() => {
	for (const scope of scopes.splice(0)) {
		scope.stop();
	}
});

describe('useSignal', () => {
	it('seeds from the signal and tracks subsequent changes', () => {
		const signal = makeSignal(1);
		const state = inScope(() => useSignal(signal));

		expect(state.value).toBe(1);
		signal.set(42);
		expect(state.value).toBe(42);
	});

	it('unsubscribes from the signal when the scope is disposed', () => {
		const signal = makeSignal(0);
		const scope = effectScope();

		scope.run(() => useSignal(signal));
		expect(signal.subscriberCount).toBe(1);

		scope.stop();
		expect(signal.subscriberCount).toBe(0);
	});
});
