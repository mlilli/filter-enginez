/**
 * Tests for `ValueRule` — exact-equality filtering against a single configured value.
 *
 * @remarks
 * Covers both predicate paths (matching vs non-matching value), the `undefined`-config no-op
 * path (matches everything), behavior on a missing field, and the serialized shape.
 */

import { describe, expect, it } from 'vitest';

import { ValueRule } from './ValueRule.js';

describe('ValueRule', () => {
	it('passes items whose field value strictly equals the configured value', () => {
		const rule = new ValueRule<string>('category', 'wine');

		expect(rule.action({ category: 'wine' }, rule)).toBe(true);
	});

	it('rejects items whose field value differs from the configured value', () => {
		const rule = new ValueRule<string>('category', 'wine');

		expect(rule.action({ category: 'beer' }, rule)).toBe(false);
	});

	it('matches every item when the configured value is undefined (no-op rule)', () => {
		const rule = new ValueRule<string>('category', undefined);

		expect(rule.action({ category: 'wine' }, rule)).toBe(true);
		expect(rule.action({ category: 'beer' }, rule)).toBe(true);
	});

	it('rejects items whose field is missing (extracted value is undefined, config is not)', () => {
		const rule = new ValueRule<string>('category', 'wine');

		expect(rule.action({ unrelated: true }, rule)).toBe(false);
	});

	it('serializes to its type, field, and config shape', () => {
		const rule = new ValueRule<string>('category', 'wine');

		expect(rule.serialize()).toEqual({
			config: 'wine',
			field: 'category',
			type: 'ValueRule',
		});
	});
});
