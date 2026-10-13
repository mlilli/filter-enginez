/**
 * Tests for the dotted-path / bracket-indexed property resolver — `getPath` + `parsePath`.
 *
 * @remarks
 * Covers the nil-object guard, the simple-key fast path, dotted traversal, unquoted array
 * indices, double- and single-quoted bracket keys (for keys containing dots), the
 * missing-segment short-circuit, and trailing-buffer flushing in `parsePath`.
 */

import { describe, expect, it } from 'vitest';

import { getPath, parsePath } from './getPath.js';

describe('getPath', () => {
	it('returns undefined for a null or undefined object', () => {
		expect(getPath(null, 'a')).toBeUndefined();
		expect(getPath(undefined, 'a.b')).toBeUndefined();
	});

	it('resolves a simple top-level key via the fast path', () => {
		expect(getPath({ name: 'Cy' }, 'name')).toBe('Cy');
	});

	it('returns undefined for a missing simple key', () => {
		expect(getPath({ name: 'Cy' }, 'age')).toBeUndefined();
	});

	it('resolves a dotted path', () => {
		expect(getPath({ a: { b: { c: 42 }}}, 'a.b.c')).toBe(42);
	});

	it('resolves an unquoted array index', () => {
		expect(getPath({ tags: ['x', 'y', 'z']}, 'tags[1]')).toBe('y');
	});

	it('resolves an index followed by a dotted key', () => {
		expect(getPath({ items: [{ name: 'first' }, { name: 'second' }]}, 'items[1].name')).toBe('second');
	});

	it('resolves a double-quoted bracket key containing a dot', () => {
		expect(getPath({ meta: { 'weird.key': 1 }}, 'meta["weird.key"]')).toBe(1);
	});

	it('resolves a single-quoted bracket key containing a dot', () => {
		expect(getPath({ meta: { 'weird.key': 7 }}, "meta['weird.key']")).toBe(7);
	});

	it('short-circuits to undefined when a mid-path segment is missing', () => {
		expect(getPath({ a: 1 }, 'b.c')).toBeUndefined();
		expect(getPath({ a: { b: null }}, 'a.b.c')).toBeUndefined();
	});
});

describe('parsePath', () => {
	it('splits a simple dotted path', () => {
		expect(parsePath('a.b.c')).toEqual(['a', 'b', 'c']);
	});

	it('splits a single segment', () => {
		expect(parsePath('name')).toEqual(['name']);
	});

	it('parses an unquoted bracket index after a key', () => {
		expect(parsePath('tags[0]')).toEqual(['tags', '0']);
	});

	it('parses a bracket index at the very start (empty leading buffer)', () => {
		expect(parsePath('[0]')).toEqual(['0']);
	});

	it('parses a double-quoted bracket key', () => {
		expect(parsePath('meta["weird.key"]')).toEqual(['meta', 'weird.key']);
	});

	it('parses a single-quoted bracket key', () => {
		expect(parsePath("meta['a.b']")).toEqual(['meta', 'a.b']);
	});

	it('flushes the trailing buffer after a bracket segment', () => {
		expect(parsePath('items[2].name')).toEqual(['items', '2', 'name']);
	});

	it('ignores a leading dot (empty buffer is not pushed)', () => {
		expect(parsePath('.a')).toEqual(['a']);
	});

	it('returns an empty array for an empty string', () => {
		expect(parsePath('')).toEqual([]);
	});
});
