/**
 * `filter-intersection` — apply N active rules over the corpus and produce the surviving result
 * indices.
 *
 * @remarks
 * The scenario measures the two result-production paths head to head via the `bitmap` axis:
 *
 *   - `bitmap:off` → `engine.applyFiltersAndQuery({})` — a fresh, non-memoized predicate pass over the
 *     working set (a real per-item rule evaluation every call).
 *   - `bitmap:on`  → `engine.computeResults()` — the public Roaring-Bitmap bitwise-AND facade.
 *
 * **Why neither path is `getResults()` / `getResultIndices()`.** Those are a memoized signal `computed`
 * — calling one in a loop with no invalidation returns a cached array in nanoseconds and measures
 * nothing (the artifact that made an early run show the predicate cell as "600× faster"). Both cells
 * here recompute real work every call, so the comparison is honest. Separately, by current design the
 * bitmap layer accelerates `simulate` + the exclusion graph, not the memoized results path — so
 * `computeResults()` is also the datapoint for whether wiring bitmaps into the primary path is worth it
 * (see `docs/architecture.md` §6, and §6.2 for where the R-tree actually engages).
 *
 * @packageDocumentation
 */
import type { Wine } from '@filter-enginez/mock-data/wine';

import { type AccelerationOptions, createFilterEngine, inSet, range } from '@filter-enginez/core';

import type { CorpusTier } from '../corpus.js';
import type { Scenario, ScenarioCell } from '../scenario.js';

import { consume } from '../sink.js';

export const filterIntersectionScenario: Scenario = {
	applicableAxes: ['bitmap'],
	description:
		'Apply N active rules and produce the surviving result indices — predicate path vs Roaring-Bitmap path.',
	id: 'filter-intersection',
	setup(tier: CorpusTier, acceleration: AccelerationOptions): ScenarioCell {
		const engine = createFilterEngine<Wine>({ acceleration, sourceData: tier.data });

		// A representative multi-rule intersection across an in-set facet and two numeric ranges.
		engine.addRule('color', inSet('color', ['red', 'white']));
		engine.addRule('points', range('points', { max: 100, min: 90 }));
		engine.addRule('price', range('priceUsd', { max: 60, min: 15 }));

		// The bitmap axis selects which real-work path to time: the Roaring-Bitmap intersection
		// (`computeResults`) or a fresh predicate pass (`applyFiltersAndQuery`). Both recompute
		// every call — deliberately NOT the memoized `getResultIndices()` computed.
		const shouldUseBitmapPath = acceleration.bitmap !== 'off';
		const run = (): void => {
			const count = shouldUseBitmapPath
				? engine.computeResults().length
				: engine.applyFiltersAndQuery({}).resultCount;

			consume(count);
		};

		return {
			run,
			async teardown(): Promise<void> {
				await engine.destroy();
			},
		};
	},
	title: 'Filter intersection',
};
