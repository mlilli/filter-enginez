/**
 * Rehydration of rules and expressions that arrive from a worker in wire form — shared by both
 * async reactive adapters.
 *
 * @remarks
 * ## What crosses the boundary, and why it needs rebuilding
 *
 * Worker-side `getRules` / `getExpression` return SERIALIZED shapes. A `FilterRule` holds function
 * fields (`action`) and library internals (Fuse indices, `RegExp`s) that are not
 * `structuredClone`-safe, so instances cannot cross `postMessage`. What arrives is a plain object
 * with the right `.config` and **no prototype**. Property reads work, which is exactly why the gap
 * hides: it only surfaces when a consumer calls a METHOD.
 *
 * ## Why this is shared
 *
 * `reactive-signals` and `reactive-rxjs` both need it, and per-adapter copies can diverge silently.
 * A missing expression rehydration on one adapter, for example, leaves wire objects without
 * methods, so code that keys presets by `rule.serialize()` (as a "which preset is selected" check
 * does) fails inside a `catch` on that adapter only — and reads as a framework bug. One shared
 * implementation keeps both adapters identical.
 *
 * ## The two behaviors, and why they differ from each other
 *
 * On failure: `warn`, and fall back to the RAW expression, identically in every app.
 *
 * **The expression falls back to RAW rather than `null`** because `null` is the flat-map sentinel.
 * Reporting it would tell every consumer that no expression is active while the engine is filtering
 * by one — a lie the consumer cannot detect. A partly-live object at least reads correctly.
 *
 * **Rules are SKIPPED rather than falling back to raw**, and that asymmetry is deliberate: a rule
 * map is a collection, so dropping one member degrades gracefully, while an expression is the whole
 * filter state and dropping it changes the reported mode.
 *
 * ## The warning fires ONCE per rule id, and that is the whole reason it can be a warning
 *
 * `PredicateRule` is unserializable **by design**, so a config using one would emit a warning on
 * every settle — hundreds over a session, for a documented and expected condition. That is how a
 * log level stops meaning anything. Deduplicating by rule id keeps `warn` honest: the first
 * occurrence is information, and the ninety-ninth is noise that would train the reader to filter
 * `warn` out entirely.
 *
 * The repo's logging standard puts "something unexpected happened but was handled" at `warn`, and a
 * rule the registry cannot rebuild IS that — a wire name that no longer matches a registry key (as a
 * minified `constructor.name` would; see `getRuleTypeName`) surfaces here as a skipped rule rather
 * than failing silently.
 *
 * @packageDocumentation
 */

import {
	type CompositeRule,
	type FilterRule,
	type RuleId,
	ruleRegistry,
	type SerializedRule,
} from '@filter-enginez/core';

/** The two transforms an async adapter needs to turn wire payloads back into live instances. */
export interface WireRehydrator {
	/**
	 * Rebuild a live `CompositeRule` from the worker's serialized expression.
	 *
	 * @remarks
	 * Already-live instances pass through untouched, so this is safe on any path that hands over a
	 * real `CompositeRule` rather than a wire object. `ruleRegistry.deserialize` rebuilds a
	 * composite's children recursively, so the whole tree comes back live.
	 */
	readonly expression: (raw: CompositeRule | null) => CompositeRule | null;
	/** Rebuild live `FilterRule` instances from the worker's serialized map, skipping any that fail. */
	readonly rules: (raw: ReadonlyMap<RuleId, FilterRule>) => ReadonlyMap<RuleId, FilterRule>;
}

/**
 * Build the rehydration pair for one adapter instance.
 *
 * @remarks
 * **A factory rather than two free functions, because the warning dedupe needs state** — one
 * `Set` of already-reported rule ids, scoped to the adapter instance rather than to the module. A
 * module-level set would silence the warning for every later engine in the same process, including
 * the second one in a test file, which is the failure mode where a guard quietly stops guarding.
 *
 * `adapterName` reaches the message for the same reason `createAsyncDevtoolsShim` takes one: a
 * consumer reading a console warning needs to know which of the two adapters produced it, and a
 * hardcoded name passes every test that only matches on the rest of the string.
 *
 * @param adapterName - The adapter to name in warnings, e.g. `'createSignalsEngineFromAsync'`.
 * @returns The `rules` and `expression` transforms.
 */
export function createWireRehydrator(adapterName: string): WireRehydrator {
	const reportedRuleIds = new Set<RuleId>();

	return {
		expression: (raw: CompositeRule | null): CompositeRule | null => {
			// A live instance is already what the caller wants. Skipping the registry here is not just
			// an optimization: `deserialize` would throw on it and land in the fallback below, which
			// returns the same value by a noisier route.
			if (raw === null || typeof raw.serialize === 'function') {
				return raw;
			}

			try {
				return ruleRegistry.deserialize(raw as unknown as SerializedRule) as CompositeRule;
			} catch (error) {
				console.warn(`${adapterName}: expression could not be rehydrated; using the raw wire value.`, error);

				return raw;
			}
		},

		rules: (raw: ReadonlyMap<RuleId, FilterRule>): ReadonlyMap<RuleId, FilterRule> => {
			const out = new Map<RuleId, FilterRule>();

			for (const [id, rule] of raw) {
				try {
					out.set(id, ruleRegistry.deserialize(rule as unknown as SerializedRule));
				} catch (error) {
					if (!reportedRuleIds.has(id)) {
						reportedRuleIds.add(id);
						console.warn(
							`${adapterName}: rule '${id}' could not be rehydrated and is omitted from the mirror. `
								+ `Expected for PredicateRule, which is unserializable by design. This is reported once per rule id.`,
							error,
						);
					}
				}
			}

			return out;
		},
	};
}
