/**
 * The engine releases the prepared state of every rule that leaves its active rules, and of no
 * other rule.
 *
 * @remarks
 * The devtools action log keeps the rules of past states for time travel, so a rule the engine has
 * replaced still lives. Before the release existed, a replaced `FuzzySearchRule` kept the Fuse index
 * it had built over the whole collection: a search box adding a new rule per keystroke over 150,000
 * items grew by about 27 MB a keystroke until the log's 100 entries were full. Each case here spies
 * on `releasePrepared` and checks which rules a change released: one that left (replaced, removed,
 * cleared, dropped from an expression, undone, or still active at `destroy()`) exactly once, and
 * one that stayed (re-added, kept by a new expression) never.
 */

import { describe, expect, it, vi } from 'vitest';

import type { FilterRule } from './rules/FilterRule.js';

import { and, or } from './composition/factories.js';
import { FilterEngine } from './FilterEngine.js';
import { fuzzy, value } from './rules/factories.js';

interface Item {
	readonly color: string;
	readonly name: string;
}

const SAMPLE: readonly Item[] = [
	{ color: 'red', name: 'Cabernet' },
	{ color: 'blue', name: 'Merlot' },
];

/**
 * Spy on each rule's `releasePrepared`, keeping the real implementation.
 *
 * @param rules - The rules to watch
 * @returns A reader for how many times each rule was released, in the order given
 */
function watchReleases(...rules: FilterRule[]): () => number[] {
	const spies = rules.map((rule) => vi.spyOn(rule, 'releasePrepared'));

	return () => spies.map((spy) => spy.mock.calls.length);
}

describe('FilterEngine — releasing the rules that leave', () => {
	it('releases a replaced rule that the action log still holds', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });
		const first = fuzzy('name', { query: 'cabernay' });
		const second = fuzzy('name', { query: 'merlott' });
		const other = value('color', 'red');
		const releases = watchReleases(first, second, other);

		engine.addRule('search', first);
		engine.addRule('color', other);
		expect(engine.getResultCount()).toBe(1);
		engine.addRule('search', second);

		expect(releases()).toEqual([1, 0, 0]);
		expect(engine.devtools.actionLog.toArray().some((entry) => entry.nextStateSnapshot.rules.get('search') === first)).toBe(true);
		expect(engine.getResultCount()).toBe(0);
	});

	it('releases nothing when a rule is added again under its own id', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });
		const rule = fuzzy('name', { query: 'cabernay' });
		const releases = watchReleases(rule);

		engine.addRule('search', rule);
		engine.addRule('search', rule);
		expect(releases()).toEqual([0]);
	});

	it('releases a removed rule, then every cleared one', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });
		const removed = value('color', 'red');
		const cleared = fuzzy('name', { query: 'cabernay' });
		const releases = watchReleases(removed, cleared);

		engine.addRule('color', removed);
		engine.addRule('search', cleared);
		engine.removeRule('color');
		expect(releases()).toEqual([1, 0]);
		engine.clearRules();
		expect(releases()).toEqual([1, 1]);
	});

	it('releases the leaves an expression drops, not a leaf the new expression keeps', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });
		const dropped = value('color', 'red');
		const kept = fuzzy('name', { query: 'cabernay' });
		const added = value('color', 'blue');
		const releases = watchReleases(dropped, kept, added);

		engine.setExpression(and(dropped, kept));
		engine.setExpression(or(kept, added));
		expect(releases()).toEqual([1, 0, 0]);
		engine.setExpression(null);
		expect(releases()).toEqual([1, 1, 1]);
	});

	it('releases the rule an undo removes and the one a redo replaces', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });
		const first = fuzzy('name', { query: 'cabernay' });
		const second = fuzzy('name', { query: 'merlott' });
		const releases = watchReleases(first, second);

		engine.addRule('search', first);
		engine.addRule('search', second);
		engine.devtools.undo();
		expect(releases()).toEqual([1, 1]);
		// The restored rule is prepared again by the next pass, so it still answers.
		expect(engine.getResults()).toEqual([SAMPLE[0]]);
		engine.devtools.redo();
		expect(releases()).toEqual([2, 1]);
		expect(engine.getResults()).toEqual([SAMPLE[1]]);
	});

	it('releases the rules still active when the engine is destroyed', async () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });
		const flat = fuzzy('name', { query: 'cabernay' });
		const releases = watchReleases(flat);

		engine.addRule('search', flat);
		await engine.destroy();
		expect(releases()).toEqual([1]);
	});
});
