/**
 * `activeRules` / `releaseDepartedRules` — how `FilterEngine` lets go of the prepared state of the
 * rules that leave it.
 *
 * @remarks
 * A rule keeps what `prepareForCollection` built for as long as the rule lives, and the engine is
 * not the only holder: the devtools action log keeps the rules of up to 100 past states for
 * time travel. So whenever the active rules change (a dispatched action, a time-travel restore, a
 * replay, `destroy()`), the engine compares them before and after and releases each rule that
 * left. A rule that comes back (undo, redo) is prepared again by the next pass that evaluates it.
 *
 * @packageDocumentation
 */

import type { InternalStore } from '../store/InternalStore.js';

import { CompositeRule } from '../rules/CompositeRule.js';
import { type FilterRule, releasePreparedRule } from '../rules/FilterRule.js';

/**
 * Collect `rule`, or every leaf of a composite tree, into `into`. A composite only passes the
 * prepare call to its children, so its leaves are what holds prepared state, and comparing leaves
 * keeps a child that moves to a new tree from being released.
 */
function addLeaves(rule: FilterRule, into: Set<FilterRule>): void {
	if (rule instanceof CompositeRule) {
		for (const child of rule.config.rules) {
			addLeaves(child, into);
		}

		return;
	}
	into.add(rule);
}

/**
 * Every rule the engine evaluates now: the flat-map rules and the expression's leaves.
 *
 * @param store - The engine's store
 * @returns The active leaf rules
 */
export function activeRules<T>(store: InternalStore<T>): Set<FilterRule> {
	const active = new Set<FilterRule>();

	for (const rule of store.rules.value.values()) {
		addLeaves(rule, active);
	}
	const expression = store.expression.value;

	if (expression !== null) {
		addLeaves(expression, active);
	}

	return active;
}

/**
 * Release the prepared state of every rule in `before` that is not in `after`.
 *
 * @param before - The active rules before the change
 * @param after - The active rules after it
 */
export function releaseDepartedRules(before: ReadonlySet<FilterRule>, after: ReadonlySet<FilterRule>): void {
	for (const rule of before) {
		if (!after.has(rule)) {
			releasePreparedRule(rule);
		}
	}
}
