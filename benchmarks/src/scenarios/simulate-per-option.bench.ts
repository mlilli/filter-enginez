/**
 * `simulate-per-option` — the disable-empty-options hot path: for a facet with many candidate
 * options, simulate selecting each one and sum the projected result counts. This is what a filter
 * UI does on every render to grey out options that would empty the result set.
 *
 * @remarks
 * Routes through `engine.simulate` → `SimulationCache` → `ExclusionGraph` →
 * `bitmapIndex.simulateIntersection`, so all three applicable axes bite: `bitmap` (bitmap vs
 * predicate fallback), `exclusionGraph` (short-circuit empty intersections), and `simulationCache`
 * (memoize repeat renders — warm entries on the cache-on cells, full recompute on the cache-off
 * cells).
 *
 * @packageDocumentation
 */
import type { Wine } from '@filter-enginez/mock-data/wine';

import { type AccelerationOptions, createFilterEngine, inSet, range } from '@filter-enginez/core';

import type { CorpusTier } from '../corpus.js';
import type { Scenario, ScenarioCell } from '../scenario.js';

import { consume } from '../sink.js';

/** How many distinct facet options to sweep per render (a realistic large tag-cloud facet). */
const OPTION_CAP = 40;

export const simulatePerOptionScenario: Scenario = {
	applicableAxes: ['bitmap', 'exclusionGraph', 'simulationCache'],
	description: 'Simulate every candidate option across a filter panel (the disable-empty-options hot path).',
	id: 'simulate-per-option',
	setup(tier: CorpusTier, acceleration: AccelerationOptions): ScenarioCell {
		const engine = createFilterEngine<Wine>({ acceleration, sourceData: tier.data });

		// Two standing rules so the intersection + exclusion graph have something to work against.
		engine.addRule('color', inSet('color', ['red']));
		engine.addRule('points', range('points', { max: 100, min: 88 }));

		// The facet being swept: distinct varietals, capped to a realistic panel size.
		const options = Array.from(new Set(tier.data.map((wine) => wine.varietal))).slice(0, OPTION_CAP);

		const run = (): void => {
			let total = 0;

			for (const option of options) {
				total += engine.simulate({ withRule: ['varietal-sim', inSet('varietal', [option])]}).resultCount;
			}
			consume(total);
		};

		return {
			run,
			async teardown(): Promise<void> {
				await engine.destroy();
			},
		};
	},
	title: 'Simulate per option',
};
