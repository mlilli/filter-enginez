/**
 * @remarks
 * Pass-3 coverage for the suggestions barrel — asserts the public re-exports are live bindings
 * (constructable / callable), guarding against an accidentally-dropped or renamed export in
 * {@link ../suggestions/index.ts}. The barrel itself is declarative; this suite only verifies the
 * runtime surface it exposes. Mirrors `similarity/index.test.ts`, which is the file this one was
 * missing a counterpart to.
 *
 * @packageDocumentation
 */

import { describe, expect, it } from 'vitest';

import { attachSuggestions, BayesianModel, SessionTracker, SuggestionEngine } from './index.js';

describe('suggestions barrel exports', () => {
	it('re-exports SessionTracker as a constructable class', () => {
		expect(typeof SessionTracker).toBe('function');
		expect(new SessionTracker(12).maxSessions).toBe(12);
	});

	it('re-exports BayesianModel as a constructable class', () => {
		expect(typeof BayesianModel).toBe('function');
		expect(new BayesianModel().trainedSessionCount).toBe(0);
	});

	it('re-exports SuggestionEngine as a constructable class', () => {
		expect(typeof SuggestionEngine).toBe('function');
		expect(new SuggestionEngine(new SessionTracker(), new BayesianModel()).getSuggestions([])).toEqual([]);
	});

	it('re-exports attachSuggestions as a callable', () => {
		expect(typeof attachSuggestions).toBe('function');
		expect(attachSuggestions({}).suggestions).toBeInstanceOf(SuggestionEngine);
	});
});
