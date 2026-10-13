/**
 * `bayesian-suggest` — time computing the top-3 suggested next filters from Bayesian co-occurrence
 * over a synthetic session history. The model trains once (warmed in `setup`); the timed call is the
 * per-query noisy-OR over the conditional table. No acceleration axes apply, so the matrix is one cell.
 *
 * @packageDocumentation
 */
import type { Wine } from '@filter-enginez/mock-data/wine';

import { createFilterEngine } from '@filter-enginez/core';
import { attachSuggestions } from '@filter-enginez/core/suggestions';

import type { CorpusTier } from '../corpus.js';
import type { Scenario, ScenarioCell } from '../scenario.js';

import { consume } from '../sink.js';

/** Synthetic filter vocabulary the fake sessions draw from. */
const RULE_VOCABULARY = [
	'body-full',
	'body-light',
	'color-red',
	'color-white',
	'price-high',
	'price-low',
	'region-france',
	'region-italy',
	'varietal-cabernet',
	'varietal-chardonnay',
	'varietal-pinot',
	'varietal-syrah',
];

/** How many synthetic sessions to seed the co-occurrence model with. */
const SESSION_COUNT = 300;

/**
 * Seed deterministic synthetic sessions. A tiny LCG keeps the corpus reproducible so benchmark
 * numbers don't wander between runs; each session is a small subset of the vocabulary.
 */
function seedSessions(record: (ruleIds: readonly string[]) => void): void {
	let seed = 0x1234_5678;

	for (let session = 0; session < SESSION_COUNT; session++) {
		const ids: string[] = [];

		for (const ruleId of RULE_VOCABULARY) {
			seed = (seed * 1_103_515_245 + 12_345) & 0x7fff_ffff;
			if ((seed & 0x3) === 0) {
				ids.push(ruleId);
			}
		}
		record(ids);
	}
}

export const bayesianSuggestScenario: Scenario = {
	applicableAxes: [],
	description: 'Compute top-3 suggested next filters via Bayesian co-occurrence over session history.',
	id: 'bayesian-suggest',
	setup(tier: CorpusTier): ScenarioCell {
		const engine = createFilterEngine<Wine>({ sourceData: tier.data });
		// The trio is not a property of the engine — it ships from `core/suggestions` so that
		// consumers who never ask for it do not pay for it. `attachSuggestions` memoizes per
		// engine, so the tracker seeded below is the one `getSuggestions` reads through.
		const { sessionTracker, suggestions } = attachSuggestions(engine);

		seedSessions((ruleIds) => {
			sessionTracker.recordSession(ruleIds);
		});

		const selection = ['color-red', 'varietal-pinot'];

		// Warm the model (the first getSuggestions call trains it) so the timed call is query-only.
		suggestions.getSuggestions(selection, 3);

		const run = (): void => {
			consume(suggestions.getSuggestions(selection, 3).length);
		};

		return {
			run,
			async teardown(): Promise<void> {
				await engine.destroy();
			},
		};
	},
	title: 'Bayesian suggest',
};
