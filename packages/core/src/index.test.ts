/**
 * @remarks
 * Barrel-export sanity for `@filter-enginez/core/index.ts`. Asserts that a representative
 * sample across EVERY `export { … } from` block resolves to a live binding (a defined
 * function / class / constant — not `undefined`), guarding against a re-export typo or a
 * deleted symbol silently breaking the public API. Type-only re-exports are not asserted at
 * runtime (they have no runtime presence); they are covered by `tsc` over this file's imports.
 */

import { describe, expect, it } from 'vitest';

import * as core from './index.js';

describe('@filter-enginez/core barrel', () => {
	it('re-exports the rule catalog (classes + factories + registry)', () => {
		expect(typeof core.FilterRule).toBe('function');
		expect(typeof core.ValueRule).toBe('function');
		expect(typeof core.RangeRule).toBe('function');
		expect(typeof core.InSetRule).toBe('function');
		expect(typeof core.CompositeRule).toBe('function');
		expect(typeof core.value).toBe('function');
		expect(typeof core.range).toBe('function');
		expect(typeof core.inSet).toBe('function');
		expect(typeof core.RuleRegistry).toBe('function');
		expect(core.ruleRegistry).toBeDefined();
		expect(typeof core.haversineKm).toBe('function');
	});

	it('re-exports the composition layer (and/or/not + evaluator + simplify)', () => {
		expect(typeof core.and).toBe('function');
		expect(typeof core.or).toBe('function');
		expect(typeof core.not).toBe('function');
		expect(typeof core.evaluateExpression).toBe('function');
		expect(typeof core.applyExpression).toBe('function');
		expect(typeof core.simplify).toBe('function');
	});

	it('re-exports the storage layer', () => {
		expect(typeof core.MemoryStorageAdapter).toBe('function');
	});

	it('re-exports the internal store (classes + snapshot helpers)', () => {
		expect(typeof core.InternalStore).toBe('function');
		expect(typeof core.Dispatcher).toBe('function');
		expect(typeof core.captureSnapshot).toBe('function');
		expect(typeof core.restoreSnapshot).toBe('function');
	});

	it('re-exports the devtools layer', () => {
		expect(typeof core.Devtools).toBe('function');
		expect(typeof core.ActionLog).toBe('function');
		expect(typeof core.TimeTravel).toBe('function');
		expect(typeof core.Replay).toBe('function');
		expect(typeof core.diff).toBe('function');
		expect(typeof core.ReduxDevtoolsBridge).toBe('function');
		expect(typeof core.DevtoolsPersistence).toBe('function');
	});

	it('re-exports the acceleration internals', () => {
		expect(typeof core.BitmapIndex).toBe('function');
		expect(typeof core.ExclusionGraph).toBe('function');
		expect(typeof core.SimulationCache).toBe('function');
		expect(typeof core.SpatialIndex).toBe('function');
		expect(typeof core.initializeBitmapAcceleration).toBe('function');
		expect(typeof core.isBitmapAccelerationReady).toBe('function');
		expect(core.AUTO_BITMAP_THRESHOLD).toBe(500);
		expect(core.TEXT_INDEX_AUTO_THRESHOLD).toBe(500);
	});

	it('does NOT re-export the similarity layer, which is opt-in via ./similarity', () => {
		// Inverted deliberately. `similarity/` left the root barrel so that a consumer who never asks
		// "what is similar to this?" stops shipping MinHash + LSH — 1.65 kB gzipped, measured. A
		// re-export here would put it straight back in every bundle while every other test stayed
		// green, which is exactly how the cost accumulated in the first place.
		expect('LSH' in core).toBe(false);
		expect('MinHash' in core).toBe(false);
		expect('SimilaritySearch' in core).toBe(false);
	});

	it('does NOT re-export the suggestions layer, which is opt-in via ./suggestions', () => {
		// Inverted deliberately, for the same reason as the similarity case above. `suggestions/`
		// left the root barrel so that a consumer who never asks "what filter should I offer next?"
		// stops shipping the session tracker, the co-occurrence model and the orchestrator — 561 B
		// gzipped, measured. `SuggestionResult` goes with them: it is only meaningful to a caller
		// who has already imported the subpath.
		expect('BayesianModel' in core).toBe(false);
		expect('SessionTracker' in core).toBe(false);
		expect('SuggestionEngine' in core).toBe(false);
		expect('attachSuggestions' in core).toBe(false);
	});

	it('re-exports the JSON config layer (functions + version constant)', () => {
		expect(typeof core.loadConfig).toBe('function');
		expect(typeof core.exportConfig).toBe('function');
		expect(typeof core.resolveConfig).toBe('function');
		expect(typeof core.ConfigMigrator).toBe('function');
		expect(core.defaultMigrator).toBeDefined();
		expect(core.CURRENT_CONFIG_VERSION).toBe(1);
	});

	it('re-exports the main engine class + factory', () => {
		expect(typeof core.FilterEngine).toBe('function');
		expect(typeof core.createFilterEngine).toBe('function');
	});

	it('re-exports the lib helpers', () => {
		expect(typeof core.LRUCache).toBe('function');
		expect(typeof core.LRUCacheNode).toBe('function');
		expect(typeof core.differenceSet).toBe('function');
		expect(typeof core.intersectionSet).toBe('function');
		expect(typeof core.unionSet).toBe('function');
		expect(typeof core.getPath).toBe('function');
		expect(typeof core.parsePath).toBe('function');
	});

	it('a re-exported factory produces a working engine end to end', () => {
		const engine = core.createFilterEngine<{ color: string }>({
			sourceData: [{ color: 'red' }, { color: 'blue' }],
		});

		engine.addRule('color', core.value('color', 'red'));
		expect(engine.getRule('color')).toBeInstanceOf(core.ValueRule);
	});
});
