/**
 * Tests for `ExistsRule` — passes items whose extracted field value is neither null nor undefined.
 *
 * @remarks
 * Covers the present-value pass path, the explicit-null and explicit-undefined reject paths, the
 * missing-field reject path, and the counter-intuitive cases where empty string, `0`, and `false`
 * all PASS (they are present, just falsy). Also asserts the serialized shape with its
 * `undefined` config.
 */

import { describe, expect, it } from 'vitest';

import { ExistsRule } from './ExistsRule.js';

describe('ExistsRule', () => {
	it('passes items whose field has a non-nil value', () => {
		const rule = new ExistsRule('photoUrl');

		expect(rule.action({ photoUrl: 'https://example.com/a.png' }, rule)).toBe(true);
	});

	it('rejects items whose field is explicitly null', () => {
		const rule = new ExistsRule('photoUrl');

		expect(rule.action({ photoUrl: null }, rule)).toBe(false);
	});

	it('rejects items whose field is explicitly undefined', () => {
		const rule = new ExistsRule('photoUrl');

		expect(rule.action({ photoUrl: undefined }, rule)).toBe(false);
	});

	it('rejects items whose field is missing entirely', () => {
		const rule = new ExistsRule('photoUrl');

		expect(rule.action({ unrelated: true }, rule)).toBe(false);
	});

	it('passes falsy-but-present values: empty string, zero, and false', () => {
		const rule = new ExistsRule('value');

		expect(rule.action({ value: '' }, rule)).toBe(true);
		expect(rule.action({ value: 0 }, rule)).toBe(true);
		expect(rule.action({ value: false }, rule)).toBe(true);
	});

	it('serializes to its type and field with an undefined config', () => {
		const rule = new ExistsRule('photoUrl');

		expect(rule.serialize()).toEqual({
			config: undefined,
			field: 'photoUrl',
			type: 'ExistsRule',
		});
	});
});
