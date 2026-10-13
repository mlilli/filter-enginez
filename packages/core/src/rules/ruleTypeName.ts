/**
 * `getRuleTypeName` — read a rule instance's declared, minifier-proof type name.
 *
 * @remarks
 * ### Why the wire name is a declared literal
 *
 * A minifier rewrites class identifiers, so `this.constructor.name` cannot serve as a rule's wire
 * name: in a production build `InSetRule` can become `d`, while `ruleRegistry` keys stay string
 * literals (`register('InSetRule', …)`), which are not mangled. A name taken from the constructor
 * would then fail `ruleRegistry.deserialize` with `Unknown rule type: 'd'` — and only in minified
 * builds, so `?f=` shareable links, the worker tier, JSON-config load and devtools snapshots would
 * stop restoring in production while dev servers (which do not minify) kept working. Each rule
 * class therefore declares a `static ruleTypeName` string literal, which minifiers leave intact.
 *
 * ### Why a static rather than `keepNames`
 *
 * A `keepNames` bundler flag only helps builds whose config sets it. `@filter-enginez/core`
 * publishes unminified ESM and is minified by **the consumer's** bundler, which no flag of ours
 * reaches — so for a library the only sufficient design is one that does not depend on class
 * identifiers surviving at all.
 *
 * `ruleRegistry.register` enforces that a class's `ruleTypeName` matches the name it registers
 * under, at compile time for TypeScript consumers and at registration time for everyone else —
 * so the static and the registry key always agree.
 *
 * @packageDocumentation
 */

import type { FilterRule } from './FilterRule.js';

/**
 * Read the `ruleTypeName` a rule's class declares.
 *
 * @remarks
 * **This accessor never throws.** It is used for diagnostics as well as serialization — the
 * worker bridge's devtools "args" column labels every action with it, and a label must never break
 * the action log; a vague label is acceptable. A rule whose class never declared the static
 * inherits the abstract base's `'FilterRule'`, which is readable as a fallback and can never
 * collide with a registered name (the base is abstract, so it can never itself be registered).
 *
 * The contract is enforced where enforcement belongs: `FilterRule.serialize()` throws on the
 * undeclared case, and `ruleRegistry.register` rejects a mismatch.
 *
 * @param rule - Any filter-rule instance
 * @returns The declared type name, or `'FilterRule'` when the class never declared one
 */
export function getRuleTypeName(rule: FilterRule): string {
	return (rule.constructor as typeof FilterRule).ruleTypeName;
}
