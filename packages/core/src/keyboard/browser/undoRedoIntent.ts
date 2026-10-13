/**
 * `undoRedoIntent` — what a keystroke MEANS, decided once for every framework binding.
 *
 * @remarks
 * Split out from {@link attachUndoRedoKeyboard} because the decision is pure and the wiring is not.
 * That split is what lets the interesting cases — Shift, `y`, an editable target, a bare `z` — be
 * tested as plain function calls with no DOM, no listener and no engine.
 *
 * **Every clause here is a compatibility choice, not an arbitrary one.** `Cmd/Ctrl+Z` and
 * `Cmd/Ctrl+Shift+Z` are the macOS spelling; `Cmd/Ctrl+Y` is the Windows one, accepted alongside
 * rather than instead, because a user's fingers come from their other apps and not from this one.
 *
 * @packageDocumentation
 */

/**
 * Elements that own their own undo stack.
 *
 * @remarks
 * A user typing in a search box and hitting Cmd+Z means "undo my typing", never "undo my last
 * filter" — the text field's stack has to win. All three `contenteditable` spellings are listed
 * because `[contenteditable]` alone misses neither, but `[contenteditable="false"]` would be caught
 * by it, and an explicitly-disabled editable should NOT be exempt.
 */
export const EDITABLE_TARGET_SELECTOR =
	'input, textarea, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';

/**
 * The minimum a keyboard event must expose for {@link undoRedoIntent} to read it.
 *
 * @remarks
 * Structural rather than `KeyboardEvent` so the decision is testable from Node with an object
 * literal, and so this module stays free of the DOM lib even though it lives behind the `/browser`
 * sub-export.
 */
export interface UndoRedoKeyLike {
	/** True on Windows / Linux Control. */
	readonly ctrlKey: boolean;
	/** `KeyboardEvent.key`. */
	readonly key: string;
	/** True on macOS Command. */
	readonly metaKey: boolean;
	/** True when Shift is held. */
	readonly shiftKey: boolean;
	/**
	 * Whatever the keystroke was aimed at, if anything.
	 *
	 * @remarks
	 * Typed `unknown` rather than as an element on purpose. `KeyboardEvent.target` is an
	 * `EventTarget`, which is NOT necessarily an `Element` — a keystroke can be dispatched at
	 * `window`, and `EventTarget` has no `matches`. An interface with an optional `matches` looks
	 * like the right answer and is not: TypeScript's weak-type check rejects `EventTarget` against
	 * an all-optional type outright, so the real event would fail to satisfy it. Narrowing at the
	 * use site keeps a real `KeyboardEvent` assignable AND keeps the fallback honest — a target with
	 * no `matches` is not an editable field, so the shortcut fires.
	 */
	readonly target?: unknown;
}

/**
 * Whether a keystroke landed inside something that owns its own undo stack.
 *
 * @param target - The event's target, in whatever shape it arrived.
 * @returns `true` only for a real element reporting a match.
 *
 * @internal
 */
function isEditableTarget(target: unknown): boolean {
	if (typeof target !== 'object' || target === null) {
		return false;
	}
	const { matches } = target as { matches?: unknown };

	return typeof matches === 'function' && (matches as (selector: string) => boolean).call(target, EDITABLE_TARGET_SELECTOR);
}

/** What a keystroke asked for, or `null` when it asked for nothing this owns. */
export type UndoRedoIntent = 'redo' | 'undo';

// #region docs:undo-redo-intent
/**
 * Decide whether a keystroke is an undo, a redo, or neither.
 *
 * @remarks
 * Returning `null` rather than a no-op is what lets the caller decide whether to `preventDefault` —
 * a key this does not own must keep its browser behavior, or the shortcut swallows Cmd+Y, Cmd+Shift+Z
 * and every other binding on the page.
 *
 * @param event - The keystroke, or anything shaped like one.
 * @returns The intent, or `null` for a key this does not own.
 */
export function undoRedoIntent(event: UndoRedoKeyLike): UndoRedoIntent | null {
	// Checked FIRST, before the modifier test: a text field owns Cmd+Z whether or not this handler
	// would otherwise have claimed it, and reordering these makes the difference invisible in tests
	// that only ever pass a modifier.
	if (isEditableTarget(event.target)) {
		return null;
	}
	if (!event.metaKey && !event.ctrlKey) {
		return null;
	}
	// `key` is case-sensitive and Shift+Z reports an UPPERCASE 'Z'. Without this normalization a
	// lowercase-only comparison would make redo work on Windows (`Ctrl+Y`) but do nothing on macOS
	// (`Cmd+Shift+Z`).
	const key = event.key.toLowerCase();

	if (key === 'y') {
		return 'redo';
	}
	if (key !== 'z') {
		return null;
	}

	return event.shiftKey ? 'redo' : 'undo';
}
// #endregion docs:undo-redo-intent
