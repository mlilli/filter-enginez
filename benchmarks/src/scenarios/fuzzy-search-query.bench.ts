/**
 * `fuzzy-search-*` — time typo-tolerant `FuzzySearchRule` matching, the other scenario the
 * `textIndex` axis drives. Two cells of the same operation at different Fuse thresholds:
 *
 *   - **strict (t=0.2)** — the sound trigram bound applies, so `textIndex:auto` narrows to a small
 *     candidate set (a Uint16 count over the pattern's trigram postings) and confirms only those
 *     with one Fuse search, versus `textIndex:off` searching the whole corpus with Fuse.
 *   - **loose (t=0.4, Fuse's default)** — the bound proves nothing, so `auto` bypasses to the same
 *     whole-corpus search as `off`. This cell is a regression guardrail: `auto` must not be slower
 *     than `off` (the only difference is the cheap plan check).
 *
 * @remarks
 * The query is a near-miss typo of a common descriptor whose trigrams are rare in other words, so at
 * the strict threshold they pre-filter to a few percent of the corpus. A pattern made of common
 * trigrams prunes far less: `lether` shares `the` and `her` with most tasting notes and keeps about a
 * third.
 *
 * Every run adds a new rule, as a search box does on each keystroke. Reusing one rule would time a
 * cache hit: `FuzzySearchRule` keeps its answers per collection and config, so a second pass over
 * the corpus with the same config searches nothing. The trigram postings belong to the bitmap index,
 * not the rule, so they stay cached, and this times the candidate query plus confirm, not a cold
 * index build.
 *
 * @packageDocumentation
 */
import type { Wine } from '@filter-enginez/mock-data/wine';

import { type AccelerationOptions, createFilterEngine, FuzzySearchRule } from '@filter-enginez/core';

import type { CorpusTier } from '../corpus.js';
import type { Scenario, ScenarioCell } from '../scenario.js';

import { consume } from '../sink.js';
import { tastingNotesText } from './wineText.js';

/** A near-exact typo of a common descriptor ('tobacco') — its trigrams prune to a small candidate set. */
const QUERY = 'tobaco';

/** Build a fuzzy scenario at a given Fuse threshold — the two exported scenarios differ only in that. */
function makeFuzzyScenario(id: string, title: string, description: string, threshold: number): Scenario {
	return {
		applicableAxes: ['textIndex'],
		description,
		id,
		setup(tier: CorpusTier, acceleration: AccelerationOptions): ScenarioCell {
			const engine = createFilterEngine<Wine>({ acceleration, sourceData: tier.data });
			const field = (item: unknown): string => tastingNotesText(item as Wine);

			const run = (): void => {
				engine.addRule('fuzzy', new FuzzySearchRule(field, { query: QUERY, threshold }));
				consume(engine.computeResults().length);
			};

			return {
				run,
				async teardown(): Promise<void> {
					await engine.destroy();
				},
			};
		},
		title,
	};
}

/** Strict-threshold fuzzy — the trigram candidate pre-filter engages. */
export const fuzzyStrictScenario: Scenario = makeFuzzyScenario(
	'fuzzy-search-strict',
	'Fuzzy search (t=0.2, candidate)',
	'Typo-tolerant search at a strict threshold — trigram candidate pre-filter + Fuse confirm vs a whole-corpus Fuse search.',
	0.2,
);

/** Default-threshold fuzzy — the bound bypasses; guardrail that auto is not slower than off. */
export const fuzzyLooseScenario: Scenario = makeFuzzyScenario(
	'fuzzy-search-loose',
	'Fuzzy search (t=0.4, bypass)',
	'Default-threshold fuzzy — the bound bypasses to the whole-corpus search; guardrail that auto is not slower.',
	0.4,
);
