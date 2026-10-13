/**
 * Tests for the undo / redo keyboard binding.
 *
 * @remarks
 * Driven through a structural scope rather than a DOM: `core`'s tests run under the `node` Vitest
 * project, and the binding was given a structural scope option precisely so it stays testable there.
 *
 * @packageDocumentation
 */

import { describe, expect, it, vi } from 'vitest';

import {
	attachUndoRedoKeyboard,
	type UndoRedoKeyboardScope,
} from './attachUndoRedoKeyboard.js';

/** A fake listener host that lets a test fire the keystroke it registered. */
interface FakeScope extends UndoRedoKeyboardScope {
	/** How many listeners are currently attached. */
	readonly count: () => number;
	/** Fire a keystroke at every attached listener. */
	readonly fire: (event: Record<string, unknown>) => void;
}

/**
 * Build a listener host.
 *
 * @returns The fake scope.
 */
function fakeScope(): FakeScope {
	const listeners = new Set<(event: KeyboardEvent) => void>();

	return {
		addEventListener(_type, listener) {
			listeners.add(listener);
		},
		count: () => listeners.size,
		fire: (event) => {
			for (const listener of listeners) {
				listener(event as unknown as KeyboardEvent);
			}
		},
		removeEventListener(_type, listener) {
			listeners.delete(listener);
		},
	};
}

/**
 * Build a keystroke with a spy-able `preventDefault`.
 *
 * @param overrides - Event fields to set.
 * @returns The event-shaped object plus its `preventDefault` spy.
 */
function keyEvent(overrides: Record<string, unknown>): Record<string, unknown> {
	return { ctrlKey: false, key: 'z', metaKey: false, preventDefault: vi.fn(), shiftKey: false, target: null, ...overrides };
}

describe('attachUndoRedoKeyboard', () => {
	it('calls undo on Cmd/Ctrl+Z and redo on a shifted Z', () => {
		const target = { redo: vi.fn(), undo: vi.fn() };
		const scope = fakeScope();

		attachUndoRedoKeyboard(target, { scope });

		scope.fire(keyEvent({ metaKey: true }));
		expect(target.undo).toHaveBeenCalledTimes(1);
		expect(target.redo).not.toHaveBeenCalled();

		// The uppercase `key` is the whole point — see undoRedoIntent.test.ts.
		scope.fire(keyEvent({ key: 'Z', metaKey: true, shiftKey: true }));
		expect(target.redo).toHaveBeenCalledTimes(1);

		scope.fire(keyEvent({ ctrlKey: true, key: 'y' }));
		expect(target.redo).toHaveBeenCalledTimes(2);
	});

	it('prevents the browser default by default', () => {
		const scope = fakeScope();

		attachUndoRedoKeyboard({ redo: vi.fn(), undo: vi.fn() }, { scope });

		const event = keyEvent({ metaKey: true });

		scope.fire(event);
		expect(event['preventDefault']).toHaveBeenCalledTimes(1);
	});

	it('leaves the browser default alone when asked to', () => {
		const target = { redo: vi.fn(), undo: vi.fn() };
		const scope = fakeScope();

		attachUndoRedoKeyboard(target, { preventBrowserDefault: false, scope });

		const event = keyEvent({ metaKey: true });

		scope.fire(event);
		// The engine still undoes — only the browser's own undo is allowed to compose with it.
		expect(target.undo).toHaveBeenCalledTimes(1);
		expect(event['preventDefault']).not.toHaveBeenCalled();
	});

	it('does not preventDefault a key it does not own', () => {
		// The reason the intent function returns `null` rather than a no-op. Swallowing Cmd+A here
		// would break select-all on every page that mounts a filter panel.
		const target = { redo: vi.fn(), undo: vi.fn() };
		const scope = fakeScope();

		attachUndoRedoKeyboard(target, { scope });

		const event = keyEvent({ key: 'a', metaKey: true });

		scope.fire(event);
		expect(event['preventDefault']).not.toHaveBeenCalled();
		expect(target.undo).not.toHaveBeenCalled();
		expect(target.redo).not.toHaveBeenCalled();
	});

	it('detaches, so a remount does not undo twice per keystroke', () => {
		const target = { redo: vi.fn(), undo: vi.fn() };
		const scope = fakeScope();

		const detach = attachUndoRedoKeyboard(target, { scope });

		expect(scope.count()).toBe(1);
		detach();
		expect(scope.count()).toBe(0);

		scope.fire(keyEvent({ metaKey: true }));
		expect(target.undo).not.toHaveBeenCalled();
	});

	it('defaults its scope to document.body', () => {
		// The only line that touches a browser global, and the reason this module sits behind the
		// `/browser` sub-export. Stubbed rather than skipped: a default that silently pointed at the
		// wrong node would make the shortcut work in tests and nowhere else.
		const added: string[] = [];
		const body = {
			addEventListener(type: string) {
				added.push(type);
			},
			removeEventListener: () => undefined,
		};

		vi.stubGlobal('document', { body });
		try {
			attachUndoRedoKeyboard({ redo: vi.fn(), undo: vi.fn() })();
			expect(added).toEqual(['keydown']);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
