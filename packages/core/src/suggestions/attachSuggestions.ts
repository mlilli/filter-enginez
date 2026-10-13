/**
 * `attachSuggestions` — get the Bayesian suggestion trio bound to an engine.
 *
 * @remarks
 * This function exists so that `suggestions/` stays out of the engine's static import graph, the
 * same arrangement as `attachSimilarity`.
 *
 * ## Why the engine does not own a `suggestions` property
 *
 * If `FilterEngine`'s constructor built a `SessionTracker`, a `BayesianModel` and a
 * `SuggestionEngine` unconditionally, every consumer of `createFilterEngine` would ship all three
 * whether or not they ever asked "what filter should I offer next?" — measured with `size-limit`,
 * **657 B gzipped**. A static `import` whose value is constructed unconditionally cannot be
 * dropped by any bundler, so the construction belongs to the caller.
 *
 * ```ts
 * // the import is the opt-in, and it is the ONLY way to pay
 * import { attachSuggestions } from '@filter-enginez/core/suggestions';
 * const { sessionTracker, suggestions } = attachSuggestions(engine);
 * sessionTracker.recordSession(activeRuleIds);
 * suggestions.getSuggestions(activeRuleIds, 3);
 * ```
 *
 * ## Two ways this deliberately diverges from `attachSimilarity`
 *
 * **1. It memoizes, and that is a correctness property rather than a courtesy.** `attachSimilarity`
 * constructs fresh on every call and says so — two MinHash indexes over one corpus are wasteful,
 * not wrong. Here they would be wrong: a caller that *records* sessions and a caller that *reads*
 * suggestions must share one {@link SessionTracker}, or the reader trains on an empty corpus and
 * silently returns `[]` forever. Handing back a per-engine memoized trio makes that failure
 * impossible to express, rather than merely documenting it as a hazard.
 *
 * Holding the `WeakMap` here rather than in each binding keeps the invariant in one place, instead
 * of one hand-synced copy per framework binding.
 *
 * **2. The engine is a key, not a data source.** {@link attachSimilarity} reads `store.sourceData`
 * because MinHash needs the corpus. The suggestion trio needs *nothing* from the engine — it
 * computes over session history the consumer records by hand — so the parameter here exists purely
 * to identify which engine's trio you want.
 *
 * ## Consequence worth knowing: this works on worker-backed engines
 *
 * The *worker's* engine is unreachable across `postMessage`, but the main thread does not need it:
 * it needs *a* trio, and `attachSuggestions` gives it one outright. The computation is pure
 * main-thread work over session history the main thread records itself, and `activeRuleIds` is
 * already mirrored into the async core shim.
 *
 * There is no divergence risk, because the worker-side engine has no trio at all. So
 * `attachSuggestions` on a worker-backed engine is correct, not a loophole.
 *
 * @packageDocumentation
 */

import { BayesianModel } from './BayesianModel.js';
import { SessionTracker } from './SessionTracker.js';
import { SuggestionEngine } from './SuggestionEngine.js';

/**
 * The coherent trio, handed back as one bag.
 *
 * @remarks
 * One bag rather than three attach functions, because the three are not independent: the
 * `SuggestionEngine` reads through the very `SessionTracker` and `BayesianModel` alongside it.
 * Three separate attaches would let a caller pair a reader with a tracker nothing writes to, which
 * fails silently — an empty result set is indistinguishable from "no good suggestion".
 */
export interface AttachedSuggestions {
	/** The co-occurrence model the orchestrator trains and queries. Exposed for inspection. */
	readonly bayesianModel: BayesianModel;
	/** The session history the model trains on. Call `recordSession` to feed it. */
	readonly sessionTracker: SessionTracker;
	/** The consumer-facing `getSuggestions(activeRuleIds, k)` orchestrator. */
	readonly suggestions: SuggestionEngine;
}

/**
 * Engines to their attached trio.
 *
 * @remarks
 * `WeakMap` rather than `Map` so a destroyed engine takes its session history with it; the trio
 * holds a bounded ring buffer (500 sessions by default) and a trained model, neither of which
 * should outlive the engine that keyed them.
 *
 * @internal
 */
const ATTACHED = new WeakMap<object, AttachedSuggestions>();

/**
 * Get the suggestion trio for an engine, constructing it on first ask.
 *
 * @remarks
 * Idempotent per engine: every call with the same engine returns the identical bag, so a component
 * that records sessions and a component that reads suggestions converge on one
 * {@link SessionTracker} without having to pass it between them.
 *
 * @param engine - The engine to attach to. Used only as an identity key — no property is read, so
 *   any stable object works, including the async core shim on a worker-backed engine and a test
 *   double that implements nothing at all.
 * @returns The memoized trio for this engine. See {@link AttachedSuggestions}.
 *
 * @example
 * ```ts
 * import { attachSuggestions } from '@filter-enginez/core/suggestions';
 *
 * const { sessionTracker, suggestions } = attachSuggestions(engine);
 *
 * // Feed it — typically debounced on a stable selection window.
 * sessionTracker.recordSession(engine.activeRuleIds);
 *
 * // Read it.
 * const nextBest = suggestions.getSuggestions(engine.activeRuleIds, 3);
 * ```
 */
export function attachSuggestions(engine: object): AttachedSuggestions {
	const existing = ATTACHED.get(engine);

	if (existing !== undefined) {
		return existing;
	}

	const sessionTracker = new SessionTracker();
	const bayesianModel = new BayesianModel();
	const created: AttachedSuggestions = {
		bayesianModel,
		sessionTracker,
		suggestions: new SuggestionEngine(sessionTracker, bayesianModel),
	};

	ATTACHED.set(engine, created);

	return created;
}
