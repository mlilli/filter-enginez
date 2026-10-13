/**
 * `simplify` — algebraic simplification of `CompositeRule` expression trees.
 *
 * @remarks
 * Per `docs/architecture.md` §5.4. The store applies it to the effective expression before
 * evaluating (`InternalStore.effectiveExpression`), so redundant wrappers cost nothing per item.
 * Invisible to consumers — `engine.getExpression()` returns the tree exactly as it was set, for
 * round-trip fidelity; only evaluation sees the simplified form.
 *
 * `null` means "no constraint" (every item passes), matching the evaluator's treatment of an
 * empty `and` / `or` / `not`. Simplifications applied:
 *   - `and()` / `or()` / `not()` with zero children → `null`
 *   - `and(x)` / `or(x)` (single child) → `x`
 *   - `not(not(x))` → `x` (double-negation elimination)
 *   - children are simplified first; a child that simplifies to `null` is dropped from an `and`,
 *     makes an enclosing `or` `null` (one always-true disjunct satisfies it), and under a `not`
 *     yields `not(and())` — the canonical "matches nothing"
 *
 * Every rewrite preserves the evaluator's answer for every item.
 *
 * @packageDocumentation
 */

import type { FilterRule } from '../rules/FilterRule.js';

import { CompositeRule } from '../rules/CompositeRule.js';

// #region docs:simplify
/**
 * Simplify an expression tree. Returns:
 *   - `null` if the expression reduces to "no constraint" (every item passes)
 *   - A `FilterRule` if simplification collapses to a single leaf
 *   - A new `CompositeRule` with simplified children otherwise
 *
 * @param rule - The expression tree to simplify
 * @returns The simplified expression, or `null` if no constraint
 */
export function simplify(rule: FilterRule): FilterRule | null {
	if (!(rule instanceof CompositeRule)) {
		return rule;
	}

	const { op, rules: children } = rule.config;

	// The evaluator reads only the first child of a `not`; an empty `not` passes everything.
	const operands = op === 'not' ? children.slice(0, 1) : children;

	// Recursively simplify children first.
	const simplifiedChildren: FilterRule[] = [];

	for (const child of operands) {
		const simplified = simplify(child);

		if (simplified !== null) {
			simplifiedChildren.push(simplified);
			continue;
		}
		// The child constrains nothing (always true).
		if (op === 'or') {
			return null;
		}
		if (op === 'not') {
			return new CompositeRule('not', [new CompositeRule('and', [])]);
		}
		// `and`: an always-true conjunct is dropped.
	}

	const [firstChild] = simplifiedChildren;

	// Zero children → no constraint (`not()` passes everything, as does an empty and/or).
	if (firstChild === undefined) {
		return null;
	}

	// and(x) / or(x) → x (single-child collapse)
	if (op !== 'not' && simplifiedChildren.length === 1) {
		return firstChild;
	}

	// not(not(x)) → x (double-negation elimination)
	if (op === 'not') {
		const inner = firstChild;

		if (inner instanceof CompositeRule && inner.config.op === 'not') {
			const [innerChild] = inner.config.rules;

			// `inner` is already simplified, and a simplified `not` always has exactly one child, so
			// the `=== undefined` arm is unreachable but required by `noUncheckedIndexedAccess`.
			/* v8 ignore next 3 -- defensive: unreachable guard (a simplified `not` has one child) */
			if (innerChild !== undefined) {
				return simplify(innerChild);
			}
		}
	}

	return new CompositeRule(op, simplifiedChildren);
}
// #endregion docs:simplify
