/**
 * Tests for `useMode` — subscribes a component to the engine's evaluation mode, flipping between
 * `'flat-map'` and `'expression'`.
 */

import { and, value } from '@filter-enginez/core';
import { describe, expect, it } from 'vitest';

import { act, demoData, type DemoItem, makeRxJsEngine, renderHookWithEngine } from '../test-support/renderWithEngine.js';
import { useMode } from './useMode.js';

describe('useMode', () => {
	it('starts in flat-map mode', () => {
		const engine = makeRxJsEngine<DemoItem>({ sourceData: demoData });
		const { result } = renderHookWithEngine(() => useMode(), engine);

		expect(result.current).toBe('flat-map');
	});

	it('switches to expression mode and back as the expression is set and cleared', () => {
		const engine = makeRxJsEngine<DemoItem>({ sourceData: demoData });
		const { result } = renderHookWithEngine(() => useMode(), engine);

		act(() => {
			engine.core.setExpression(and(value('color', 'red')));
		});
		expect(result.current).toBe('expression');

		act(() => {
			engine.core.setExpression(null);
		});
		expect(result.current).toBe('flat-map');
	});
});
