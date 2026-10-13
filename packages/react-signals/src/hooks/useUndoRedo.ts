/**
 * `useUndoRedo` — hook surface over the engine's devtools time-travel controls.
 *
 * @remarks
 * Per `docs/architecture.md` §12.1. Exposes `undo`, `redo`, `canUndo`, `canRedo`, and the
 * current action-log index so a toolbar can render keyboard-shortcut-driven undo/redo
 * buttons tied to the engine's action history.
 *
 * **Re-evaluation triggers.** Subscribes to the engine's `lastChangeEvent` signal as the
 * coarse "the action log might have changed" pulse — every dispatched action emits a
 * change event (and the engine's `Devtools.recordAction` runs as part of `dispatchAndEmit`,
 * so by the time the change event fires, the action log is already updated). The
 * `canUndo` / `canRedo` / `currentIndex` / `totalActions` values are read freshly from
 * `engine.core.devtools` on every render, giving consumers always-current values.
 *
 * **Callback stability.** The `undo` / `redo` callbacks are wrapped in `useCallback` with
 * `[engine]` as the only dep so they stay reference-stable across re-renders. Important
 * for `<button onClick={undo}>` re-render avoidance and for keyboard handler hookup
 * (`useUndoRedoKeyboard` registers stable callbacks).
 *
 * @packageDocumentation
 */

import { useCallback } from 'react';

import { useFilterEngine } from './useFilterEngine.js';
import { useSignal } from './useSignal.js';

/**
 * The shape returned by `useUndoRedo`.
 */
export interface UndoRedoControls {
	/** Step back one action in the engine's action log. No-op when `canUndo` is `false`. */
	undo(): void;
	/** Step forward one action. No-op when `canRedo` is `false`. */
	redo(): void;
	/** Whether an undo is currently possible. */
	readonly canUndo: boolean;
	/** Whether a redo is currently possible. */
	readonly canRedo: boolean;
	/** Current action-log index. `-1` when the log is empty. */
	readonly currentIndex: number;
	/** Total entries in the action log. */
	readonly totalActions: number;
}

/**
 * Get undo/redo controls + the current action-log position. The returned `undo` / `redo`
 * callbacks are stable across re-renders; the `canUndo` / `canRedo` flags and
 * `currentIndex` update reactively as the action log mutates.
 *
 * @returns Undo/redo control surface
 *
 * @example
 *   function UndoRedoToolbar() {
 *     const { undo, redo, canUndo, canRedo } = useUndoRedo();
 *     return (
 *       <>
 *         <button disabled={!canUndo} onClick={undo}>Undo</button>
 *         <button disabled={!canRedo} onClick={redo}>Redo</button>
 *       </>
 *     );
 *   }
 */
export function useUndoRedo(): UndoRedoControls {
	const engine = useFilterEngine();

	// The lastChangeEvent signal pulses on every action — re-render the hook when it fires.
	useSignal(engine.lastChangeEvent);

	const undo = useCallback((): void => {
		engine.core.devtools.undo();
	}, [engine]);

	const redo = useCallback((): void => {
		engine.core.devtools.redo();
	}, [engine]);

	const devtools = engine.core.devtools;

	return {
		canRedo: devtools.canRedo,
		canUndo: devtools.canUndo,
		currentIndex: devtools.currentIndex,
		redo,
		totalActions: devtools.actionLog.size,
		undo,
	};
}
