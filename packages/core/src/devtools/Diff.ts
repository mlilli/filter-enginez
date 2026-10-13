/**
 * `diff()` — state-diff between two snapshots, wrapping `microdiff`.
 *
 * @remarks
 * Per `docs/architecture.md` §10.4. Used by the devtools UI to render "what changed between
 * action N and action M" — useful for understanding cascading filter effects or replaying
 * specific deltas.
 *
 * `microdiff` is ~1KB, returns an array of `{type, path, oldValue?, value?}` edits. We re-export
 * its types to avoid coupling consumers to a specific microdiff version.
 *
 * Snapshots hold live rules in a `Map`, which `microdiff` cannot walk, so both sides are first
 * converted to a plain view: `rules` becomes an object keyed by rule id whose values are the
 * rules' `serialize()` output, `expression` becomes its serialized tree, and `capturedAt` is
 * left out (it differs between any two snapshots and says nothing about state). Paths in the
 * result therefore read `['rules', 'price', 'config', 'max']`. A rule that cannot serialize
 * (`PredicateRule`) is compared as the instance itself, so swapping one predicate for another
 * still shows up as a change.
 *
 * @packageDocumentation
 */

import microdiff, { type Difference } from 'microdiff';

import type { FilterRule } from '../rules/FilterRule.js';
import type { EngineSnapshot } from '../store/snapshots.js';

/**
 * The shape of a single diff edit produced by `diff()`.
 *
 * Mirrors `microdiff`'s `Difference` type; re-exported so consumers don't have to import
 * `microdiff` themselves.
 */
export type StateDiffEntry = Difference;

/**
 * Diff two engine snapshots, returning a list of edits that transform `from` into `to`.
 *
 * @param from - The earlier snapshot
 * @param to - The later snapshot
 * @returns Array of edits (CREATE / REMOVE / CHANGE operations with path + values)
 */
export function diff(from: EngineSnapshot, to: EngineSnapshot): readonly StateDiffEntry[] {
	return microdiff(toDiffView(from), toDiffView(to));
}

/** A rule's serialized form, or the instance itself when it cannot serialize. */
function ruleView(rule: FilterRule): unknown {
	try {
		return rule.serialize();
	} catch {
		return rule;
	}
}

/** The plain, `microdiff`-walkable view of a snapshot described in the module docs. */
function toDiffView(snapshot: EngineSnapshot): Record<string, unknown> {
	const rules: Record<string, unknown> = {};

	for (const [id, rule] of snapshot.rules) {
		rules[id] = ruleView(rule);
	}

	return {
		expression: snapshot.expression === null ? null : ruleView(snapshot.expression),
		groups: snapshot.groups,
		lastChangeRuleId: snapshot.lastChangeRuleId,
		rules,
		sourceDataVersion: snapshot.sourceDataVersion,
		workingSetVersion: snapshot.workingSetVersion,
	};
}
