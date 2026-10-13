/**
 * Tests for {@link attachSuggestions}.
 *
 * @remarks
 * The memoization cases carry the weight here. For `attachSimilarity` a second attach is merely
 * wasteful; for this trio it is a correctness bug — a recorder and a reader holding different
 * `SessionTracker`s produce an empty suggestion list that is indistinguishable from "no good
 * suggestion". So "same engine returns the identical bag" and "the trio is internally wired to
 * itself" are both asserted directly rather than inferred from behavior.
 */

import { describe, expect, it } from 'vitest';

import { attachSuggestions } from './attachSuggestions.js';
import { BayesianModel } from './BayesianModel.js';
import { SessionTracker } from './SessionTracker.js';
import { SuggestionEngine } from './SuggestionEngine.js';

describe('attachSuggestions', () => {
	it('returns the trio, each of the expected class', () => {
		const attached = attachSuggestions({});

		expect(attached.sessionTracker).toBeInstanceOf(SessionTracker);
		expect(attached.bayesianModel).toBeInstanceOf(BayesianModel);
		expect(attached.suggestions).toBeInstanceOf(SuggestionEngine);
	});

	it('returns the identical bag for the same engine', () => {
		const engine = {};
		const first = attachSuggestions(engine);
		const second = attachSuggestions(engine);

		expect(second).toBe(first);
		expect(second.sessionTracker).toBe(first.sessionTracker);
		expect(second.bayesianModel).toBe(first.bayesianModel);
		expect(second.suggestions).toBe(first.suggestions);
	});

	it('returns independent bags for different engines', () => {
		const first = attachSuggestions({});
		const second = attachSuggestions({});

		expect(second).not.toBe(first);
		expect(second.sessionTracker).not.toBe(first.sessionTracker);
	});

	it('keeps two engines session histories separate', () => {
		const engineA = {};
		const engineB = {};

		attachSuggestions(engineA).sessionTracker.recordSession(['color', 'price']);

		expect(attachSuggestions(engineA).sessionTracker.size).toBe(1);
		expect(attachSuggestions(engineB).sessionTracker.size).toBe(0);
	});

	it('wires the orchestrator to the very tracker it hands back', () => {
		// The invariant the memoization exists to protect: a caller that records through
		// `sessionTracker` must be feeding the same corpus the caller reading `suggestions` queries.
		// Recording via the bag and reading via the bag has to close the loop with no third party.
		const { sessionTracker, suggestions } = attachSuggestions({});

		expect(suggestions.getSuggestions(['color'])).toEqual([]);

		for (let index = 0; index < 5; index += 1) {
			sessionTracker.recordSession(['color', 'price']);
		}

		const results = suggestions.getSuggestions(['color']);

		expect(results.length).toBeGreaterThan(0);
		expect(results[0]?.ruleId).toBe('price');
	});

	it('reflects a later record through an earlier reference to the bag', () => {
		// Guards the memoization from a plausible regression: returning a fresh bag whose fields
		// happen to be shared would pass the identity tests above but break here.
		const engine = {};
		const earlier = attachSuggestions(engine);

		for (let index = 0; index < 3; index += 1) {
			attachSuggestions(engine).sessionTracker.recordSession(['genre', 'rating']);
		}

		expect(earlier.sessionTracker.size).toBe(3);
		expect(earlier.suggestions.getSuggestions(['genre'])[0]?.ruleId).toBe('rating');
	});

	it('accepts any stable object as the key, including a bare test double', () => {
		// The parameter is an identity key, not a data source — no property is ever read. This is
		// what lets the async core shim on a worker-backed engine attach successfully, even though
		// its `store` getter throws.
		const shimLike = {
			get store(): never {
				throw new Error('store is not available on worker-backed engines');
			},
		};

		expect(() => attachSuggestions(shimLike)).not.toThrow();
		expect(attachSuggestions(shimLike)).toBe(attachSuggestions(shimLike));
	});
});
