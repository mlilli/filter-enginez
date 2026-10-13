/**
 * `FilterGroup` — convenience type for the AND-between-groups / OR-within-group pattern that
 * dominates real-world filter UIs.
 *
 * @remarks
 * `engine.addGroup({ id, filterIds, composition })` names rules (by id) that combine with the
 * group's own operator; groups, and any rule no group names, then AND together. The result is
 * equivalent to `setExpression(and(...standalone, ...groups.map((g) => or(...g))))` without the
 * consumer ceremony, and the rules stay addressable by id in flat-map mode. The composition lives
 * in `composeFlatExpression.ts`, which the store's `effectiveExpression` uses.
 *
 * @packageDocumentation
 */

import type { RuleId } from '../types.js';

// #region docs:filter-group-type
/**
 * Composition mode for a `FilterGroup`'s child rules.
 *
 * - `'or'` — items pass if ANY child rule matches (default; matches the Amazon-style
 *   "any color OR any color" filter UX)
 * - `'and'` — items pass only if ALL child rules match
 */
export type FilterGroupCompositionMode = 'and' | 'or';

/**
 * A named collection of rule IDs composed via the same operator.
 *
 * The engine maintains groups separately from individual rules; `effectiveExpression` derives
 * the full Boolean expression by composing each group's registered rules with its operator and
 * AND-ing the groups with the standalone rules. Ids that name no registered rule are skipped.
 */
export interface FilterGroup {
	/** Unique group identifier. */
	readonly id: string;

	/** Optional human-readable display name for UI rendering. */
	readonly displayName?: string;

	/** IDs of rules that belong to this group. */
	readonly filterIds: readonly RuleId[];

	/** Composition operator. `engine.addGroup()` fills in `'or'` when the caller omits it. */
	readonly composition: FilterGroupCompositionMode;
}
// #endregion docs:filter-group-type

/**
 * The argument `engine.addGroup()` accepts: a {@link FilterGroup} whose `composition` may be
 * omitted, in which case the engine stores the group with `composition: 'or'`.
 */
export type FilterGroupInput = {
	readonly composition?: FilterGroupCompositionMode;
} & Omit<FilterGroup, 'composition'>;
