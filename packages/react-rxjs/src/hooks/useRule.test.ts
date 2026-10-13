/**
 * Tests for `useRule` — subscribes a component to a single rule by id, tracking its add and
 * removal.
 */

import { value } from '@filter-enginez/core';
import { describe, expect, it } from 'vitest';

import { act, demoData, type DemoItem, makeRxJsEngine, renderHookWithEngine } from '../test-support/renderWithEngine.js';
import { useRule } from './useRule.js';

describe('useRule', () => {
	it('returns undefined for an unregistered rule id', () => {
		const engine = makeRxJsEngine<DemoItem>({ sourceData: demoData });
		const { result } = renderHookWithEngine(() => useRule('color'), engine);

		expect(result.current).toBeUndefined();
	});

	it('returns the rule once added and undefined again after removal', () => {
		const engine = makeRxJsEngine<DemoItem>({ sourceData: demoData });
		const { result } = renderHookWithEngine(() => useRule('color'), engine);

		act(() => {
			engine.core.addRule('color', value('color', 'red'));
		});
		expect(result.current).toBeDefined();

		act(() => {
			engine.core.removeRule('color');
		});
		expect(result.current).toBeUndefined();
	});
});
