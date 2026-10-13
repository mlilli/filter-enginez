/**
 * Browser-only keyboard bindings for the engine's time-travel cursor.
 *
 * @remarks
 * Exported from `@filter-enginez/core/keyboard/browser` (see `packages/core/package.json`'s
 * `exports` map). Consumers opt in through the sub-path, which is what keeps the default core entry
 * isomorphic — the same arrangement `./storage/browser` uses.
 *
 * The `useUndoRedoKeyboard` hooks in `react-signals` and `react-rxjs` are thin wrappers around
 * {@link attachUndoRedoKeyboard}; non-React apps call it directly.
 *
 * @example
 *   import { attachUndoRedoKeyboard } from '@filter-enginez/core/keyboard/browser';
 *
 * @packageDocumentation
 */

export {
	attachUndoRedoKeyboard,
	type AttachUndoRedoKeyboardOptions,
	type UndoRedoKeyboardScope,
	type UndoRedoTarget,
} from './attachUndoRedoKeyboard.js';
export {
	EDITABLE_TARGET_SELECTOR,
	type UndoRedoIntent,
	undoRedoIntent,
	type UndoRedoKeyLike,
} from './undoRedoIntent.js';
