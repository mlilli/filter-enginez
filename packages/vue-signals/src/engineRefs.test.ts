/**
 * Unit tests for `useEngineRefs` (the refs bag + composed `lastChange`) and `useBusy`.
 *
 * @remarks
 * A partial `SignalsEngine` fake supplies each reactive field as a hand-rolled signal (see
 * `useSignal.test.ts` for the fake's contract). Only the fields the bag reads are provided, cast to the
 * full engine type. Run inside a Vue `effectScope` so the composables' subscriptions clean up.
 *
 * @packageDocumentation
 */

import type { ChangeEvent, RuleId } from '@filter-enginez/core';
import type { EngineBusyTracker, SignalsEngine } from '@filter-enginez/reactive-signals';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';

import { useEngineRefs } from './engineRefs.js';
import { useBusy } from './useBusy.js';
import type { ReadonlySignalLike } from './useSignal.js';

/** A minimal settable signal (fires now + on every `set`). */
function makeSignal<V>(initial: V): { set(next: V): void } & ReadonlySignalLike<V> {
	let current = initial;
	const subscribers = new Set<(value: V) => void>();

	return {
		set(next: V): void {
			current = next;
			for (const notify of subscribers) {
				notify(next);
			}
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

/** Build a fake engine exposing only the signals `useEngineRefs` reads. */
function makeFakeEngine() {
	const resultCount = makeSignal(3);
	const results = makeSignal<readonly { id: string }[]>([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
	const lastChangeRuleId = makeSignal<null | RuleId>(null);
	const lastChangeTimestamp = makeSignal<null | number>(null);
	const lastChangeEvent = makeSignal<ChangeEvent | null>(null);
	const ruleSignals = new Map<RuleId, ReturnType<typeof makeSignal>>();
	const engine = {
		activeRuleIds: makeSignal<readonly RuleId[]>([]),
		activeRules: makeSignal(new Map()),
		expression: makeSignal(null),
		lastChangeEvent,
		lastChangeRuleId,
		lastChangeTimestamp,
		mode: makeSignal<'expression' | 'flat-map'>('flat-map'),
		resultCount,
		results,
		// A per-id signal, so a test can prove the ruleId is threaded through rather than swallowed.
		rule: vi.fn((ruleId: RuleId) => ruleSignals.get(ruleId) ?? makeSignal(undefined)),
		sourceData: makeSignal<readonly { id: string }[]>([]),
		workingSet: makeSignal<readonly { id: string }[]>([]),
	};

	return {
		engine: engine as unknown as SignalsEngine<{ id: string }>,
		lastChangeRuleId,
		lastChangeTimestamp,
		resultCount,
		results,
		ruleSignals,
		ruleSpy: engine.rule,
	};
}

const scopes: { stop(): void }[] = [];

afterEach(() => {
	for (const scope of scopes.splice(0)) {
		scope.stop();
	}
});

function inScope<R>(fn: () => R): R {
	const scope = effectScope();

	scopes.push(scope);

	return scope.run(fn) as R;
}

describe('useEngineRefs', () => {
	it('mirrors the engine signals and updates on change', () => {
		const { engine, resultCount, results } = makeFakeEngine();
		const refs = inScope(() => useEngineRefs(engine));

		expect(refs.resultCount.value).toBe(3);
		expect(refs.results.value.map((row: { id: string }) => row.id)).toEqual(['a', 'b', 'c']);

		resultCount.set(1);
		results.set([{ id: 'a' }]);
		expect(refs.resultCount.value).toBe(1);
		expect(refs.results.value.map((row: { id: string }) => row.id)).toEqual(['a']);
	});

	it('exposes rule() as a per-rule ref factory that threads the ruleId through', () => {
		// Every other test reads the eagerly-built refs; this is the one that calls the member that is
		// a function. A version that ignored its argument — or returned a single shared signal for
		// every rule — would pass the rest of the suite, while every filter control in a Vue app
		// silently observed the wrong rule.
		const { engine, ruleSignals, ruleSpy } = makeFakeEngine();
		const genre = makeSignal<unknown>({ kind: 'inSet', values: ['fantasy'] });

		ruleSignals.set('genre' as RuleId, genre);

		const refs = inScope(() => useEngineRefs(engine));
		const genreRef = inScope(() => refs.rule('genre' as RuleId));

		expect(ruleSpy).toHaveBeenCalledWith('genre');
		expect(genreRef.value).toEqual({ kind: 'inSet', values: ['fantasy'] });

		genre.set({ kind: 'inSet', values: ['fantasy', 'mystery'] });

		expect(genreRef.value).toEqual({ kind: 'inSet', values: ['fantasy', 'mystery'] });
	});

	it('composes lastChange from the three last-change signals', () => {
		const { engine, lastChangeRuleId, lastChangeTimestamp } = makeFakeEngine();
		const refs = inScope(() => useEngineRefs(engine));

		expect(refs.lastChange.value).toEqual({ event: null, ruleId: null, timestamp: null });

		lastChangeRuleId.set('genre');
		lastChangeTimestamp.set(123);
		expect(refs.lastChange.value).toMatchObject({ ruleId: 'genre', timestamp: 123 });
	});
});

describe('useBusy', () => {
	it('tracks the tracker isBusy signal', () => {
		const isBusy = makeSignal(false);
		const tracker = { isBusy } as unknown as EngineBusyTracker;
		const busy = inScope(() => useBusy(tracker));

		expect(busy.value).toBe(false);
		isBusy.set(true);
		expect(busy.value).toBe(true);
	});
});
