/**
 * `FilterBundleQuery` + `FilterBundle` — the single-round-trip "ask the engine for everything
 * the UI needs to render a new filter state" types.
 *
 * @remarks
 * The alternative is a cascade of separate Comlink calls per filter change: one for results,
 * one per slider for filtered-except-self values, one per chip for exclusion simulation. For a
 * filter panel with 4 sliders + 4 chip groups (~50 candidate values), that's ~65 worker
 * round-trips per single user click — each one serialized through the worker's message queue,
 * each one a separate React state update on the main thread, all contributing to multi-second
 * main-thread saturation.
 *
 * The single-round-trip pattern collapses that cascade into ONE engine call. The consumer
 * passes a `FilterBundleQuery` describing what metadata it needs; the engine returns a
 * `FilterBundle` containing results + ALL requested metadata, computed in a single pass over
 * the working set. The worker is then idle until the next user action.
 *
 * **Why per-component query (not "always return everything").** Different consumers want
 * different metadata. A "results-only" embed wouldn't need slider bounds; a "facet picker"
 * embed might want only chip exclusion data. By making the query consumer-driven, the engine
 * does exactly the work that's needed — no more, no less.
 *
 * **Histograms are pre-bucketed on the engine.** The slider field meta carries `counts` (a
 * `Uint32Array` of per-bucket counts) rather than raw values. For a corpus where a single
 * field can have thousands of distinct values, shipping the raw values just so the main
 * thread can bucket them is wasteful. The engine has everything it needs to bucket directly
 * and ship the counts — ~12-30 numbers per slider instead of thousands. The typed arrays
 * are transferable for zero-copy postMessage.
 *
 * **Two kinds of metadata.** Slider field metadata (`fields`) and per-chip-group exclusion
 * simulation data (`chipGroups`) — the latter answers in one bundled response what a
 * `useExclusion`-style per-candidate `simulate()` fanout would ask for one call at a time.
 *
 * @packageDocumentation
 */

import type { RuleId } from './types.js';

/**
 * Per-field request for filtered-except-self bounds + histogram bucketing.
 */
export interface FilterBundleFieldQuery {
	/**
	 * Rule id to EXCLUDE from the filter pass when computing this field's values.
	 *
	 * @remarks
	 * Powers the "filtered-except-self" semantic that makes a three-layer range-slider
	 * design work: the available zone of the price slider is derived by filtering
	 * everything EXCEPT the price rule, so dragging the price handle doesn't shift the
	 * slider's own dim zones.
	 *
	 * If no rule with this id is currently active, the field values come from every working-
	 * set item that passes the current full rule set (i.e., equivalent to asking for raw
	 * values across the current results).
	 */
	readonly ruleId: RuleId;
	/**
	 * Top-level numeric property name to extract from each surviving item. Same constraint
	 * as `FilterEngine.getFilteredFieldValuesExcept` — nested paths aren't supported.
	 */
	readonly fieldKey: string;
	/**
	 * Number of equal-width buckets to subdivide the value range into for histogram
	 * generation. Default: 12 (matches the wine example's canonical slider mockup).
	 *
	 * **Bucket edges span the BASELINE range, not the filtered range.** Per the three-layer
	 * slider semantics, the histogram bars represent positions on the slider's full track
	 * (baseline min..baseline max); buckets outside the available zone simply have count 0.
	 * Consumers must pass the baseline min/max via `baselineMin`/`baselineMax` if they want
	 * the histogram to align with the slider track. Defaults to using the filtered-set's
	 * tight bounds when those aren't provided.
	 */
	readonly bucketCount?: number;
	/**
	 * Optional baseline range to bucket against. When provided, histogram bucket edges span
	 * `[baselineMin, baselineMax]` regardless of where the filtered values fall — gives a
	 * stable histogram geometry as filters change.
	 */
	readonly baselineMin?: number;
	/**
	 * Companion to `baselineMin`. Pair them.
	 */
	readonly baselineMax?: number;
}

/**
 * Per-chip-group request for bundled exclusion simulation. Answers in one call what a
 * per-candidate `simulate()` fanout (as `useExclusion`-style hooks drive) would need one Comlink
 * round-trip per candidate value for.
 *
 * @remarks
 * **The wire-shape constraint.** The query crosses the postMessage boundary, so we cannot
 * ship a `buildRuleForValue` factory function as `useExclusion` does. Instead, the consumer
 * specifies the rule SHAPE via the `kind` discriminator. Three kinds supported:
 *
 *   - **`'inSet'`** — simple per-value membership. Each candidate is a single string;
 *     "selecting this candidate" means adding that single string to the rule's value set.
 *     Drives chip groups like color/body/sweetness/varietal.
 *   - **`'inSetOfSets'`** — hierarchical / multi-value membership. Each candidate is a node
 *     plus the SET of leaf values that selecting it would imply. "Selecting Italy" means
 *     adding all Italian region/subregion IDs to the rule's value set. Drives hierarchical
 *     pickers like origin (country → region → subregion).
 *   - **`'containsAll'`** — conjunctive membership over an ARRAY-valued field. Each candidate
 *     is one value the array must contain, and selecting it NARROWS an existing requirement
 *     rather than widening a set. Drives must-have checklists like real estate's `features`.
 *
 * ### Disjunctive vs conjunctive candidates — the distinction that drives the projection
 *
 * `'inSet'` and `'inSetOfSets'` are **disjunctive**: selecting a candidate widens the rule
 * (`field ∈ set`), so results after the click are a SUPERSET of "everything else, plus this
 * one value". The honest projection therefore drops the group's own rule and tests the
 * candidate alone — which is exactly what `passesExcept(…, excludeIdx)` does.
 *
 * `'containsAll'` is **conjunctive**: selecting a candidate narrows
 * (`array ⊇ required ∪ {candidate}`), so results after the click are a SUBSET of what is
 * showing now. Dropping the group's own rule would project each value in isolation, ignoring
 * everything already checked, and report a candidate as reachable when combining it with the
 * current selection matches nothing. That is a false ENABLE — more harmful than no
 * predictive disable, because a disabled-looking UI that lies is trusted. So a conjunctive
 * group keeps its own rule ACTIVE and requires the candidate on top of it.
 *
 * The already-selected invariant falls out for free: a checked value is part of the live
 * requirement, so every current result contains it and its projected count equals the current
 * result count. A user can always uncheck.
 *
 * **Computed in the same single pass as field metadata.** The engine evaluates each chip's
 * hypothetical rule against the relevant subset of items in the same workingSet iteration
 * that produces results + field bounds + histograms. No additional Comlink round-trips, no
 * additional iterations.
 */
export type FilterBundleChipGroupQuery =
	| {
		/**
		 * Rule id this checklist toggles — a rule with conjunctive (AND) semantics over an
		 * array-valued field, such as a "must have every one of these" requirement.
		 */
		readonly kind: 'containsAll';
		readonly ruleId: RuleId;
		/**
		 * Top-level ARRAY field the constructed rule tests. Items pass when `item[field]` is an
		 * array containing the candidate — alongside everything the rule already requires.
		 *
		 * Unlike the disjunctive kinds, which read a single string, this reads a `string[]` and
		 * attributes the item to EVERY value it contains. Non-array values are skipped, matching
		 * how the disjunctive kinds skip non-strings.
		 */
		readonly field: string;
		/**
		 * The candidate values to simulate, in display order — one per checklist row.
		 *
		 * Note there is no `selected` member: the currently-required values are already encoded
		 * in the live rule, which a conjunctive projection keeps active. Passing them again would
		 * be a second source of truth, and a stale one the moment the rule changes.
		 */
		readonly candidates: readonly string[];
	}
	| {
		/**
		 * Rule id this chip group toggles. When the user clicks a chip, the consumer's
		 * onToggle handler calls `addRule(ruleId, ...)` to commit the selection — same id.
		 */
		readonly kind: 'inSet';
		readonly ruleId: RuleId;
		/**
		 * Top-level field the constructed rule should test against. Items pass when
		 * `item[field] === candidate`.
		 */
		readonly field: string;
		/**
		 * The candidate values to simulate, in display order.
		 */
		readonly candidates: readonly string[];
	}
	| {
		/**
		 * Rule id this hierarchical group toggles.
		 */
		readonly kind: 'inSetOfSets';
		readonly ruleId: RuleId;
		/**
		 * Top-level field the constructed rule should test against. Items pass when
		 * `item[field]` is in the candidate's `leafIds` set.
		 */
		readonly field: string;
		/**
		 * The candidate node specs to simulate, in display order. Each carries the `value`
		 * (the node's id, echoed back as the value key in the response) and `leafIds` (every
		 * descendant leaf id that selecting this node would activate).
		 *
		 * For a country in the origin picker: `{value: 'IT', leafIds: ['IT-PIE', 'IT-VEN', ...]}`.
		 * For a leaf: `{value: 'IT-PIE', leafIds: ['IT-PIE']}` — single-element set works too.
		 */
		readonly candidates: readonly {
			readonly leafIds: readonly string[];
			readonly value: string;
		}[];
	};

/**
 * Per-candidate exclusion data returned in the bundle for a single chip group.
 */
export interface FilterBundleChipCandidateMeta {
	/** Echoed from the query for round-trip identification. */
	readonly value: string;
	/**
	 * `true` when adding this candidate to the rule's value set would produce ZERO results
	 * given every OTHER currently-active rule. The signal that drives "dimmed but clickable"
	 * chip visuals.
	 */
	readonly wouldBeEmpty: boolean;
	/**
	 * Projected result count if this candidate were added to the rule. Used by chip count
	 * badges that show "(245)" next to "Red" etc.
	 */
	readonly projectedCount: number;
}

/**
 * Per-chip-group metadata returned in the bundle.
 */
export interface FilterBundleChipGroupMeta {
	/** Echoed from the query for round-trip identification. */
	readonly ruleId: RuleId;
	/**
	 * Per-candidate exclusion data in the same order as the query's `candidates`.
	 */
	readonly candidates: readonly FilterBundleChipCandidateMeta[];
}

/**
 * Top-level query the consumer hands to `applyFiltersAndQuery`. Carries field requests
 * (slider bounds + histograms) AND chip-group requests (per-candidate exclusion data) so
 * a single engine call returns EVERYTHING the consumer UI needs to render a filter state.
 */
export interface FilterBundleQuery {
	/**
	 * Per-field requests. Order is preserved in the returned bundle's `fields` array, so
	 * consumers can match by index rather than searching by ruleId.
	 */
	readonly fields?: readonly FilterBundleFieldQuery[];
	/**
	 * Per-chip-group requests. Order is preserved in the returned bundle's `chipGroups`
	 * array. Eliminates the per-candidate `simulate()` fanout pattern that powered
	 * `useExclusion`.
	 */
	readonly chipGroups?: readonly FilterBundleChipGroupQuery[];
}

/**
 * Per-field metadata returned by `applyFiltersAndQuery`.
 */
export interface FilterBundleFieldMeta {
	/** Echoed from the query for round-trip identification. */
	readonly ruleId: RuleId;
	/** Echoed from the query. */
	readonly fieldKey: string;
	/**
	 * Tight `{min, max}` over the filtered-except-this-rule subset. When the subset is
	 * empty (no items pass the other rules), `min` and `max` are both `null` — consumers
	 * should fall back to baseline bounds in that case.
	 */
	readonly bounds: {
		readonly max: number | null;
		readonly min: number | null;
	};
	/**
	 * Pre-bucketed histogram. Both arrays are postMessage-transferable for zero-copy
	 * shipping from the worker.
	 *
	 * `bucketEdges` has length `bucketCount + 1` — `bucketEdges[i]` is the left edge of
	 * bucket i and `bucketEdges[i+1]` is the right edge. `counts[i]` is the number of
	 * filtered-except-self items whose value falls in bucket i — the conventional histogram
	 * shape, so consumer rendering code can bind to it directly.
	 */
	readonly histogram: {
		readonly bucketEdges: Float64Array;
		readonly counts: Uint32Array;
	};
}

/**
 * The bundled response returned by `applyFiltersAndQuery`.
 */
export interface FilterBundle {
	/**
	 * Indices into `workingSet` for items passing the FULL active rule set (i.e., current
	 * results). Postmessage-transferable Uint32Array — same shape as
	 * `FilterEngine.getResultIndices()`.
	 */
	readonly resultIndices: Uint32Array;
	/** `resultIndices.length`, broken out for cheap consumer access. */
	readonly resultCount: number;
	/**
	 * Per-field metadata in the same order as the query's `fields`. Empty array when the
	 * query didn't request any fields.
	 */
	readonly fields: readonly FilterBundleFieldMeta[];
	/**
	 * Per-chip-group metadata in the same order as the query's `chipGroups`. Empty array
	 * when the query didn't request any chip groups.
	 */
	readonly chipGroups: readonly FilterBundleChipGroupMeta[];
}
