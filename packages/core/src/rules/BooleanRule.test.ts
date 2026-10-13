/**
 * Tests for `BooleanRule` — typed convenience for boolean field equality.
 *
 * @remarks
 * Covers both predicate paths (matching vs non-matching boolean), the `undefined`-config no-op
 * path, behavior on a missing field, and the serialized shape that distinguishes boolean intent
 * via its `type`.
 */

import { describe, expect, it } from 'vitest';

import { BooleanRule } from './BooleanRule.js';

describe('BooleanRule', () => {
	it('passes items whose field value equals the configured boolean', () => {
		const rule = new BooleanRule('available', true);

		expect(rule.action({ available: true }, rule)).toBe(true);
	});

	it('rejects items whose field value differs from the configured boolean', () => {
		const rule = new BooleanRule('available', true);

		expect(rule.action({ available: false }, rule)).toBe(false);
	});

	it('matches the configured false flag exactly', () => {
		const rule = new BooleanRule('archived', false);

		expect(rule.action({ archived: false }, rule)).toBe(true);
		expect(rule.action({ archived: true }, rule)).toBe(false);
	});

	it('matches every item when the configured value is undefined (no-op rule)', () => {
		const rule = new BooleanRule('available', undefined);

		expect(rule.action({ available: true }, rule)).toBe(true);
		expect(rule.action({ available: false }, rule)).toBe(true);
	});

	it('rejects items whose field is missing (extracted undefined !== configured boolean)', () => {
		const rule = new BooleanRule('available', true);

		expect(rule.action({ unrelated: 1 }, rule)).toBe(false);
	});

	it('serializes with its own type so boolean intent is distinguishable', () => {
		const rule = new BooleanRule('available', true);

		expect(rule.serialize()).toEqual({
			config: true,
			field: 'available',
			type: 'BooleanRule',
		});
	});
});
