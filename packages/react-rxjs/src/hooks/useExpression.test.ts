/**
 * Tests for `useExpression` — subscribes a component to the engine's explicit expression tree,
 * `null` in flat-map mode.
 */

import { and, value } from '@filter-enginez/core';
import { describe, expect, it } from 'vitest';

import { act, demoData, type DemoItem, makeRxJsEngine, renderHookWithEngine } from '../test-support/renderWithEngine.js';
import { useExpression } from './useExpression.js';

describe('useExpression', () => {
	it('returns null in flat-map mode', () => {
		const engine = makeRxJsEngine<DemoItem>({ sourceData: demoData });
		const { result } = renderHookWithEngine(() => useExpression(), engine);

		expect(result.current).toBeNull();
	});

	it('reflects the expression after setExpression and clears back to null', () => {
		const engine = makeRxJsEngine<DemoItem>({ sourceData: demoData });
		const { result } = renderHookWithEngine(() => useExpression(), engine);

		act(() => {
			engine.core.setExpression(and(value('color', 'red')));
		});
		expect(result.current).not.toBeNull();

		act(() => {
			engine.core.setExpression(null);
		});
		expect(result.current).toBeNull();
	});
});
