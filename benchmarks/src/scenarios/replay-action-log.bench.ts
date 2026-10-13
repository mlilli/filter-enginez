/**
 * `replay-action-log-*` — time replaying N recorded actions from the devtools action log, at
 * N = 50, 500 and 5000. The log is filled with N `addRule` actions in `setup`; the timed call
 * replays them all from index 0 through the dispatcher. No acceleration axes apply (replay drives
 * the store, not the bitmap stack), so each scenario's matrix is one cell per tier.
 *
 * @remarks
 * The three sizes are three scenarios built by one factory (the same pattern as the fuzzy
 * strict / loose pair), so the matrix needs no extra parameter dimension. The 500-action scenario
 * keeps the bare `replay-action-log` id so results recorded under that id stay comparable. The sink reads
 * `getActiveRuleIds().length` (a cheap map-keys computed) rather than `getResultCount()` so the
 * measurement is replay cost, not a downstream predicate pass.
 *
 * @packageDocumentation
 */
import type { Wine } from '@filter-enginez/mock-data/wine';

import { createFilterEngine, value } from '@filter-enginez/core';

import type { CorpusTier } from '../corpus.js';
import type { Scenario, ScenarioCell } from '../scenario.js';

import { consume } from '../sink.js';

/** Build the replay scenario for `actionCount` recorded actions. */
function makeReplayScenario(id: string, actionCount: number): Scenario {
	return {
		applicableAxes: [],
		description: `Replay ${actionCount} actions from the devtools action log through the dispatcher.`,
		id,
		setup(tier: CorpusTier): ScenarioCell {
			const engine = createFilterEngine<Wine>({
				devtools: { actionLogSize: actionCount + 1, enabled: true },
				sourceData: tier.data,
			});

			// Fill the action log with N recorded RULE_ADDED actions.
			for (let i = 0; i < actionCount; i++) {
				engine.addRule(`rule-${i}`, value('color', i % 2 === 0 ? 'red' : 'white'));
			}

			const run = (): void => {
				engine.devtools.replay(0);
				consume(engine.getActiveRuleIds().length);
			};

			return {
				run,
				async teardown(): Promise<void> {
					await engine.destroy();
				},
			};
		},
		title: `Replay action log (${actionCount} actions)`,
	};
}

/** Replay 50 recorded actions. */
export const replayActionLog50Scenario: Scenario = makeReplayScenario('replay-action-log-50', 50);

/** Replay 500 recorded actions — the bare `replay-action-log` scenario. */
export const replayActionLogScenario: Scenario = makeReplayScenario('replay-action-log', 500);

/** Replay 5000 recorded actions. */
export const replayActionLog5000Scenario: Scenario = makeReplayScenario('replay-action-log-5000', 5000);
