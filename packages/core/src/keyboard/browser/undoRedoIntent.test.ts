/**
 * Tests for the undo / redo keystroke decision.
 *
 * @remarks
 * The first case below pins the subtlest property of the decision — Shift+Z. See its comment.
 *
 * @packageDocumentation
 */

import { describe, expect, it } from 'vitest';

import { EDITABLE_TARGET_SELECTOR, undoRedoIntent, type UndoRedoKeyLike } from './undoRedoIntent.js';

/**
 * Build a keystroke.
 *
 * @param overrides - Fields to set; everything unset is a released modifier and no target.
 * @returns The event-shaped object.
 */
function press(overrides: { key: string } & Partial<UndoRedoKeyLike>): UndoRedoKeyLike {
	return { ctrlKey: false, metaKey: false, shiftKey: false, target: null, ...overrides };
}

/**
 * A target that matches the editable selector, or does not.
 *
 * @param isEditable - Whether the element should report itself editable.
 * @returns Something with just enough of `Element` to be read.
 */
function target(isEditable: boolean): { matches: (selector: string) => boolean } {
	return { matches: (selector) => isEditable && selector === EDITABLE_TARGET_SELECTOR };
}

describe('undoRedoIntent', () => {
	it('reads a SHIFTED z as redo, because `key` reports the uppercase letter', () => {
		// THE key case. A naive check — `event.key === 'z'`, then `event.shiftKey` — never matches a
		// real Shift+Z, which reports `key: 'Z'`, so Cmd/Ctrl+Shift+Z would do nothing and redo
		// would work only via Cmd/Ctrl+Y.
		//
		// Confirmed in Chrome rather than assumed: typing "Zz" into a page with a keydown recorder
		// yields `{key:'Z',shift:true}` then `{key:'z',shift:false}`. (Synthetic CDP key events report
		// a lowercase 'z' even with shift set, which is why browser automation alone cannot catch it.)
		expect(undoRedoIntent(press({ key: 'Z', metaKey: true, shiftKey: true }))).toBe('redo');
		expect(undoRedoIntent(press({ ctrlKey: true, key: 'Z', shiftKey: true }))).toBe('redo');
	});

	it('still reads a lower-cased shifted z as redo', () => {
		// Belt and braces: a non-US layout, an IME, or a synthetic event may hand back 'z' WITH shift.
		// Both spellings must mean the same thing or the shortcut is layout-dependent.
		expect(undoRedoIntent(press({ key: 'z', metaKey: true, shiftKey: true }))).toBe('redo');
	});

	it('reads an unshifted z as undo, under either modifier', () => {
		expect(undoRedoIntent(press({ key: 'z', metaKey: true }))).toBe('undo');
		expect(undoRedoIntent(press({ ctrlKey: true, key: 'z' }))).toBe('undo');
	});

	it('reads y as redo — the Windows spelling, accepted alongside the macOS one', () => {
		expect(undoRedoIntent(press({ ctrlKey: true, key: 'y' }))).toBe('redo');
		expect(undoRedoIntent(press({ key: 'Y', metaKey: true, shiftKey: true }))).toBe('redo');
	});

	it('ignores z and y with no modifier held', () => {
		// Otherwise typing the letter z anywhere on the page would undo the last filter.
		expect(undoRedoIntent(press({ key: 'z' }))).toBeNull();
		expect(undoRedoIntent(press({ key: 'y' }))).toBeNull();
	});

	it('ignores a modified key it does not own', () => {
		// Load-bearing: `null` is how the caller decides NOT to preventDefault, so Cmd+A, Cmd+C and
		// every other page binding keep working while this listener is attached.
		expect(undoRedoIntent(press({ key: 'a', metaKey: true }))).toBeNull();
		expect(undoRedoIntent(press({ ctrlKey: true, key: 'Enter' }))).toBeNull();
	});

	it('yields to an editable target even when the keystroke would otherwise match', () => {
		// A user typing in the wine search box and hitting Cmd+Z means "undo my typing". The text
		// field's own stack has to win, or the filter panel steals it.
		expect(undoRedoIntent(press({ key: 'z', metaKey: true, target: target(true) }))).toBeNull();
		expect(undoRedoIntent(press({ ctrlKey: true, key: 'y', target: target(true) }))).toBeNull();
	});

	it('acts normally for a non-editable target', () => {
		expect(undoRedoIntent(press({ key: 'z', metaKey: true, target: target(false) }))).toBe('undo');
	});

	it('acts normally when there is no target at all', () => {
		// `event.target` is null for a synthesized event, and optional chaining must not be read as
		// "editable" — an undefined target that blocked the shortcut would break it under test only.
		expect(undoRedoIntent(press({ key: 'z', metaKey: true, target: undefined }))).toBe('undo');
	});
});

describe('EDITABLE_TARGET_SELECTOR', () => {
	it('lists the editable contenteditable spellings and not the disabled one', () => {
		// `[contenteditable]` alone would also match `[contenteditable="false"]`, which is an element
		// explicitly opting OUT of being editable and therefore should NOT be exempt.
		expect(EDITABLE_TARGET_SELECTOR).toContain('[contenteditable="true"]');
		expect(EDITABLE_TARGET_SELECTOR).toContain('[contenteditable=""]');
		expect(EDITABLE_TARGET_SELECTOR).toContain('[contenteditable="plaintext-only"]');
		expect(EDITABLE_TARGET_SELECTOR).not.toContain('"false"');
	});
});
