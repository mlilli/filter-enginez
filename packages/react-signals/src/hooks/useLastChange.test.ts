/**
 * Tests for `useLastChange` — subscribes a component to the engine's last-mutation tracking and
 * returns a memo-stable snapshot.
 */

import { value } from '@filter-enginez/core';
import { describe, expect, it } from 'vitest';

import { act, demoData, type DemoItem, makeSignalsEngine, renderHookWithEngine } from '../test-support/renderWithEngine.js';
import { useLastChange } from './useLastChange.js';

describe('useLastChange', () => {
	it('starts with null fields before any mutation', () => {
		const engine = makeSignalsEngine<DemoItem>({ sourceData: demoData });
		const { result } = renderHookWithEngine(() => useLastChange(), engine);

		expect(result.current).toEqual({ event: null, ruleId: null, timestamp: null });
	});

	it('populates ruleId, timestamp and event after a rule mutation', () => {
		const engine = makeSignalsEngine<DemoItem>({ sourceData: demoData });
		const { result } = renderHookWithEngine(() => useLastChange(), engine);

		act(() => {
			engine.core.addRule('color', value('color', 'red'));
		});

		expect(result.current.ruleId).toBe('color');
		expect(typeof result.current.timestamp).toBe('number');
		expect(result.current.event).not.toBeNull();
	});

	it('returns a memo-stable object across re-renders when nothing changed', () => {
		const engine = makeSignalsEngine<DemoItem>({ sourceData: demoData });
		const { rerender, result } = renderHookWithEngine(() => useLastChange(), engine);
		const first = result.current;

		rerender();

		expect(result.current).toBe(first);
	});
});
