/**
 * Tests for `useUndoRedoKeyboard` — the browser-only keyboard handler wiring Cmd/Ctrl+Z /
 * Cmd/Ctrl+Shift+Z / Cmd/Ctrl+Y to the engine's devtools undo/redo, with editable-target and
 * modifier guards, scope targeting, preventDefault control, and listener teardown.
 */

import { describe, expect, it, vi } from 'vitest';

import { makeSignalsEngine, renderHook } from '../test-support/renderWithEngine.js';
// Import through the sub-export barrel so `keyboard/index.ts` is exercised too.
import { useUndoRedoKeyboard } from './index.js';

/** Build a bubbling, cancelable keydown event with the supplied modifiers. */
const keydown = (init: KeyboardEventInit): KeyboardEvent =>
	new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });

describe('useUndoRedoKeyboard', () => {
	it('undoes on Cmd/Ctrl+Z and prevents the browser default', () => {
		const engine = makeSignalsEngine({ devtools: { enabled: true }});
		const undoSpy = vi.spyOn(engine.core.devtools, 'undo');

		renderHook(() => {
			useUndoRedoKeyboard(engine);
		});

		const event = keydown({ key: 'z', metaKey: true });

		document.body.dispatchEvent(event);

		expect(undoSpy).toHaveBeenCalledTimes(1);
		expect(event.defaultPrevented).toBe(true);
	});

	it('redoes on Cmd/Ctrl+Shift+Z and on Cmd/Ctrl+Y', () => {
		const engine = makeSignalsEngine({ devtools: { enabled: true }});
		const redoSpy = vi.spyOn(engine.core.devtools, 'redo');

		renderHook(() => {
			useUndoRedoKeyboard(engine);
		});

		document.body.dispatchEvent(keydown({ key: 'z', metaKey: true, shiftKey: true }));
		document.body.dispatchEvent(keydown({ ctrlKey: true, key: 'y' }));

		expect(redoSpy).toHaveBeenCalledTimes(2);
	});

	it('redoes on a real Cmd/Ctrl+Shift+Z, whose `key` is an UPPERCASE Z', () => {
		// The key case at the React layer. Every case above builds `key: 'z'` WITH `shiftKey`, which
		// is a shape no browser produces: a genuinely shifted Z reports `key: 'Z'`. Without this case
		// the suite could stay green while the shortcut is dead in an app — a fake that does not
		// match the boundary.
		// Verified in Chrome: typing "Zz" past a keydown recorder yields 'Z' then 'z'.
		const engine = makeSignalsEngine({ devtools: { enabled: true }});
		const redoSpy = vi.spyOn(engine.core.devtools, 'redo');

		renderHook(() => {
			useUndoRedoKeyboard(engine);
		});

		document.body.dispatchEvent(keydown({ key: 'Z', metaKey: true, shiftKey: true }));

		expect(redoSpy).toHaveBeenCalledTimes(1);
	});

	it('leaves the browser default intact on redo when preventBrowserDefault is false', () => {
		const engine = makeSignalsEngine({ devtools: { enabled: true }});
		const redoSpy = vi.spyOn(engine.core.devtools, 'redo');

		renderHook(() => {
			useUndoRedoKeyboard(engine, { preventBrowserDefault: false });
		});

		const event = keydown({ key: 'z', metaKey: true, shiftKey: true });

		document.body.dispatchEvent(event);

		expect(redoSpy).toHaveBeenCalledTimes(1);
		expect(event.defaultPrevented).toBe(false);
	});

	it('ignores keypresses without a meta/ctrl modifier', () => {
		const engine = makeSignalsEngine({ devtools: { enabled: true }});
		const undoSpy = vi.spyOn(engine.core.devtools, 'undo');

		renderHook(() => {
			useUndoRedoKeyboard(engine);
		});

		document.body.dispatchEvent(keydown({ key: 'z' }));

		expect(undoSpy).not.toHaveBeenCalled();
	});

	it('ignores a modified keypress that is neither undo nor redo', () => {
		const engine = makeSignalsEngine({ devtools: { enabled: true }});
		const undoSpy = vi.spyOn(engine.core.devtools, 'undo');
		const redoSpy = vi.spyOn(engine.core.devtools, 'redo');

		renderHook(() => {
			useUndoRedoKeyboard(engine);
		});

		document.body.dispatchEvent(keydown({ key: 'a', metaKey: true }));

		expect(undoSpy).not.toHaveBeenCalled();
		expect(redoSpy).not.toHaveBeenCalled();
	});

	it('ignores keypresses originating from an editable element', () => {
		const engine = makeSignalsEngine({ devtools: { enabled: true }});
		const undoSpy = vi.spyOn(engine.core.devtools, 'undo');

		renderHook(() => {
			useUndoRedoKeyboard(engine);
		});

		const input = document.createElement('input');

		document.body.appendChild(input);
		input.dispatchEvent(keydown({ key: 'z', metaKey: true }));
		input.remove();

		expect(undoSpy).not.toHaveBeenCalled();
	});

	it('leaves the browser default intact when preventBrowserDefault is false', () => {
		const engine = makeSignalsEngine({ devtools: { enabled: true }});
		const undoSpy = vi.spyOn(engine.core.devtools, 'undo');

		renderHook(() => {
			useUndoRedoKeyboard(engine, { preventBrowserDefault: false });
		});

		const event = keydown({ key: 'z', metaKey: true });

		document.body.dispatchEvent(event);

		expect(undoSpy).toHaveBeenCalledTimes(1);
		expect(event.defaultPrevented).toBe(false);
	});

	it('scopes the listener to the supplied element', () => {
		const engine = makeSignalsEngine({ devtools: { enabled: true }});
		const undoSpy = vi.spyOn(engine.core.devtools, 'undo');
		const scope = document.createElement('div');

		document.body.appendChild(scope);
		renderHook(() => {
			useUndoRedoKeyboard(engine, { scope });
		});

		scope.dispatchEvent(keydown({ key: 'z', metaKey: true }));
		scope.remove();

		expect(undoSpy).toHaveBeenCalledTimes(1);
	});

	it('removes the listener on unmount', () => {
		const engine = makeSignalsEngine({ devtools: { enabled: true }});
		const undoSpy = vi.spyOn(engine.core.devtools, 'undo');
		const { unmount } = renderHook(() => {
			useUndoRedoKeyboard(engine);
		});

		unmount();
		document.body.dispatchEvent(keydown({ key: 'z', metaKey: true }));

		expect(undoSpy).not.toHaveBeenCalled();
	});
});
