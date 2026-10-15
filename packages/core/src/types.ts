/**
 * Shared type definitions for the Filter EngineZ core.
 *
 * @remarks
 * The types in this file are exported from `@filter-enginez/core` and consumed by every other
 * package in the monorepo. They define the engine's public type vocabulary: filter rule
 * identifiers, the field-extractor lens, the change-event union, and the unsubscribe contract.
 *
 * @packageDocumentation
 */

import type { CompositeRule } from './rules/CompositeRule.js';
import type { FilterRule } from './rules/FilterRule.js';

/**
 * Unique identifier for a rule within an engine instance.
 *
 * Consumer-defined string. Convention is kebab-case (`'price-range'`, `'color-set'`) but the
 * engine does not enforce a format. Two rules with the same `RuleId` in the same engine
 * overwrite each other.
 */
export type RuleId = string;

// #region docs:field-extractor
/**
 * The `FieldExtractor` — a functional lens for pulling the value-to-test out of an item.
 *
 * Four forms, each useful for a different access pattern:
 *
 * - **`undefined`** — the item itself is the value (use when items are primitives)
 * - **`string`** — a dotted path resolved via `getPath` (`'address.city'`, `'tags[0]'`)
 * - **`string[]`** — multiple paths tried in order, returning the first non-undefined match
 *   (useful when a value could live at different paths in different items)
 * - **`(item) => unknown`** — arbitrary extractor function (the escape hatch for any access
 *   pattern the string forms can't express)
 *
 * Only the first three forms serialize. A function is written as the placeholder `'<function>'` by
 * `serialize()` / `exportConfig`, and revives as `undefined` — "the item itself" — so a rule that
 * travels through a config document, a URL, a worker or a server names its field by path. Where the
 * value needs computing, store it on the item and name that field.
 *
 * @example
 *   // Simple property:
 *   const f1: FieldExtractor = 'price';
 *
 *   // Nested:
 *   const f2: FieldExtractor = 'address.city';
 *
 *   // Multi-path fallback:
 *   const f3: FieldExtractor = ['mailingAddress.city', 'address.city'];
 *
 *   // Computed:
 *   const f4: FieldExtractor = (item) => (item as Wine).tastingNotes.join(' ');
 *
 *   // Item itself is the value:
 *   const f5: FieldExtractor = undefined;
 */
export type FieldExtractor =
	| string
	| ((item: unknown) => unknown)
	| undefined
	| readonly string[];
// #endregion docs:field-extractor

/**
 * The predicate function every concrete `FilterRule` implements.
 *
 * Receives both the item being tested AND the rule itself (so rule subclasses can access
 * `config` typed-narrowly via `(rule as MyRule).config`).
 *
 * @returns `true` if the item passes the rule, `false` if filtered out
 */
export type FilterRuleAction = (item: unknown, rule: FilterRule) => boolean;

/**
 * Serialized form of a rule — the shape used by JSON config loading, URL-state serialization,
 * worker-bridge postMessage, and devtools snapshot persistence.
 *
 * @remarks
 * The `type` field maps to a registered rule class via the `RuleRegistry`. The `field` is
 * normalized to its serializable form (functions become the string `'<function>'` placeholder,
 * which deserializes to `undefined`: the round-trip is lossy). The `config` is JSON-serializable;
 * rules with non-JSON-safe configs override `serialize()`.
 */
export interface SerializedRule {
	readonly config: unknown;
	/**
	 * The serializable field form. Functions are normalized to the string `'<function>'`
	 * placeholder (lossy round-trip) — covered by `FieldExtractor`'s `string` member.
	 */
	readonly field: FieldExtractor;
	readonly type: string;
}

/**
 * Change event union — every shape of state mutation the engine emits to subscribers.
 *
 * Subscribers receive these via `engine.subscribe(listener)`. The reactive surface adapters
 * (`reactive-signals`, `reactive-rxjs`) lift these into signal/observable surfaces.
 */
export type ChangeEvent =
	| {
		readonly next: CompositeRule | null;
		readonly previous: CompositeRule | null;
		readonly type: 'expression';
	}
	| {
		readonly next: FilterRule;
		readonly previous: FilterRule;
		readonly ruleId: RuleId;
		readonly type: 'rule:changed';
	}
	| {
		readonly next: readonly unknown[];
		readonly previous: readonly unknown[];
		readonly type: 'results';
	}
	| {
		readonly next: readonly unknown[];
		readonly previous: readonly unknown[];
		readonly type: 'sourceData';
	}
	| {
		readonly next: readonly unknown[];
		readonly previous: readonly unknown[];
		readonly type: 'workingSet';
	}
	| {
		readonly rule: FilterRule;
		readonly ruleId: RuleId;
		readonly type: 'rule:added';
	}
	| {
		readonly rule: FilterRule;
		readonly ruleId: RuleId;
		readonly type: 'rule:removed';
	}
	| {
		readonly type: 'reset';
	};

/**
 * Callback signature for `engine.subscribe(listener)`.
 *
 * @param event - The change event that fired
 */
export type ChangeListener = (event: ChangeEvent) => void;

/**
 * Returned from `engine.subscribe(listener)` — call to unsubscribe.
 */
export type Unsubscribe = () => void;

/**
 * Hypothetical modification for `engine.simulate({ ... })`. Each field is optional and may
 * be combined; the simulation applies all specified mods to a clone of current state and
 * computes the resulting filtered set.
 *
 * @remarks
 * Used by the "disable filter options that would yield zero results" UX — UIs call
 * `simulate({ withRule: hypothetical })` per option, render `wouldBeEmpty` as a `disabled`
 * checkbox state. Memoized via `internals/SimulationCache` so per-option calls during a
 * single render are cheap.
 */
export interface SimulationModification {
	/** Hypothetically add or replace a rule. Tuple is `[ruleId, rule]`. */
	readonly withRule?: readonly [RuleId, FilterRule];
	/** Hypothetically remove a rule by id. */
	readonly withoutRule?: RuleId;
	/** Hypothetically swap the source data. */
	readonly withSourceData?: readonly unknown[];
	/** Hypothetically swap the expression. `null` clears expression mode. */
	readonly withExpression?: CompositeRule | null;
	/** Skip these rules during evaluation. */
	readonly ignoreRules?: readonly RuleId[];
}

/**
 * Returned from `engine.simulate(...)`. Contains the projected result count, a small preview
 * sample, the "would be empty" boolean, and a cache-key string for consumer-side memoization.
 */
export interface SimulationResult<T> {
	readonly resultCount: number;
	/** First N items (default 5) for preview rendering. */
	readonly sample: readonly T[];
	readonly wouldBeEmpty: boolean;
	/**
	 * Stable string fingerprint of `(modification + active rule set + source-data version)`.
	 * Consumers can compare cache keys to detect when a stale result needs to re-fetch.
	 */
	readonly cacheKey: string;
}
