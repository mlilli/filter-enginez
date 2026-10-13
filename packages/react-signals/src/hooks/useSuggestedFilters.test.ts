/**
 * Tests for `useSuggestedFilters` — the Bayesian co-occurrence surface: empty without session
 * history, and ranks co-occurring filters given the current selection.
 */

import { value } from '@filter-enginez/core';
import { attachSuggestions } from '@filter-enginez/core/suggestions';
import { describe, expect, it } from 'vitest';

import { demoData, type DemoItem, makeSignalsEngine, renderHookWithEngine } from '../test-support/renderWithEngine.js';
import { useSuggestedFilters } from './useSuggestedFilters.js';

describe('useSuggestedFilters', () => {
	it('returns an empty list when the session tracker has no history', () => {
		const engine = makeSignalsEngine<DemoItem>({ sourceData: demoData });
		const { result } = renderHookWithEngine(() => useSuggestedFilters(), engine);

		expect(result.current).toEqual([]);
	});

	it('suggests a co-occurring filter given the current selection', () => {
		const engine = makeSignalsEngine<DemoItem>({ sourceData: demoData });

		// Two past sessions where 'color' and 'price' were active together. Recording through the
		// SAME attach the hook reads through is the point — `attachSuggestions` memoizes per engine,
		// so this feeds the tracker the hook will query rather than a second, disconnected one.
		attachSuggestions(engine.core).sessionTracker.recordSession(['color', 'price']);
		attachSuggestions(engine.core).sessionTracker.recordSession(['color', 'price']);
		// Activate 'color' so it forms the current selection the suggestions key off.
		engine.core.addRule('color', value('color', 'red'));

		const { result } = renderHookWithEngine(() => useSuggestedFilters(3), engine);

		expect(result.current.some((suggestion) => suggestion.ruleId === 'price')).toBe(true);
	});

	it('reads the trio the caller recorded into, across separate attach calls', () => {
		// The regression this guards: if the hook attached fresh instead of reusing the memoized
		// bag, the assertion above would still pass on a *single* recording path but the reader
		// would train on an empty corpus. Two engines make the isolation visible.
		const engine = makeSignalsEngine<DemoItem>({ sourceData: demoData });
		const other = makeSignalsEngine<DemoItem>({ sourceData: demoData });

		attachSuggestions(engine.core).sessionTracker.recordSession(['color', 'price']);

		expect(attachSuggestions(engine.core).sessionTracker.size).toBe(1);
		expect(attachSuggestions(other.core).sessionTracker.size).toBe(0);

		const { result } = renderHookWithEngine(() => useSuggestedFilters(3), other);

		expect(result.current).toEqual([]);
	});
});
