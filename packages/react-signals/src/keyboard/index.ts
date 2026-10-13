/**
 * Browser-only sub-export of `@filter-enginez/react-signals` — keyboard handler hooks that
 * require DOM APIs (`document`, `KeyboardEvent`, `HTMLElement`).
 *
 * @remarks
 * Imported as `@filter-enginez/react-signals/keyboard` per the package's `exports` map. Kept
 * separate from the main barrel so consumers running in SSR / test environments don't pull
 * in DOM-dependent code unless they explicitly opt in.
 *
 * @packageDocumentation
 */

export { useUndoRedoKeyboard, type UseUndoRedoKeyboardOptions } from './useUndoRedoKeyboard.js';
