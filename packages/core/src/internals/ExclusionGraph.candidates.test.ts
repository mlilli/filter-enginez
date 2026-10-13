/**
 * @remarks
 * Tests for how {@link ExclusionGraph.wouldExcludeAll} treats its candidate: a candidate that is
 * the registered rule under its id uses the cached adjacency; a replacement rule under a
 * registered id is checked as a hypothetical against the OTHER rules only; a lone rule has nothing
 * to be exclusive with; and a disjunctive filter group makes the answer "not known" (`false`).
 */

import { beforeAll, describe, expect, it } from 'vitest';

import type { FilterRule } from '../rules/FilterRule.js';

import { ValueRule } from '../rules/ValueRule.js';
import { InternalStore } from '../store/InternalStore.js';
import { BitmapIndex } from './BitmapIndex.js';
import { ExclusionGraph } from './ExclusionGraph.js';
import { initializeBitmapAcceleration } from './roaringInit.js';

interface Wine {
	readonly color: string;
	readonly region: string;
}

function setup(): { graph: ExclusionGraph<Wine>; store: InternalStore<Wine> } {
	const store = new InternalStore<Wine>([
		{ color: 'red', region: 'Napa' },
		{ color: 'white', region: 'Rioja' },
	]);

	return { graph: new ExclusionGraph(store, new BitmapIndex(store, 'bitmap')), store };
}

beforeAll(async () => {
	await initializeBitmapAcceleration();
});

describe('ExclusionGraph.wouldExcludeAll candidates', () => {
	it('answers a registered candidate from the adjacency', () => {
		const { graph, store } = setup();
		const red = new ValueRule('color', 'red');

		store.rules.value = new Map<string, FilterRule>([['color', red], ['region', new ValueRule('region', 'Rioja')]]);

		expect(graph.wouldExcludeAll('color', red)).toBe(true);
	});

	it('checks a replacement rule against the other rules, not the rule it replaces', () => {
		const { graph, store } = setup();

		store.rules.value = new Map<string, FilterRule>([['color', new ValueRule('color', 'red')], ['region', new ValueRule('region', 'Rioja')]]);

		// White would replace red; white and Rioja overlap, so the result is not empty.
		expect(graph.wouldExcludeAll('color', new ValueRule('color', 'white'))).toBe(false);
		expect(graph.wouldExcludeAll('color', new ValueRule('color', 'rose'))).toBe(true);
	});

	it('has nothing to compare a lone rule against', () => {
		const { graph, store } = setup();

		store.rules.value = new Map<string, FilterRule>([['color', new ValueRule('color', 'red')]]);

		expect(graph.wouldExcludeAll('color', new ValueRule('color', 'rose'))).toBe(false);
	});

	it('claims nothing while an "or" group spans the rules involved', () => {
		const { graph, store } = setup();

		store.rules.value = new Map<string, FilterRule>([['red', new ValueRule('color', 'red')]]);
		store.groups.value = [{ composition: 'or', filterIds: ['red', 'white'], id: 'g' }];

		expect(graph.wouldExcludeAll('white', new ValueRule('color', 'white'))).toBe(false);
	});
});
