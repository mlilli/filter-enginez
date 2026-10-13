/**
 * `ExclusionGraph` — pre-computed mutual-exclusion graph between active rules.
 *
 * @remarks
 * Per `docs/architecture.md` §6.3. The graph maps each
 * rule to the set of OTHER rules whose source-data bitmaps share zero intersection. Once
 * computed, lets the engine short-circuit per-option simulation calls: if the consumer asks
 * "would option X yield zero results given current selection Y?" and X is known mutually
 * exclusive with Y, the answer is `true` (would be empty) without any bitmap or predicate
 * work.
 *
 * **Lazy by default** — built on first call to `getExclusions()` / `areExclusive()` /
 * `wouldExcludeAll()`, cached, invalidated by source-data change or rule add/remove (NOT by
 * selection toggles, which don't change which RULES are mutually exclusive — only which
 * specific selections are). Consumers can warm via `engine.precomputeExclusions()` during
 * idle time after data load to amortize the cost away from the first interaction.
 *
 * **The build.** For each ordered pair `(X, Y)` in the current active rule set, check
 * `bitmapIndex.getBitmap(X).andCardinality(bitmapIndex.getBitmap(Y)) === 0`. Build cost is
 * O(pairs × bitmap-AND-cost) — dominated by the bitmap-build cost on first access (which
 * `BitmapIndex` amortizes via its per-rule cache).
 *
 * **The check.** `wouldExcludeAll(candidateId, candidateRule)` checks whether the candidate
 * rule's bitmap has zero intersection with ANY other active rule's bitmap. If so, adding the
 * candidate would yield zero results regardless of the remaining rules — safe to short-circuit.
 * The answer is only claimed for a conjunction: while an `'or'` group spans two or more of the
 * rules involved, a disjoint pair proves nothing, so the check answers `false` ("not known").
 *
 * @packageDocumentation
 */

import type { FilterRule } from '../rules/FilterRule.js';
import type { InternalStore } from '../store/InternalStore.js';
import type { RuleId } from '../types.js';
import type { BitmapIndex } from './BitmapIndex.js';

import { isConjunctive } from '../composition/composeFlatExpression.js';

/**
 * Build strategy for the mutual-exclusion graph.
 *
 * - `'lazy'` (default) — the graph builds on the first query (`wouldExcludeAll` /
 *   `areExclusive` / `getExclusions`) and re-builds on the next query after an invalidation.
 *   The build cost lands on whichever interaction triggers the first query.
 * - `'eager'` — query-identical to `'lazy'`, but the engine keeps the graph warm by calling
 *   `precompute()` after construction/config-load and re-precomputing after each rule/data
 *   invalidation, so the build cost is paid off the interaction hot path.
 * - `'off'` — the graph is disabled entirely: every query returns its "nothing excluded"
 *   answer and no graph is ever built. Used to isolate the exclusion layer in the benchmark
 *   matrix and to opt out when the short-circuit isn't wanted.
 */
export type ExclusionGraphMode = 'eager' | 'lazy' | 'off';

/**
 * Pairwise mutual-exclusion graph between active rules.
 */
export class ExclusionGraph<T> {
	/**
	 * Adjacency map: `ruleId → set of rule IDs disjoint from it`. Symmetric (if A is in B's
	 * set, B is in A's set). Populated by `ensureBuilt`; cleared by `invalidate`.
	 */
	private readonly _adjacency = new Map<RuleId, Set<RuleId>>();

	/** Source-data version the cached graph was built against. -1 = not yet built. */
	private _cachedSourceVersion = -1;

	/**
	 * Fingerprint of the rule set (sorted IDs joined) the cached graph was built against.
	 * When the rule set changes (add/remove/changed), the fingerprint changes and triggers a
	 * rebuild on the next query.
	 */
	private _cachedRulesFingerprint = '';

	constructor(
		private readonly _store: InternalStore<T>,
		private readonly _bitmapIndex: BitmapIndex<T>,
		private readonly _mode: ExclusionGraphMode = 'lazy',
	) {}

	/**
	 * Whether the exclusion graph has been built and is ready to answer queries. Returns
	 * `true` only when the cached graph is fresh against the current store state. Useful for
	 * diagnostics; callers don't need to gate on this — `wouldExcludeAll` builds lazily.
	 *
	 * @remarks
	 * Always `false` in `'off'` mode — a disabled graph never becomes "ready," which keeps the
	 * `SimulationCache` short-circuit (gated on `exclusionGraph.isReady`) inert.
	 */
	get isReady(): boolean {
		if (this._mode === 'off') {
			return false;
		}

		return this._bitmapIndex.isReady && this._isCacheFresh();
	}

	/**
	 * Check whether adding `rule` (under `ruleId`) to the current active rule set would
	 * inevitably yield zero results.
	 *
	 * @remarks
	 * **Where the payoff is.** In the `simulate` path this short-circuit is roughly cost-neutral
	 * (`benchmarks/RESULTS.md`): for a not-yet-active candidate it builds the candidate bitmap (the
	 * O(N) cost), and the bitmap path it replaces also stops on an empty intersection. And
	 * `SimulationCache` gates this call on `isReady`, so a pure `lazy` workload never self-builds
	 * here. The graph's real payoff is the O(1) direct queries — {@link areExclusive} /
	 * {@link getExclusions} on active rules — for "which filters are incompatible" UI.
	 *
	 * A candidate that IS the registered rule under `candidateRuleId` is answered from the cached
	 * adjacency. Any other candidate — new, or a replacement for the rule registered under that id
	 * — gets a bitmap built through `BitmapIndex.buildEphemeralBitmap` (so geo and text candidates
	 * use the R-tree and the inverted index) and is checked against every OTHER active rule.
	 *
	 * @param candidateRuleId - The rule id to check (used for cache-hit detection if the
	 *   candidate is already in the active set)
	 * @param candidateRule - The rule itself (so a hypothetical rule not yet registered can
	 *   still be checked)
	 * @returns `true` if the candidate is mutually exclusive with any active rule; `false`
	 *   otherwise (which includes "I don't know" — the caller should still verify via the
	 *   full bitmap/predicate path)
	 */
	wouldExcludeAll(candidateRuleId: RuleId, candidateRule: FilterRule): boolean {
		// Disabled — never claim exclusion, so the caller runs the full evaluation path.
		if (this._mode === 'off') {
			return false;
		}
		// Defer to the bitmap path; if it's not ready, we can't meaningfully answer.
		if (!this._bitmapIndex.isReady) {
			return false;
		}

		const rules = this._store.rules.value;
		const otherRuleIds = [...rules.keys()].filter((id) => id !== candidateRuleId);

		if (otherRuleIds.length === 0 || !isConjunctive([...otherRuleIds, candidateRuleId], this._store.groups.value)) {
			return false;
		}

		this._ensureBuilt();

		// Case 1: candidate is the registered rule under its id → consult the cached adjacency.
		if (rules.get(candidateRuleId) === candidateRule) {
			return otherRuleIds.some((activeId) => this.areExclusive(candidateRuleId, activeId));
		}

		// Case 2: a hypothetical candidate (new, or replacing the rule under its id). Build its
		// bitmap on the fly and check pairwise empty-intersection against each other active rule.
		const candidateBitmap = this._bitmapIndex.buildEphemeralBitmap(candidateRule);

		for (const activeId of otherRuleIds) {
			if (candidateBitmap.andCardinality(this._bitmapIndex.getBitmap(activeId)) === 0) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Get the rule IDs mutually exclusive with `ruleId`. Builds the graph lazily on first call.
	 *
	 * @returns A read-only array of rule IDs that share zero source-data overlap with `ruleId`
	 */
	getExclusions(ruleId: RuleId): readonly RuleId[] {
		if (this._mode === 'off') {
			return [];
		}
		if (!this._bitmapIndex.isReady) {
			return [];
		}
		this._ensureBuilt();
		const set = this._adjacency.get(ruleId);

		// Explicit if/return (not `set ? [...set] : []`) so v8 credits both arms — its inline
		// ternary branch instrumentation under-reports here.
		if (set === undefined) {
			return [];
		}

		return [...set];
	}

	/** O(1) exclusion check between two rules. */
	areExclusive(ruleA: RuleId, ruleB: RuleId): boolean {
		if (this._mode === 'off') {
			return false;
		}
		if (!this._bitmapIndex.isReady) {
			return false;
		}
		this._ensureBuilt();

		// Explicit if/return (not `...?.has(ruleB) ?? false`) so v8 credits both arms — its inline
		// optional-chain + nullish branch instrumentation under-reports here.
		const adjacent = this._adjacency.get(ruleA);

		if (adjacent === undefined) {
			return false;
		}

		return adjacent.has(ruleB);
	}

	/**
	 * Force-build the graph eagerly — typically called through `engine.precomputeExclusions()`
	 * during idle time after data load, to amortize the cost away from the first user
	 * interaction. Does nothing if the graph is already fresh, the mode is `'off'`, or bitmaps
	 * are not engaged.
	 */
	precompute(): void {
		if (this._mode === 'off') {
			return;
		}
		if (!this._bitmapIndex.isReady) {
			return;
		}
		this._ensureBuilt();
	}

	/** Clear the cached graph (on source-data or rule-set change). */
	invalidate(): void {
		this._adjacency.clear();
		this._cachedSourceVersion = -1;
		this._cachedRulesFingerprint = '';
	}

	/** Diagnostic: number of rule pairs currently known to be mutually exclusive. */
	get exclusionPairCount(): number {
		let count = 0;

		for (const disjoint of this._adjacency.values()) {
			count += disjoint.size;
		}

		return count / 2; // adjacency is symmetric — each pair counted twice
	}

	// ─── Internal ──────────────────────────────────────────────────────────

	/**
	 * Is the cached graph still aligned with the current store state?
	 */
	private _isCacheFresh(): boolean {
		if (this._cachedSourceVersion !== this._store.sourceDataVersion.value) {
			return false;
		}
		if (this._cachedRulesFingerprint !== this._fingerprintActiveRules()) {
			return false;
		}

		return true;
	}

	/**
	 * Sorted-id joined fingerprint of the active rule set. Cheap to compute, used as a cache
	 * invalidation key.
	 */
	private _fingerprintActiveRules(): string {
		const ids = [...this._store.rules.value.keys()];

		ids.sort();

		return ids.join('|');
	}

	// #region docs:exclusion-graph-build
	/**
	 * Build (or rebuild) the adjacency graph if it's stale. O(rule-pairs × bitmap-AND).
	 */
	private _ensureBuilt(): void {
		if (this._isCacheFresh()) {
			return;
		}

		this._adjacency.clear();
		const ruleIds = [...this._store.rules.value.keys()];

		for (let i = 0; i < ruleIds.length; i++) {
			const idA = ruleIds[i];

			/* v8 ignore next 3 -- defensive: noUncheckedIndexedAccess guard; ruleIds is a dense key array */
			if (idA === undefined) {
				continue;
			}
			const bitmapA = this._bitmapIndex.getBitmap(idA);
			let disjointA = this._adjacency.get(idA);

			if (disjointA === undefined) {
				disjointA = new Set();
				this._adjacency.set(idA, disjointA);
			}

			for (let j = i + 1; j < ruleIds.length; j++) {
				const idB = ruleIds[j];

				/* v8 ignore next 3 -- defensive: noUncheckedIndexedAccess guard; ruleIds is a dense key array */
				if (idB === undefined) {
					continue;
				}
				const bitmapB = this._bitmapIndex.getBitmap(idB);

				if (bitmapA.andCardinality(bitmapB) === 0) {
					// Mutually exclusive — record symmetrically.
					disjointA.add(idB);
					let disjointB = this._adjacency.get(idB);

					if (disjointB === undefined) {
						disjointB = new Set();
						this._adjacency.set(idB, disjointB);
					}
					disjointB.add(idA);
				}
			}
		}

		this._cachedSourceVersion = this._store.sourceDataVersion.value;
		this._cachedRulesFingerprint = this._fingerprintActiveRules();
	}
	// #endregion docs:exclusion-graph-build
}
