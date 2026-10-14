/**
 * Integration tests over the three dataset modules — filter-config validity + handler wiring.
 *
 * @remarks
 * Node runtime. Unlike the `handler-factory` unit tests (synthetic data), this suite imports the
 * REAL per-dataset modules, so it transitively loads each dataset at module-load (all three use the
 * seeded procedural generator; wine reads the gitignored real-data JSON instead only when it has
 * been downloaded locally). That import cost is paid once. It proves the two things the runtime
 * surface promises: every declarative `FilterEngineConfig` actually loads through the engine, and
 * the MSW handler arrays are wired.
 *
 * The domain generators themselves are covered-by-exclusion (see the mock-data block in
 * `vitest.coverage.config.ts`); here they run as a side effect of the real import but are not the
 * unit under test.
 */

import { createFilterEngine, loadConfig } from '@filter-enginez/core';
import { describe, expect, it } from 'vitest';

import { booksFilterConfig, getBooksFilterConfig } from './books/filter-config.js';
import { allHandlers, booksHandlers, realEstateHandlers, wineHandlers } from './handlers.js';
import { getRealEstateFilterConfig, realEstateFilterConfig } from './real-estate/filter-config.js';
import { wineFilterConfig, wines } from './wine/data.js';
import { buildOriginTree, getWineFilterConfig } from './wine/filter-config.js';

describe('dataset filter-configs', () => {
	it.each([
		['wine', wineFilterConfig],
		['books', booksFilterConfig],
		['real-estate', realEstateFilterConfig],
	])('loads the %s config through the engine without error', (_name, config) => {
		const engine = createFilterEngine();

		expect(() => loadConfig(engine, config)).not.toThrow();
		expect(engine.getRules().size).toBeGreaterThan(0);
	});

	it('exposes each config through its getter', () => {
		expect(getWineFilterConfig(wines)).toEqual(wineFilterConfig);
		expect(getBooksFilterConfig()).toEqual(booksFilterConfig);
		expect(getRealEstateFilterConfig()).toEqual(realEstateFilterConfig);
	});

	it('builds a non-empty wine origin hierarchy', () => {
		const tree = buildOriginTree(wines);

		expect(tree.id).toBeDefined();
		expect(tree.children.length).toBeGreaterThan(0);
	});

	it('skips no-country origins and renders a province-less country as a leaf node', () => {
		const tree = buildOriginTree([
			{ origin: { country: '', province: 'Ignored', region: '', subregion: '' }},
			{ origin: { country: 'Nowhere', province: '', region: '', subregion: '' }},
		]);
		const [node] = tree.children;

		expect(tree.children).toHaveLength(1);
		expect(node?.id).toBe('Nowhere');
		expect(node && 'children' in node).toBe(false);
	});

	it('ends a branch at the last non-empty level, whichever level that is', () => {
		// Hand-built rather than read from a corpus, so every level's "no children" branch is reached
		// by name and asserted exactly, whichever corpus a machine has.
		const tree = buildOriginTree([
			{ origin: { country: 'Spain', province: 'Galicia', region: '', subregion: '' }},
			{ origin: { country: 'France', province: 'Bordeaux', region: 'Graves', subregion: '' }},
			{ origin: { country: 'France', province: 'Bordeaux', region: 'Left Bank', subregion: 'Pauillac' }},
		]);

		expect(tree).toStrictEqual({
			children: [
				{
					children: [
						{
							children: [
								{ id: 'France|Bordeaux|Graves', label: 'Graves' },
								{ children: [{ id: 'France|Bordeaux|Left Bank|Pauillac', label: 'Pauillac' }], id: 'France|Bordeaux|Left Bank', label: 'Left Bank' },
							],
							id: 'France|Bordeaux',
							label: 'Bordeaux',
						},
					],
					id: 'France',
					label: 'France',
				},
				{ children: [{ id: 'Spain|Galicia', label: 'Galicia' }], id: 'Spain', label: 'Spain' },
			],
			id: 'origin',
		});
	});
});

describe('handler wiring', () => {
	it('wires five handlers per dataset into a combined array', () => {
		expect(wineHandlers).toHaveLength(5);
		expect(booksHandlers).toHaveLength(5);
		expect(realEstateHandlers).toHaveLength(5);
		expect(allHandlers).toHaveLength(15);
	});
});
