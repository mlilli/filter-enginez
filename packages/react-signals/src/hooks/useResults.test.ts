/**
 * Tests for `useResults` — subscribes a component to the engine's filtered result set and
 * re-renders it as the active rule set changes.
 */

import { range } from '@filter-enginez/core';
import { describe, expect, it } from 'vitest';

import { act, demoData, type DemoItem, makeSignalsEngine, renderHookWithEngine } from '../test-support/renderWithEngine.js';
import { useResults } from './useResults.js';

describe('useResults', () => {
	it('returns all source items when no rules are active', () => {
		const engine = makeSignalsEngine<DemoItem>({ sourceData: demoData });
		const { result } = renderHookWithEngine(() => useResults<DemoItem>(), engine);

		expect(result.current).toEqual(demoData);
	});

	it('re-renders with the filtered set when a rule is added', () => {
		const engine = makeSignalsEngine<DemoItem>({ sourceData: demoData });
		const { result } = renderHookWithEngine(() => useResults<DemoItem>(), engine);

		act(() => {
			engine.core.addRule('price', range('price', { max: 100, min: 15 }));
		});

		expect(result.current).toEqual([
			{ color: 'blue', id: 'b', price: 20 },
			{ color: 'red', id: 'c', price: 30 },
		]);
	});
});
