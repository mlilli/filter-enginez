/**
 * Tests for `useResultCount` — subscribes a component to the engine's result-set size and
 * re-renders it as filtering narrows the set.
 */

import { range } from '@filter-enginez/core';
import { describe, expect, it } from 'vitest';

import { act, demoData, type DemoItem, makeRxJsEngine, renderHookWithEngine } from '../test-support/renderWithEngine.js';
import { useResultCount } from './useResultCount.js';

describe('useResultCount', () => {
	it('returns the full count when no rules are active', () => {
		const engine = makeRxJsEngine<DemoItem>({ sourceData: demoData });
		const { result } = renderHookWithEngine(() => useResultCount(), engine);

		expect(result.current).toBe(demoData.length);
	});

	it('re-renders with the reduced count when a rule filters the set', () => {
		const engine = makeRxJsEngine<DemoItem>({ sourceData: demoData });
		const { result } = renderHookWithEngine(() => useResultCount(), engine);

		act(() => {
			engine.core.addRule('price', range('price', { max: 25, min: 0 }));
		});

		expect(result.current).toBe(2);
	});
});
