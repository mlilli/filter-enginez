/**
 * `fuzzy-search-*` — time typo-tolerant `FuzzySearchRule` matching, the other scenario the
 * `textIndex` axis drives. Two cells of the same operation at different Fuse thresholds:
 *
 *   - **strict (t=0.2)** — the sound trigram bound applies, so `textIndex:auto` narrows to a small
 *     candidate set (a Uint16 count over the pattern's trigram postings) and confirms only those
 *     with Fuse, versus `textIndex:off` running a per-item Fuse probe across the whole corpus.
 *   - **loose (t=0.4, Fuse's default)** — the bound proves nothing, so `auto` bypasses to the same
 *     per-item predicate as `off`. This cell is a regression guardrail: `auto` must not be slower
 *     than `off` (the only difference is the cheap plan check).
 *
 * @remarks
 * The query is a near-miss typo of a common descriptor, so at the strict threshold its trigrams
 * pre-filter to a fraction of the corpus. As with the other text scenarios, `invalidateRule` drops
 * only the rule's bitmap each iteration — the trigram postings stay cached — so this times the
 * steady-state candidate query + confirm, not a cold rebuild.
 *
 * @packageDocumentation
 */
import type { Wine } from '@filter-enginez/mock-data/wine';

import { type AccelerationOptions, createFilterEngine, FuzzySearchRule } from '@filter-enginez/core';

import type { CorpusTier } from '../corpus.js';
import type { Scenario, ScenarioCell } from '../scenario.js';

import { consume } from '../sink.js';
import { tastingNotesText } from './wineText.js';

/** A near-exact typo of a common descriptor ('leather') — its trigrams prune to a small candidate set. */
const QUERY = 'lether';

/** Build a fuzzy scenario at a given Fuse threshold — the two exported scenarios differ only in that. */
function makeFuzzyScenario(id: string, title: string, description: string, threshold: number): Scenario {
	return {
		applicableAxes: ['textIndex'],
		description,
		id,
		setup(tier: CorpusTier, acceleration: AccelerationOptions): ScenarioCell {
			const engine = createFilterEngine<Wine>({ acceleration, sourceData: tier.data });

			engine.addRule(
				'fuzzy',
				new FuzzySearchRule((item) => tastingNotesText(item as Wine), { query: QUERY, threshold }),
			);

			const run = (): void => {
				engine.bitmapIndex.invalidateRule('fuzzy');
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
	'Typo-tolerant search at a strict threshold — trigram candidate pre-filter + Fuse confirm vs per-item Fuse.',
	0.2,
);

/** Default-threshold fuzzy — the bound bypasses; guardrail that auto is not slower than off. */
export const fuzzyLooseScenario: Scenario = makeFuzzyScenario(
	'fuzzy-search-loose',
	'Fuzzy search (t=0.4, bypass)',
	'Default-threshold fuzzy — the bound bypasses to the per-item predicate; guardrail that auto is not slower.',
	0.4,
);
