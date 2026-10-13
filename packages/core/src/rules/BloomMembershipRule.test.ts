/**
 * Tests for `BloomMembershipRule` — probabilistic set membership against a prebuilt Bloom bitset,
 * with the custom serialize/deserialize round-trip (the bitset IS the config).
 *
 * @remarks
 * Covers `action` (member → true, certain-absent → false, nil field → false, and the `String(value)`
 * coercion path for a numeric field), the overridden `serialize()` shape plus its `'<function>'`
 * field-placeholder branch, every branch of the static `deserialize` guard (null / non-object /
 * missing bits / bad hashCount / bad sizeBits) plus the `'<function>'` → `undefined` field branch,
 * a full round-trip that preserves membership behavior, routing through `ruleRegistry.deserialize`,
 * and the `bloomMembership` factory.
 */

import { describe, expect, it } from 'vitest';

import { BloomFilter } from '../lib/BloomFilter.js';
import { BloomMembershipRule } from './BloomMembershipRule.js';
import { bloomMembership } from './factories.js';
import { ruleRegistry } from './ruleRegistry.js';

/**
 * Build a generously-sized filter (p = 0.001) from string keys, so the specific absent values the
 * tests probe deterministically test `false` (no false positive for these fixed inputs).
 */
function buildFilter(keys: readonly string[]): BloomFilter {
	const filter = BloomFilter.forCapacity(Math.max(keys.length, 1) * 10, 0.001);

	for (const key of keys) {
		filter.add(key);
	}

	return filter;
}

describe('BloomMembershipRule', () => {
	it('passes items whose field value was added to the filter', () => {
		const rule = new BloomMembershipRule('accountId', buildFilter(['acct-1', 'acct-2']));

		expect(rule.action({ accountId: 'acct-1' }, rule)).toBe(true);
	});

	it('rejects items whose field value was never added (certain — no false negatives)', () => {
		const filter = buildFilter(['acct-1', 'acct-2']);

		// Precondition: the primitive itself considers this value absent (deterministic).
		expect(filter.test('acct-999')).toBe(false);

		const rule = new BloomMembershipRule('accountId', filter);

		expect(rule.action({ accountId: 'acct-999' }, rule)).toBe(false);
	});

	it('treats a non-primitive field value (object/array) as absent → false', () => {
		const rule = new BloomMembershipRule('tags', buildFilter(['a', 'b']));

		expect(rule.action({ tags: ['a', 'b']}, rule)).toBe(false);
		expect(rule.action({ tags: { nested: true }}, rule)).toBe(false);
	});

	it('treats a null/undefined field value as absent (false), never probing the filter', () => {
		const rule = new BloomMembershipRule('accountId', buildFilter(['acct-1']));

		expect(rule.action({ accountId: null }, rule)).toBe(false);
		expect(rule.action({}, rule)).toBe(false);
	});

	it('coerces non-string values with String(value) before probing', () => {
		// Filter keyed with the SAME String(...) form the rule probes with.
		const filter = buildFilter([String(42)]);

		expect(filter.test(String(7))).toBe(false);

		const rule = new BloomMembershipRule('id', filter);

		expect(rule.action({ id: 42 }, rule)).toBe(true);
		expect(rule.action({ id: 7 }, rule)).toBe(false);
	});

	describe('serialize', () => {
		it('serializes the filter to its bitset config, with type and field', () => {
			const rule = new BloomMembershipRule('accountId', buildFilter(['acct-1']));
			const serialized = rule.serialize();

			expect(serialized.type).toBe('BloomMembershipRule');
			expect(serialized.field).toBe('accountId');
			expect(Object.keys(serialized.config as object)).toEqual([
				'bits',
				'hashCount',
				'itemCount',
				'sizeBits',
			]);
		});

		it('normalizes a function field to the <function> placeholder', () => {
			const rule = new BloomMembershipRule(
				(item) => (item as { accountId: string }).accountId,
				buildFilter(['acct-1']),
			);

			expect(rule.serialize().field).toBe('<function>');
		});
	});

	describe('deserialize', () => {
		it('round-trips serialize → deserialize preserving membership behavior', () => {
			const original = new BloomMembershipRule('accountId', buildFilter(['acct-1', 'acct-2']));
			const restored = BloomMembershipRule.deserialize(original.serialize());

			expect(restored.action({ accountId: 'acct-1' }, restored)).toBe(true);
			expect(restored.action({ accountId: 'acct-2' }, restored)).toBe(true);
			expect(restored.action({ accountId: 'acct-999' }, restored)).toBe(false);
		});

		it('restores a <function> field placeholder to undefined (item-as-value)', () => {
			const serialized = new BloomMembershipRule(
				(item) => (item as { id: string }).id,
				buildFilter(['solo']),
			).serialize();
			const restored = BloomMembershipRule.deserialize(serialized);

			expect(restored.field).toBeUndefined();
			// With an undefined field the item itself is the value; 'solo' was added.
			expect(restored.action('solo', restored)).toBe(true);
		});

		it('throws when config is null', () => {
			expect(() =>
				BloomMembershipRule.deserialize({ config: null, field: 'id', type: 'BloomMembershipRule' }),
			).toThrow(/expected config of shape/u);
		});

		it('throws when config is not an object', () => {
			expect(() =>
				BloomMembershipRule.deserialize({ config: 'nope', field: 'id', type: 'BloomMembershipRule' }),
			).toThrow(/expected config of shape/u);
		});

		it('throws when config.bits is not a string', () => {
			expect(() =>
				BloomMembershipRule.deserialize({
					config: { hashCount: 3, itemCount: 0, sizeBits: 64 },
					field: 'id',
					type: 'BloomMembershipRule',
				}),
			).toThrow(/expected config of shape/u);
		});

		it('throws when config.hashCount is not a number', () => {
			expect(() =>
				BloomMembershipRule.deserialize({
					config: { bits: 'AAAAAAAA', hashCount: 'x', itemCount: 0, sizeBits: 64 },
					field: 'id',
					type: 'BloomMembershipRule',
				}),
			).toThrow(/expected config of shape/u);
		});

		it('throws when config.sizeBits is not a number', () => {
			expect(() =>
				BloomMembershipRule.deserialize({
					config: { bits: 'AAAAAAAA', hashCount: 3, itemCount: 0, sizeBits: 'x' },
					field: 'id',
					type: 'BloomMembershipRule',
				}),
			).toThrow(/expected config of shape/u);
		});
	});

	it('round-trips through the rule registry (static-hook routing)', () => {
		const original = new BloomMembershipRule('accountId', buildFilter(['acct-1']));
		const restored = ruleRegistry.deserialize(original.serialize());

		expect(restored).toBeInstanceOf(BloomMembershipRule);
		expect(restored.action({ accountId: 'acct-1' }, restored)).toBe(true);
	});

	it('bloomMembership factory returns a configured rule', () => {
		const rule = bloomMembership('accountId', buildFilter(['acct-1']));

		expect(rule).toBeInstanceOf(BloomMembershipRule);
		expect(rule.action({ accountId: 'acct-1' }, rule)).toBe(true);
	});
});
