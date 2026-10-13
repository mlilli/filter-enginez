/**
 * Unit tests for `toStore` — the signal → Svelte `Readable` bridge.
 *
 * @remarks
 * Uses a hand-rolled `ReadonlySignalLike` fake (subscribe fires immediately + on change) rather than a
 * real `@preact/signals-core` signal, so the test doesn't pull that package into this one's graph —
 * the same reason `toStore` types the input structurally.
 *
 * @packageDocumentation
 */

import { describe, expect, it } from 'vitest';

import { type ReadonlySignalLike, toStore } from './toStore.js';

/** A minimal signal fake matching the engine's contract: `subscribe` fires now + on every `set`. */
function makeSignal<V>(initial: V): { set(next: V): void } & ReadonlySignalLike<V> {
	let value = initial;
	const subscribers = new Set<(value: V) => void>();

	return {
		set(next: V): void {
			value = next;
			for (const notify of subscribers) {
				notify(next);
			}
		},
		subscribe(onChange: (value: V) => void): () => void {
			onChange(value);
			subscribers.add(onChange);

			return () => subscribers.delete(onChange);
		},
		get value(): V {
			return value;
		},
	};
}

describe('toStore', () => {
	it('delivers the current value synchronously on subscribe', () => {
		const store = toStore(makeSignal(42));
		const seen: number[] = [];
		const unsubscribe = store.subscribe((value) => seen.push(value));

		expect(seen).toEqual([42]);
		unsubscribe();
	});

	it('pushes subsequent changes to the subscriber', () => {
		const signal = makeSignal('a');
		const store = toStore(signal);
		const seen: string[] = [];
		const unsubscribe = store.subscribe((value) => seen.push(value));

		signal.set('b');
		signal.set('c');

		expect(seen).toEqual(['a', 'b', 'c']);
		unsubscribe();
	});

	it('stops delivering after unsubscribe', () => {
		const signal = makeSignal(0);
		const store = toStore(signal);
		const seen: number[] = [];
		const unsubscribe = store.subscribe((value) => seen.push(value));

		unsubscribe();
		signal.set(1);

		expect(seen).toEqual([0]);
	});
});
