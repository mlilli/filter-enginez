/**
 * `invalidateForAction` — the per-action acceleration-cache invalidation `FilterEngine` runs
 * before each dispatched action is applied.
 *
 * @packageDocumentation
 */

import type { Action } from '../store/Action.js';
import type { BitmapIndex } from './BitmapIndex.js';
import type { ExclusionGraph } from './ExclusionGraph.js';

/**
 * Targeted bitmap + exclusion-graph invalidation per action type. Per-rule actions invalidate
 * just the affected rule's bitmap (and the whole exclusion graph, since changing one rule's
 * bitmap potentially changes which pairs are mutually exclusive); source-data / wholesale
 * actions clear everything. Working-set, expression and group actions touch neither: per-rule
 * bitmaps and the pairwise graph depend on rules and source data only.
 *
 * @returns Whether the exclusion graph was invalidated (so an `'eager'` graph re-warms)
 */
export function invalidateForAction<T>(
	bitmapIndex: BitmapIndex<T>,
	exclusionGraph: ExclusionGraph<T>,
	action: Action,
): boolean {
	switch (action.type) {
		case 'EXPRESSION_SET':
		case 'GROUP_ADDED':
		case 'GROUP_REMOVED':
		case 'WORKING_SET_RESET':
		case 'WORKING_SET_SET':
			return false;
		case 'RESET':
		case 'RULES_CLEARED':
		case 'SOURCE_DATA_SET':
			bitmapIndex.clear();
			exclusionGraph.invalidate();

			return true;
		case 'RULE_ADDED':
		case 'RULE_CHANGED':
		case 'RULE_REMOVED':
			bitmapIndex.invalidateRule(action.payload.ruleId);
			exclusionGraph.invalidate();

			return true;
	}
}
