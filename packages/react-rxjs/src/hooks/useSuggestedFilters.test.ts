/**
 * Tests for `useSuggestedFilters` — the Bayesian co-occurrence surface: empty without session
 * history, and ranks co-occurring filters given the current selection.
 */

import { value } from '@filter-enginez/core';
import { attachSuggestions } from '@filter-enginez/core/suggestions';
import { describe, expect, it } from 'vitest';

import { demoData, type DemoItem, makeRxJsEngine, renderHookWithEngine } from '../test-support/renderWithEngine.js';
import { useSuggestedFilters } from './useSuggestedFilters.js';

describe('useSuggestedFilters', () => {
	it('returns an empty list when the session tracker has no history', () => {
		const engine = makeRxJsEngine<DemoItem>({ sourceData: demoData });
		const { result } = renderHookWithEngine(() => useSuggestedFilters(), engine);

		expect(result.current).toEqual([]);
	});

	it('suggests a co-occurring filter given the current selection', () => {
		const engine = makeRxJsEngine<DemoItem>({ sourceData: demoData });

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
		// Mirrors the react-signals twin. Guards the case where the hook attaches fresh instead of
		// reusing the memoized bag: the reader would train on an empty corpus while the single-path
		// assertion above still passed.
		const engine = makeRxJsEngine<DemoItem>({ sourceData: demoData });
		const other = makeRxJsEngine<DemoItem>({ sourceData: demoData });

		attachSuggestions(engine.core).sessionTracker.recordSession(['color', 'price']);

		expect(attachSuggestions(engine.core).sessionTracker.size).toBe(1);
		expect(attachSuggestions(other.core).sessionTracker.size).toBe(0);

		const { result } = renderHookWithEngine(() => useSuggestedFilters(3), other);

		expect(result.current).toEqual([]);
	});
});
