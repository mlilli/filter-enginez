/**
 * Unit tests for `createEngineStores` — the bag of Svelte `Readable`s over a real `SignalsEngine`.
 *
 * @remarks
 * Boots a genuine sync engine (`createSignalsEngine(createFilterEngine(...))`) over a tiny corpus and
 * asserts the stores mirror engine state + react to `addRule` — the sync engine updates its signals
 * synchronously, so assertions can read immediately after a mutation via svelte's `get`.
 *
 * @packageDocumentation
 */

import { createFilterEngine, inSet } from '@filter-enginez/core';
import { createSignalsEngine } from '@filter-enginez/reactive-signals';
import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';

import { createEngineStores } from './engineStores.js';

interface Row {
	readonly id: string;
	readonly genre: string;
}

const DATA: readonly Row[] = [
	{ genre: 'fantasy', id: 'a' },
	{ genre: 'mystery', id: 'b' },
	{ genre: 'fantasy', id: 'c' },
];

/** Boot a fresh sync signals engine over the fixture corpus. */
function bootEngine(): ReturnType<typeof createSignalsEngine<Row>> {
	return createSignalsEngine<Row>(createFilterEngine<Row>({ sourceData: DATA }));
}

describe('createEngineStores', () => {
	it('mirrors results, count, rules + lastChange and reacts to addRule', () => {
		const engine = bootEngine();
		const stores = createEngineStores(engine);

		expect(get(stores.resultCount)).toBe(3);
		expect(get(stores.results).map((row) => row.id)).toEqual(['a', 'b', 'c']);
		expect(get(stores.sourceData)).toHaveLength(3);

		engine.core.addRule('genre', inSet('genre', ['fantasy']));

		expect(get(stores.resultCount)).toBe(2);
		expect(get(stores.results).map((row) => row.id)).toEqual(['a', 'c']);
		expect([...get(stores.activeRuleIds)]).toEqual(['genre']);
		expect(get(stores.rule('genre'))).toBeDefined();
		expect(get(stores.lastChange).ruleId).toBe('genre');
		expect(get(stores.mode)).toBe('flat-map');

		engine.dispose();
	});

	it('pushes reactive updates to a live subscriber', () => {
		const engine = bootEngine();
		const { resultCount } = createEngineStores(engine);
		const seen: number[] = [];
		const unsubscribe = resultCount.subscribe((value) => seen.push(value));

		engine.core.addRule('genre', inSet('genre', ['mystery']));

		// Immediate 3 on subscribe, then 1 after the rule narrows to the single mystery row.
		expect(seen).toEqual([3, 1]);
		unsubscribe();
		engine.dispose();
	});

	it('defaults the rule store to undefined for an unknown id', () => {
		const engine = bootEngine();
		const stores = createEngineStores(engine);

		expect(get(stores.rule('nope'))).toBeUndefined();
		engine.dispose();
	});
});
