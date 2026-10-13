/**
 * Tests for `RegexRule` — regex match against a string field, with a custom serialize/deserialize
 * round-trip for the non-JSON-safe `RegExp`.
 *
 * @remarks
 * Covers the `action` (match / non-match / non-string fail), the overridden `serialize()` shape
 * (`{ source, flags }` plus the function-field `'<function>'` placeholder branch), and every
 * branch of the static `deserialize` (valid config, each invalid-config guard, the missing-flags
 * fallback to `''`, and the `'<function>'` → `undefined` field branch). A full round-trip asserts
 * the reconstructed pattern preserves source + flags and behaves identically.
 */

import { describe, expect, it } from 'vitest';

import { RegexRule } from './RegexRule.js';

describe('RegexRule', () => {
	it('passes items whose string field matches the pattern', () => {
		const rule = new RegexRule('sku', { pattern: /^CV1F/ });

		expect(rule.action({ sku: 'CV1F-0099' }, rule)).toBe(true);
		expect(rule.action({ sku: 'AB1F-0099' }, rule)).toBe(false);
	});

	it('fails when the field value is not a string', () => {
		const rule = new RegexRule('sku', { pattern: /^CV1F/ });

		expect(rule.action({ sku: 1234 }, rule)).toBe(false);
	});

	describe('serialize', () => {
		it('serializes the pattern to its { source, flags } form', () => {
			const rule = new RegexRule('sku', { pattern: /^cv1f/gi });

			expect(rule.serialize()).toEqual({
				config: { flags: 'gi', source: '^cv1f' },
				field: 'sku',
				type: 'RegexRule',
			});
		});

		it('normalizes a function field to the <function> placeholder', () => {
			const rule = new RegexRule((item) => (item as { sku: string }).sku, {
				pattern: /^CV1F/,
			});

			expect(rule.serialize().field).toBe('<function>');
		});
	});

	describe('deserialize', () => {
		it('reconstructs a working RegExp from { source, flags }', () => {
			const restored = RegexRule.deserialize({
				config: { flags: 'i', source: '^cv1f' },
				field: 'sku',
				type: 'RegexRule',
			});

			expect(restored.config.pattern.source).toBe('^cv1f');
			expect(restored.config.pattern.flags).toBe('i');
			expect(restored.action({ sku: 'CV1F-1' }, restored)).toBe(true);
		});

		it('defaults flags to an empty string when none are present', () => {
			const restored = RegexRule.deserialize({
				config: { source: '^cv1f' },
				field: 'sku',
				type: 'RegexRule',
			});

			expect(restored.config.pattern.flags).toBe('');
		});

		it('restores a <function> field placeholder to undefined (item-as-value)', () => {
			const restored = RegexRule.deserialize({
				config: { flags: '', source: 'abc' },
				field: '<function>',
				type: 'RegexRule',
			});

			expect(restored.field).toBeUndefined();
			expect(restored.action('abc', restored)).toBe(true);
		});

		it('throws when config is null', () => {
			expect(() =>
				RegexRule.deserialize({ config: null, field: 'sku', type: 'RegexRule' }),
			).toThrow(/expected config of shape \{ source, flags \}/);
		});

		it('throws when config is not an object', () => {
			expect(() =>
				RegexRule.deserialize({ config: 'nope', field: 'sku', type: 'RegexRule' }),
			).toThrow(/expected config of shape \{ source, flags \}/);
		});

		it('throws when config.source is not a string', () => {
			expect(() =>
				RegexRule.deserialize({ config: { source: 42 }, field: 'sku', type: 'RegexRule' }),
			).toThrow(/expected config of shape \{ source, flags \}/);
		});
	});

	it('round-trips serialize → deserialize preserving behavior', () => {
		const original = new RegexRule('sku', { pattern: /^cv1f-\d+$/i });
		const restored = RegexRule.deserialize(original.serialize());

		expect(restored.config.pattern.source).toBe(original.config.pattern.source);
		expect(restored.config.pattern.flags).toBe(original.config.pattern.flags);
		expect(restored.action({ sku: 'CV1F-42' }, restored)).toBe(true);
	});

	it('matches every item from the start even with a global or sticky pattern', () => {
		for (const pattern of [/^ab/gu, /ab/yu]) {
			const rule = new RegexRule('code', { pattern });
			const items = [{ code: 'abc' }, { code: 'abd' }, { code: 'abe' }];

			expect(items.map((item) => rule.action(item, rule))).toEqual([true, true, true]);
		}
	});
});
