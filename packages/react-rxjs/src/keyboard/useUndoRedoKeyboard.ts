/**
 * `useUndoRedoKeyboard` — browser-only hook wiring Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z and Cmd/Ctrl+Y to
 * the engine's undo / redo.
 *
 * @remarks
 * Per `docs/architecture.md` §12.3. The mirror of `@filter-enginez/react-signals`'s hook, typed
 * against `RxJsEngine` instead of `SignalsEngine`.
 *
 * **That mirroring is why the behavior does not live here.** `@filter-enginez/core/keyboard/browser`
 * owns the decision and the wiring, so the key handling exists in one place rather than one
 * hand-copied handler per binding; this is the React-shaped remainder. The write path is identical
 * for both (`RxJsEngine.core` and `SignalsEngine.core` are the same `FilterEngine`).
 *
 * @packageDocumentation
 */

import type { RxJsEngine } from '@filter-enginez/reactive-rxjs';

import { attachUndoRedoKeyboard } from '@filter-enginez/core/keyboard/browser';
import { useEffect } from 'react';

/**
 * Options for `useUndoRedoKeyboard`.
 */
export interface UseUndoRedoKeyboardOptions {
	/** DOM element to attach the keydown listener to. Defaults to `document.body`. */
	readonly scope?: HTMLElement;
	/** Whether to `preventDefault()` on matched keydown events. Default `true`. */
	readonly preventBrowserDefault?: boolean;
}

/**
 * Wire global Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z and Cmd/Ctrl+Y to `engine.core.devtools.undo()` /
 * `.redo()`.
 *
 * @typeParam T - The item type the engine operates over
 * @param engine - The rxjs engine whose devtools to drive
 * @param options - Optional scope / preventDefault configuration
 *
 * @example
 *   function App() {
 *     const engine = useFilterEngine<Wine>();
 *     useUndoRedoKeyboard(engine);
 *     return <FilterPanel />;
 *   }
 */
export function useUndoRedoKeyboard<T>(
	engine: RxJsEngine<T>,
	options?: UseUndoRedoKeyboardOptions,
): void {
	const scope = options?.scope;
	const shouldPreventBrowserDefault = options?.preventBrowserDefault ?? true;

	useEffect(
		(): (() => void) =>
			attachUndoRedoKeyboard(engine.core.devtools, {
				preventBrowserDefault: shouldPreventBrowserDefault,
				scope,
			}),
		[engine, scope, shouldPreventBrowserDefault],
	);
}
