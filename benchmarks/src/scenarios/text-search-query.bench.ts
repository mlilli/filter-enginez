/**
 * `text-search-query` — time a whole-word (`allWords`) text match, the scenario where the
 * `textIndex` axis is meaningful: `computeResults` builds the rule's bitmap from the inverted word
 * index (AND of word postings) when `textIndex:auto`, or a per-item predicate scan when
 * `textIndex:off`.
 *
 * @remarks
 * The query targets the wine tasting-notes text (a function field extractor joins the
 * `tastingNotes` array into one searchable string — a stable reference so the inverted index caches
 * one posting set keyed by that extractor). `'oak'` is a common descriptor in the generated notes,
 * so the query is selective while the index build still covers the corpus.
 *
 * @packageDocumentation
 */
import type { Wine } from '@filter-enginez/mock-data/wine';

import { type AccelerationOptions, createFilterEngine, TextSearchRule } from '@filter-enginez/core';

import type { CorpusTier } from '../corpus.js';
import type { Scenario, ScenarioCell } from '../scenario.js';

import { consume } from '../sink.js';
import { tastingNotesText } from './wineText.js';

/** A descriptor that appears across the generated tasting-notes vocabulary. */
const QUERY = 'oak';

export const textSearchQueryScenario: Scenario = {
	applicableAxes: ['textIndex'],
	description: 'Whole-word (allWords) text match — inverted word index vs per-item predicate scan.',
	id: 'text-search-query',
	setup(tier: CorpusTier, acceleration: AccelerationOptions): ScenarioCell {
		const engine = createFilterEngine<Wine>({ acceleration, sourceData: tier.data });

		engine.addRule(
			'notes',
			new TextSearchRule((item) => tastingNotesText(item as Wine), { mode: 'allWords', query: QUERY }),
		);

		const run = (): void => {
			// Drop just the rule's bitmap so each iteration rebuilds it: with textIndex:auto that reuses
			// the cached word postings and re-ANDs (the steady state), with textIndex:off it re-runs the
			// full per-item predicate scan — the comparison the axis exists to make.
			engine.bitmapIndex.invalidateRule('notes');
			consume(engine.computeResults().length);
		};

		return {
			run,
			async teardown(): Promise<void> {
				await engine.destroy();
			},
		};
	},
	title: 'Text search (allWords)',
};
