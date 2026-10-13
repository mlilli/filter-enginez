/**
 * The scenario registry — all benchmark scenarios in report order. A scenario may set `pending`
 * to be listed but skipped by the runner; none currently does.
 *
 * @packageDocumentation
 */
import type { Scenario } from '../scenario.js';

import { bayesianSuggestScenario } from './bayesian-suggest.bench.js';
import { filterIntersectionScenario } from './filter-intersection.bench.js';
import { fuzzyLooseScenario, fuzzyStrictScenario } from './fuzzy-search-query.bench.js';
import { geoRadiusQueryScenario } from './geo-radius-query.bench.js';
import {
	replayActionLog5000Scenario,
	replayActionLog50Scenario,
	replayActionLogScenario,
} from './replay-action-log.bench.js';
import { similarityFindScenario } from './similarity-find.bench.js';
import { simulatePerOptionScenario } from './simulate-per-option.bench.js';
import { textSearchQueryScenario } from './text-search-query.bench.js';

/** Every registered benchmark scenario, in the order they appear in the report. */
export const scenarios: readonly Scenario[] = [
	filterIntersectionScenario,
	simulatePerOptionScenario,
	similarityFindScenario,
	bayesianSuggestScenario,
	geoRadiusQueryScenario,
	textSearchQueryScenario,
	fuzzyStrictScenario,
	fuzzyLooseScenario,
	replayActionLog50Scenario,
	replayActionLogScenario,
	replayActionLog5000Scenario,
];
