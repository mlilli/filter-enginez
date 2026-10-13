/**
 * `attachUndoRedoKeyboard` — wire Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z and Cmd/Ctrl+Y to a time-travel
 * cursor, in any framework or none.
 *
 * @remarks
 * Per `docs/architecture.md` §12.3. Browser-only, so it lives behind the `./keyboard/browser`
 * sub-export alongside `./storage/browser` — the default core entry stays isomorphic.
 *
 * **Why this is a plain attach/detach rather than a hook.** Apps on every supported framework need
 * this binding, and only two of the bindings are React. `addEventListener` + a teardown function is the shape every reactivity
 * system already knows how to hold: React's `useEffect` returns it, Svelte's `$effect` returns it,
 * Vue's `onMounted` pairs with `onUnmounted`, Angular has `DestroyRef`, and vanilla just calls it.
 * The React hooks in `react-signals` / `react-rxjs` are four lines each around this.
 *
 * @packageDocumentation
 */

import { undoRedoIntent } from './undoRedoIntent.js';

/**
 * The time-travel surface this binding drives.
 *
 * @remarks
 * Structural, and deliberately only two methods wide. `SignalsEngine.core.devtools`,
 * `RxJsEngine.core.devtools` and a bare `FilterEngine`'s all satisfy it, so no app has to
 * import an engine type to get a keyboard shortcut.
 */
export interface UndoRedoTarget {
	/** Step the cursor forward one action. */
	readonly redo: () => void;
	/** Step the cursor back one action. */
	readonly undo: () => void;
}

/**
 * The listener host — `document.body` in practice, structural here so the binding is testable
 * without a DOM.
 */
export interface UndoRedoKeyboardScope {
	// METHOD syntax, deliberately: it is bivariant, and property syntax under `strictFunctionTypes`
	// makes a real `HTMLElement` unassignable to this interface — and passing `document.body` is the
	// ordinary case, not the exotic one.
	addEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void): void;
	removeEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void): void;
}

/**
 * Options for {@link attachUndoRedoKeyboard}.
 */
export interface AttachUndoRedoKeyboardOptions {
	/**
	 * Whether to `preventDefault()` the matched keystroke. Default `true`, which keeps the browser's
	 * own Cmd+Z from firing as well. Set `false` only to let the two compose (rare).
	 */
	readonly preventBrowserDefault?: boolean;
	/**
	 * Where to listen. Defaults to `document.body`.
	 *
	 * @remarks
	 * Pass an element when the filter UI is one of several panes that each want their own undo stack
	 * — the handler then fires only while focus is inside that subtree.
	 */
	readonly scope?: UndoRedoKeyboardScope;
}

// #region docs:attach-undo-redo-keyboard
/**
 * Bind undo / redo keyboard shortcuts, returning the teardown.
 *
 * @param target - The time-travel cursor to drive, e.g. `engine.core.devtools`.
 * @param options - Optional scope / `preventDefault` configuration.
 * @returns A function that removes the listener. Always call it — a second mount without it means
 *   every keystroke undoes twice.
 *
 * @example
 *   // Svelte
 *   $effect(() => attachUndoRedoKeyboard(engine.core.devtools));
 */
export function attachUndoRedoKeyboard(
	target: UndoRedoTarget,
	options?: AttachUndoRedoKeyboardOptions,
): () => void {
	const shouldPreventBrowserDefault = options?.preventBrowserDefault ?? true;
	// Annotated rather than inferred: without it the union widens to `… | HTMLElement` and the two
	// listener calls below have to resolve against HTMLElement's overload set.
	const scope: UndoRedoKeyboardScope = options?.scope ?? document.body;

	const onKeyDown = (event: KeyboardEvent): void => {
		const intent = undoRedoIntent(event);

		if (intent === null) {
			return;
		}
		if (shouldPreventBrowserDefault) {
			event.preventDefault();
		}
		if (intent === 'undo') {
			target.undo();

			return;
		}
		target.redo();
	};

	scope.addEventListener('keydown', onKeyDown);

	return (): void => {
		scope.removeEventListener('keydown', onKeyDown);
	};
}
// #endregion docs:attach-undo-redo-keyboard
