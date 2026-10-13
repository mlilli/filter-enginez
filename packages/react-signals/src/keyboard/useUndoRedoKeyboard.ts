/**
 * `useUndoRedoKeyboard` — browser-only hook wiring Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z and Cmd/Ctrl+Y to
 * the engine's undo / redo.
 *
 * @remarks
 * Per `docs/architecture.md` §12.3. Browser-only — it lives in the `./keyboard` sub-export so
 * consumers running the React bindings in test / SSR contexts don't pull it into their bundle by
 * default.
 *
 * **The behavior lives in `@filter-enginez/core/keyboard/browser`,** shared by every framework
 * binding so the key handling exists in exactly one place. What remains here is the React-shaped
 * part and nothing else — a `useEffect` returning the teardown the attach function already hands
 * back.
 *
 * @packageDocumentation
 */

import type { SignalsEngine } from '@filter-enginez/reactive-signals';

import { attachUndoRedoKeyboard } from '@filter-enginez/core/keyboard/browser';
import { useEffect } from 'react';

/**
 * Options for `useUndoRedoKeyboard`.
 */
export interface UseUndoRedoKeyboardOptions {
	/**
	 * The DOM element to attach the keydown listener to. Defaults to `document.body`. Pass a
	 * specific element when the filter UI is one panel of several that each want their own undo
	 * stack — the listener only fires when focus is inside `scope`.
	 */
	readonly scope?: HTMLElement;

	/**
	 * Whether to call `preventDefault()` on the matched keydown event. Default `true` — keeps the
	 * browser's built-in Cmd+Z behavior from also firing. Set to `false` only if you want the
	 * browser's undo to compose with the engine's (rare).
	 */
	readonly preventBrowserDefault?: boolean;
}

/**
 * Wire global Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z and Cmd/Ctrl+Y to `engine.core.devtools.undo()` /
 * `.redo()`.
 *
 * @typeParam T - The item type the engine operates over
 * @param engine - The signals engine whose devtools to drive
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
	engine: SignalsEngine<T>,
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
