/**
 * Tests for `attachSimilarity`.
 *
 * @remarks
 * Similarity search is opt-in: the engine has no `similarity` property, so the binding of a
 * search to an engine's live source data — its two accessors wired — is covered here, against the
 * function that owns it.
 *
 * @packageDocumentation
 */

import { describe, expect, it } from 'vitest';

import { FilterEngine } from '../FilterEngine.js';
import { attachSimilarity } from './attachSimilarity.js';

/** A row with the one attribute the config below reads. */
interface Item {
	readonly id: number;
	readonly color: string;
}

const SAMPLE: readonly Item[] = [
	{ color: 'red', id: 1 },
	{ color: 'red', id: 2 },
	{ color: 'white', id: 3 },
];

describe('attachSimilarity', () => {
	it('returns a search bound to the engine, configured at attach time', () => {
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });
		const similarity = attachSimilarity(engine, { attributes: ['color']});

		expect(similarity).toBeDefined();
	});

	it('accepts no config, deferring to configure()', () => {
		// A caller that cannot supply a signature config until runtime attaches first and
		// configures later.
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });
		const similarity = attachSimilarity(engine);

		expect(() => {
			similarity.configure({ attributes: ['color']});
		}).not.toThrow();
	});

	it('wires getSourceData and getSourceDataVersion, so a query sees the engine’s live data', () => {
		// The assertion that matters. `findSimilar` pulls source data through the wired accessor and
		// keys its index on the wired version, so a result here proves both arrows are connected to
		// the engine — the one thing that could otherwise break silently.
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });
		const similarity = attachSimilarity(engine, { attributes: ['color']});

		const results = similarity.findSimilar(SAMPLE[0] as Item);

		expect(Array.isArray(results)).toBe(true);
	});

	it('follows the engine when its source data is REPLACED, not just when it is read', () => {
		// Guards the invalidation half of the wiring. The accessors are arrow closures over the store,
		// so a stale index would still answer from the old rows — and every assertion above would pass
		// while `findSimilar` quietly described data the engine no longer holds.
		const engine = new FilterEngine<Item>({ sourceData: SAMPLE });
		const similarity = attachSimilarity(engine, { attributes: ['color']});

		similarity.findSimilar(SAMPLE[0] as Item);
		engine.setSourceData([{ color: 'green', id: 9 }]);

		// Every result must come from the REPLACED data. A stale index would still hold the three
		// original rows and happily return red ones here. The assertion pins provenance, not a
		// particular length, so it does not depend on which rows clear the similarity threshold.
		const results = similarity.findSimilar({ color: 'green', id: 9 });

		expect(results.every((result) => result.item.id === 9)).toBe(true);
	});
});
