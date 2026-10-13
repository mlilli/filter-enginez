/**
 * `useUndoRedo` — hook surface over the engine's devtools time-travel controls.
 *
 * @remarks
 * Per `docs/architecture.md` §12.2. Mirror of `react-signals/useUndoRedo` over the RxJS
 * adapter. Subscribes to `lastChangeEvent$` as the "action log might have changed" pulse;
 * the `canUndo` / `canRedo` / `currentIndex` / `totalActions` values are read freshly from
 * `engine.core.devtools` on every render.
 *
 * @packageDocumentation
 */

import { useCallback } from 'react';

import { useFilterEngine } from './useFilterEngine.js';
import { useObservable } from './useObservable.js';

/**
 * The shape returned by `useUndoRedo`.
 */
export interface UndoRedoControls {
	readonly canRedo: boolean;
	readonly canUndo: boolean;
	readonly currentIndex: number;
	redo(): void;
	readonly totalActions: number;
	undo(): void;
}

/**
 * Get undo/redo controls + the current action-log position. The returned `undo` / `redo`
 * callbacks are stable across re-renders; the `canUndo` / `canRedo` flags and
 * `currentIndex` update reactively as the action log mutates.
 */
export function useUndoRedo(): UndoRedoControls {
	const engine = useFilterEngine();

	useObservable(engine.lastChangeEvent$, null);

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
