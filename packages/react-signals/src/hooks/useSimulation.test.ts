/**
 * Tests for `useSimulation` — projects a hypothetical modification's result via the engine's
 * memoized `simulate`, re-evaluating as the active rule set changes.
 */

import { inSet, range } from '@filter-enginez/core';
import { describe, expect, it } from 'vitest';

import { act, demoData, type DemoItem, makeSignalsEngine, renderHookWithEngine } from '../test-support/renderWithEngine.js';
import { useSimulation } from './useSimulation.js';

describe('useSimulation', () => {
	it('projects the count and wouldBeEmpty for a hypothetical rule', () => {
		const engine = makeSignalsEngine<DemoItem>({ sourceData: demoData });
		const { result } = renderHookWithEngine(
			() => useSimulation<DemoItem>({ withRule: ['color', inSet('color', ['red'])]}),
			engine,
		);

		expect(result.current.resultCount).toBe(2);
		expect(result.current.wouldBeEmpty).toBe(false);
	});

	it('flags wouldBeEmpty for a hypothetical that matches nothing', () => {
		const engine = makeSignalsEngine<DemoItem>({ sourceData: demoData });
		const { result } = renderHookWithEngine(
			() => useSimulation<DemoItem>({ withRule: ['color', inSet('color', ['chartreuse'])]}),
			engine,
		);

		expect(result.current.resultCount).toBe(0);
		expect(result.current.wouldBeEmpty).toBe(true);
	});

	it('re-evaluates when the active rule set changes', () => {
		const engine = makeSignalsEngine<DemoItem>({ sourceData: demoData });
		const { result } = renderHookWithEngine(
			() => useSimulation<DemoItem>({ withRule: ['color', inSet('color', ['red'])]}),
			engine,
		);

		expect(result.current.resultCount).toBe(2);

		act(() => {
			// Red items are a (10) and c (30); narrowing to price >= 25 leaves only c, so the
			// hypothetical "red" projection on top of it drops to 1.
			engine.core.addRule('price', range('price', { max: 100, min: 25 }));
		});

		expect(result.current.resultCount).toBe(1);
	});
});
