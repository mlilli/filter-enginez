/**
 * Tests for `useUndoRedo` — surfaces the engine's devtools time-travel controls.
 *
 * @remarks
 * `Devtools.undo/redo` restore store snapshots directly and do NOT re-emit through the engine's
 * subscribe fan-out (see core's `TimeTravel`), so the hook re-renders on real mutations (which DO
 * emit) rather than after an undo/redo call. These tests therefore assert the action-log readouts
 * via a dispatched action and verify the undo/redo wiring by spying — not a post-undo re-render.
 */

import { value } from '@filter-enginez/core';
import { describe, expect, it, vi } from 'vitest';

import { act, demoData, type DemoItem, makeRxJsEngine, renderHookWithEngine } from '../test-support/renderWithEngine.js';
import { useUndoRedo } from './useUndoRedo.js';

describe('useUndoRedo', () => {
	it('reflects the action-log position after an action is dispatched', () => {
		const engine = makeRxJsEngine<DemoItem>({ devtools: { enabled: true }, sourceData: demoData });
		const { result } = renderHookWithEngine(() => useUndoRedo(), engine);

		expect(result.current.canUndo).toBe(false);
		expect(result.current.totalActions).toBe(0);

		act(() => {
			engine.core.addRule('color', value('color', 'red'));
		});

		expect(result.current.canUndo).toBe(true);
		expect(result.current.canRedo).toBe(false);
		expect(result.current.currentIndex).toBe(0);
		expect(result.current.totalActions).toBe(1);
	});

	it('invokes engine devtools undo and redo', () => {
		const engine = makeRxJsEngine<DemoItem>({ devtools: { enabled: true }, sourceData: demoData });
		const undoSpy = vi.spyOn(engine.core.devtools, 'undo');
		const redoSpy = vi.spyOn(engine.core.devtools, 'redo');
		const { result } = renderHookWithEngine(() => useUndoRedo(), engine);

		act(() => {
			result.current.undo();
		});
		act(() => {
			result.current.redo();
		});

		expect(undoSpy).toHaveBeenCalledTimes(1);
		expect(redoSpy).toHaveBeenCalledTimes(1);
	});
});
