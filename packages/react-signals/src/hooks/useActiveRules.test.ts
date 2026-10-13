/**
 * Tests for `useActiveRules` — subscribes a component to the engine's full rule map and
 * re-renders it as rules are added or removed.
 */

import { value } from '@filter-enginez/core';
import { describe, expect, it } from 'vitest';

import { act, demoData, type DemoItem, makeSignalsEngine, renderHookWithEngine } from '../test-support/renderWithEngine.js';
import { useActiveRules } from './useActiveRules.js';

describe('useActiveRules', () => {
	it('returns an empty map when no rules are registered', () => {
		const engine = makeSignalsEngine<DemoItem>({ sourceData: demoData });
		const { result } = renderHookWithEngine(() => useActiveRules(), engine);

		expect(result.current.size).toBe(0);
	});

	it('re-renders with the rule map when a rule is added', () => {
		const engine = makeSignalsEngine<DemoItem>({ sourceData: demoData });
		const { result } = renderHookWithEngine(() => useActiveRules(), engine);

		act(() => {
			engine.core.addRule('color', value('color', 'red'));
		});

		expect(result.current.size).toBe(1);
		expect(result.current.has('color')).toBe(true);
	});
});
