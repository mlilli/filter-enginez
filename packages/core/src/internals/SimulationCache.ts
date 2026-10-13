/**
 * `SimulationCache` — LRU-memoized `engine.simulate()` results.
 *
 * @remarks
 * Per `docs/architecture.md` §6.4. The hot path for "disable filter options that would yield
 * zero results" UX — UIs call `simulate({ withRule: hypothetical })` per option per render.
 * Without caching, that's N predicate evaluations per render for N options; with caching,
 * it's N during the initial render and 0 across subsequent renders (until the engine state
 * changes — every dispatched action and every time-travel restore clears the cache).
 *
 * **Cache key composition.** The key is a JSON-stringified tuple of:
 *
 *   1. The modification fingerprint — each hypothetical rule or expression by its `serialize()`
 *      output, or by object identity when it cannot serialize (a `PredicateRule`), and a
 *      `withSourceData` array by identity
 *   2. The active rule set's fingerprint (sorted `ruleId=serialized` joined, identity for
 *      non-serializable rules)
 *   3. The source-data version (an integer; invalidates on every `setSourceData`)
 *   4. The working-set version (separately invalidates when consumers supply a pre-filtered
 *      subset via `setWorkingSet`)
 *
 * **Resolution order during `simulate(modification)`:**
 *
 *   1. **Cache hit** → return cached. O(1) (well, O(key-construction-cost)).
 *   2. **Exclusion-graph short-circuit** (attached + ready, and the modification is a plain
 *      `withRule` in flat-map mode) → if the hypothetical rule is mutually exclusive with another
 *      active rule, return `wouldBeEmpty: true` without evaluating anything.
 *   3. **Bitmap-intersection path** (attached + ready) → compute via
 *      `BitmapIndex.simulateIntersection`, which declines anything that is not a conjunction over
 *      the source data. O(rules × bitmap-pop) — sub-linear in items.
 *   4. **Predicate-evaluator fallback** — walk the working set, evaluate each item against
 *      the modified expression (filter groups included). O(items × rules). Always correct.
 *   5. Cache the result, return.
 *
 * @packageDocumentation
 */

import type { FilterRule } from '../rules/FilterRule.js';
import type { Action } from '../store/Action.js';
import type { InternalStore } from '../store/InternalStore.js';
import type {
	RuleId,
	SimulationModification,
	SimulationResult,
} from '../types.js';
import type { BitmapIndex } from './BitmapIndex.js';
import type { ExclusionGraph } from './ExclusionGraph.js';

import { composeFlatExpression } from '../composition/composeFlatExpression.js';
import { evaluateExpression } from '../composition/ExpressionEvaluator.js';
import { LRUCache } from '../lib/LRUCache.js';

/**
 * Options for `SimulationCache` construction.
 */
export interface SimulationCacheOptions<T> {
	/** Maximum cached simulation results. LRU evicts beyond. Default 100. */
	readonly maxEntries?: number;
	/** Number of items in the preview sample on each result. Default 5. */
	readonly sampleSize?: number;
	/** Optional bitmap index for the fast-path intersection. */
	readonly bitmapIndex?: BitmapIndex<T>;
	/**
	 * Whether the LRU memoization layer is active. Default `true`. When `false`, `simulate()`
	 * still runs the exclusion → bitmap → predicate resolution but never reads or writes the
	 * cache — every call recomputes from scratch. This is the `acceleration.simulationCache`
	 * off-switch, used to isolate the memoization layer in the benchmark matrix.
	 */
	readonly enabled?: boolean;
	/** Optional exclusion graph for the wouldBeEmpty short-circuit. */
	readonly exclusionGraph?: ExclusionGraph<T>;
}

/**
 * Memoized simulation cache backed by `LRUCache`.
 */
export class SimulationCache<T> {
	private _bitmapIndex: BitmapIndex<T> | undefined;
	private readonly _cache: LRUCache<SimulationResult<T>>;
	private readonly _enabled: boolean;
	private _exclusionGraph: ExclusionGraph<T> | undefined;
	private readonly _sampleSize: number;

	constructor(
		private readonly _store: InternalStore<T>,
		options: SimulationCacheOptions<T> = {},
	) {
		this._cache = new LRUCache<SimulationResult<T>>(options.maxEntries ?? 100);
		this._enabled = options.enabled ?? true;
		this._sampleSize = options.sampleSize ?? 5;
		this._bitmapIndex = options.bitmapIndex;
		this._exclusionGraph = options.exclusionGraph;
	}

	/** Wire (or replace) the `BitmapIndex` used for the fast-path intersection. */
	attachBitmapIndex(bitmapIndex: BitmapIndex<T>): void {
		this._bitmapIndex = bitmapIndex;
	}

	/** Wire (or replace) the `ExclusionGraph` used for the wouldBeEmpty short-circuit. */
	attachExclusionGraph(exclusionGraph: ExclusionGraph<T>): void {
		this._exclusionGraph = exclusionGraph;
	}

	// #region docs:simulation-cache-simulate
	/**
	 * Run (or cache-fetch) a simulation against the current store state.
	 *
	 * @param modification - The hypothetical state change to project
	 * @returns Projected `{ resultCount, sample, wouldBeEmpty, cacheKey }`
	 */
	simulate(modification: SimulationModification): SimulationResult<T> {
		const cacheKey = this._buildCacheKey(modification);

		// 1. Cache hit — skipped entirely when the memoization layer is disabled.
		if (this._enabled) {
			const cached = this._cache.get(cacheKey);

			if (cached) {
				return cached;
			}
		}

		// 2. Exclusion-graph short-circuit (when attached). Only a plain "add this rule" question
		//    in flat-map mode is a pairwise-exclusion question; anything that also drops rules,
		//    swaps the expression or swaps the data is answered by evaluation below.
		if (this._exclusionGraph && modification.withRule && this._isPlainWithRule(modification)) {
			const [withRuleId, withRule] = modification.withRule;

			if (this._exclusionGraph.isReady && this._exclusionGraph.wouldExcludeAll(withRuleId, withRule)) {
				const result: SimulationResult<T> = {
					cacheKey,
					resultCount: 0,
					sample: [],
					wouldBeEmpty: true,
				};

				return this._memoize(cacheKey, result);
			}
		}

		// 3. Bitmap-intersection fast path (when attached + ready); `null` means "not a
		//    conjunction over the source data", answered by the predicate path.
		if (this._bitmapIndex && this._bitmapIndex.isReady) {
			const intersected = this._bitmapIndex.simulateIntersection(modification);

			if (intersected !== null) {
				return this._memoize(cacheKey, this._buildResult(intersected, cacheKey));
			}
		}

		// 4. Predicate-evaluator fallback — always correct, always available.
		const projected = this._evaluateViaPredicate(modification);

		return this._memoize(cacheKey, this._buildResult(projected, cacheKey));
	}
	// #endregion docs:simulation-cache-simulate

	// #region docs:simulation-cache-invalidate
	/**
	 * Invalidate the cache in response to a dispatcher action. Coarse but correct — every action
	 * type can change a simulation outcome, so every action clears the whole cache (`RULE_CHANGED`
	 * included: the "what if the price ceiling were 100?" answer must reflect the slider the user
	 * just dragged).
	 */
	invalidate(action: Action): void {
		switch (action.type) {
			case 'EXPRESSION_SET':
			case 'GROUP_ADDED':
			case 'GROUP_REMOVED':
			case 'RESET':
			case 'RULE_ADDED':
			case 'RULE_CHANGED':
			case 'RULE_REMOVED':
			case 'RULES_CLEARED':
			case 'SOURCE_DATA_SET':
			case 'WORKING_SET_RESET':
			case 'WORKING_SET_SET':
				this._cache.clear();

				return;
		}
	}
	// #endregion docs:simulation-cache-invalidate

	/** Drop all cached entries. */
	clear(): void {
		this._cache.clear();
	}

	/** Number of currently-cached results. Useful for diagnostics + tests. */
	get size(): number {
		return this._cache.size;
	}

	// ─── Internal helpers ──────────────────────────────────────────────────

	/**
	 * Store a freshly-computed result in the LRU (when the memoization layer is enabled) and
	 * return it. When disabled, the store is skipped so `size` stays 0 and every `simulate()`
	 * recomputes — the single choke-point that makes `enabled: false` a true cache bypass.
	 */
	private _memoize(cacheKey: string, result: SimulationResult<T>): SimulationResult<T> {
		if (this._enabled) {
			this._cache.set(cacheKey, result);
		}

		return result;
	}

	/**
	 * True when the modification only adds or replaces one rule, in flat-map mode — the shape the
	 * exclusion graph can answer.
	 */
	private _isPlainWithRule(modification: SimulationModification): boolean {
		return this._store.expression.value === null
			&& modification.withoutRule === undefined
			&& modification.withExpression === undefined
			&& modification.withSourceData === undefined
			&& (modification.ignoreRules ?? []).length === 0;
	}

	/**
	 * Apply the modification to a hypothetical rules-map + expression, then evaluate each item
	 * in the working set against the result. Pure predicate path; always works. Flat-map mode
	 * composes the hypothetical rules with the registered filter groups, exactly as the store does.
	 */
	private _evaluateViaPredicate(modification: SimulationModification): T[] {
		// Start from current state.
		const baseRules = new Map(this._store.rules.value);
		const baseExpression = this._store.expression.value;
		const ignoredIds = new Set(modification.ignoreRules ?? []);

		// Apply withRule / withoutRule modifications.
		if (modification.withRule) {
			const [ruleId, rule] = modification.withRule;

			baseRules.set(ruleId, rule);
		}
		if (modification.withoutRule !== undefined) {
			baseRules.delete(modification.withoutRule);
		}

		// Filter out ignored rules.
		for (const ruleId of ignoredIds) {
			baseRules.delete(ruleId);
		}

		// Build effective expression.
		let effectiveExpression: FilterRule | null;

		// `withExpression: null` means "as if expression mode were cleared": the flat rules apply.
		const expression = modification.withExpression === undefined ? baseExpression : modification.withExpression;

		if (expression !== null) {
			effectiveExpression = expression;
		} else {
			effectiveExpression = composeFlatExpression(baseRules, this._store.groups.value);
		}

		// Determine the items to evaluate against.
		const items = modification.withSourceData !== undefined
			? (modification.withSourceData as readonly T[])
			: this._store.workingSet.value;

		if (effectiveExpression === null) {
			return [...items];
		}

		return items.filter((item) => evaluateExpression(effectiveExpression, item));
	}

	/**
	 * Build a `SimulationResult<T>` from a projected items array.
	 */
	private _buildResult(projected: readonly T[], cacheKey: string): SimulationResult<T> {
		return {
			cacheKey,
			resultCount: projected.length,
			sample: projected.slice(0, this._sampleSize),
			wouldBeEmpty: projected.length === 0,
		};
	}

	/**
	 * Compose a stable cache key from the modification + the engine's current state version
	 * vector. JSON-stringify is sufficient — keys are bounded in length by the rule count and
	 * the modification's payload, and the cost is dominated by the simulation itself anyway.
	 */
	private _buildCacheKey(modification: SimulationModification): string {
		const activeRulesFingerprint = this._fingerprintActiveRules();
		const modFingerprint = fingerprintModification(modification);

		return JSON.stringify({
			d: this._store.sourceDataVersion.value,
			e: this._store.expression.value === null ? null : 'expr',
			m: modFingerprint,
			r: activeRulesFingerprint,
			w: this._store.workingSetVersion.value,
		});
	}

	/**
	 * Build a deterministic fingerprint of the active rule set — sorted by id so the order
	 * doesn't affect the key, with each rule's serialize() included so config changes (e.g.,
	 * the user toggled an option) produce a new fingerprint.
	 */
	private _fingerprintActiveRules(): string {
		const entries: [RuleId, string][] = [];

		for (const [ruleId, rule] of this._store.rules.value) {
			entries.push([ruleId, fingerprintRule(rule)]);
		}
		/* v8 ignore next -- defensive: rule ids are unique Map keys, so the equal-case (0) comparator arm is unreachable */
		entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

		return entries.map(([id, fp]) => `${id}=${fp}`).join('|');
	}
}

/** Per-object identity numbers for values that have no serialized form to key on. */
const identities = new WeakMap<object, number>();
let nextIdentity = 0;

/** A stable per-object identity number, assigned on first sight. */
function identityOf(value: object): number {
	let id = identities.get(value);

	if (id === undefined) {
		nextIdentity++;
		id = nextIdentity;
		identities.set(value, id);
	}

	return id;
}

/**
 * Fingerprint a rule (or expression tree) by its serialized form, so two equal hypothetical rules
 * share a cache slot. A rule that cannot serialize (a `PredicateRule`, or a composite containing
 * one) is keyed by object identity instead — two different predicates never share a slot.
 */
function fingerprintRule(rule: FilterRule): string {
	try {
		return JSON.stringify(rule.serialize());
	} catch {
		return `#${identityOf(rule)}`;
	}
}

/**
 * Fingerprint the modification — each hypothetical rule or expression by
 * {@link fingerprintRule}, and a `withSourceData` array by identity. Module-level (stateless)
 * helper — depends only on its argument, never on cache instance state.
 */
function fingerprintModification(modification: SimulationModification): string {
	const parts: string[] = [];

	if (modification.withRule) {
		const [ruleId, rule] = modification.withRule;

		parts.push(`withRule:${ruleId}=${fingerprintRule(rule)}`);
	}
	if (modification.withoutRule !== undefined) {
		parts.push(`withoutRule:${modification.withoutRule}`);
	}
	if (modification.withSourceData !== undefined) {
		// By identity: hashing the items would cost as much as the simulation itself.
		parts.push(`withSourceData:#${identityOf(modification.withSourceData)}`);
	}
	if (modification.withExpression !== undefined) {
		parts.push(
			modification.withExpression === null
				? 'withExpression:null'
				: `withExpression:${fingerprintRule(modification.withExpression)}`,
		);
	}
	if (modification.ignoreRules && modification.ignoreRules.length > 0) {
		parts.push(`ignoreRules:${[...modification.ignoreRules].sort().join(',')}`);
	}

	return parts.join(';') || 'noop';
}
