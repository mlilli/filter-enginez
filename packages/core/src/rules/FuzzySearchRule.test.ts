/**
 * Tests for `FuzzySearchRule` — the Fuse.js-backed, typo-tolerant search rule.
 *
 * @remarks
 * Covers both evaluation modes (single-field extraction vs multi-`keys` whole-item search),
 * the empty-query no-op, the non-string-field fail, and every branch of the module-level
 * `buildFuseOptions` helper: the default threshold, an explicit threshold, the optional
 * `distance` option (set vs unset), and the optional `keys` option (set vs unset). Fuzzy
 * behavior is asserted at the level the rule guarantees — a close typo matches, a clearly
 * unrelated query does not. The `static deserialize` hook: a `null` `threshold` or `distance` (what
 * JSON writes for `Infinity`) revives as unlimited, an absent option stays absent, a registered
 * subclass revives as itself, and an option that is not a number throws.
 */

// cspell:ignore cabxrnet cabernay -- deliberate typo fixtures exercising fuzzy tolerance

import { describe, expect, it } from 'vitest';

import type { SerializedRule } from '../types.js';

import { FilterEngineRuleError } from '../errors/index.js';
import { FuzzySearchRule } from './FuzzySearchRule.js';
import { RuleRegistry } from './ruleRegistry.js';

describe('FuzzySearchRule', () => {
	it('matches a close typo against a single string field', () => {
		const rule = new FuzzySearchRule('title', { query: 'cabernay' });

		expect(rule.action({ title: 'cabernet' }, rule)).toBe(true);
	});

	it('does not match a clearly unrelated query', () => {
		const rule = new FuzzySearchRule('title', { query: 'zzzzzz' });

		expect(rule.action({ title: 'cabernet' }, rule)).toBe(false);
	});

	it('treats an empty query as a no-op that matches any item', () => {
		const rule = new FuzzySearchRule('title', { query: '' });

		expect(rule.action({ title: 'cabernet' }, rule)).toBe(true);
		// Empty query short-circuits before field extraction, so even a non-string passes.
		expect(rule.action({ title: 42 }, rule)).toBe(true);
	});

	it('fails when the single-field value is not a string', () => {
		const rule = new FuzzySearchRule('count', { query: 'cabernet' });

		expect(rule.action({ count: 42 }, rule)).toBe(false);
	});

	it('searches across multiple keys when keys are configured', () => {
		const rule = new FuzzySearchRule(undefined, {
			keys: ['varietal', 'region'],
			query: 'cabernay',
		});

		expect(rule.action({ region: 'Napa', varietal: 'cabernet' }, rule)).toBe(true);
		expect(rule.action({ region: 'Napa', varietal: 'merlot' }, rule)).toBe(false);
	});

	it('treats an empty keys array as single-field mode (falls through to the extractor)', () => {
		const rule = new FuzzySearchRule('title', { keys: [], query: 'cabernay' });

		expect(rule.action({ title: 'cabernet' }, rule)).toBe(true);
	});

	it('honors a stricter explicit threshold to reject a loose match', () => {
		const loose = new FuzzySearchRule('title', { query: 'cabxrnet', threshold: 0.6 });
		const strict = new FuzzySearchRule('title', { query: 'cabxrnet', threshold: 0.1 });

		expect(loose.action({ title: 'cabernet' }, loose)).toBe(true);
		expect(strict.action({ title: 'cabernet' }, strict)).toBe(false);
	});

	it('passes through the distance option when supplied', () => {
		const rule = new FuzzySearchRule('title', { distance: 100, query: 'cabernay' });

		expect(rule.action({ title: 'cabernet' }, rule)).toBe(true);
	});

	it('serializes to the inherited JSON shape', () => {
		const rule = new FuzzySearchRule('title', { query: 'cabernay', threshold: 0.4 });

		expect(rule.serialize()).toEqual({
			config: { query: 'cabernay', threshold: 0.4 },
			field: 'title',
			type: 'FuzzySearchRule',
		});
	});

	describe('deserialize', () => {
		it('revives null threshold and distance — what JSON writes for Infinity — as unlimited', () => {
			const original = new FuzzySearchRule('title', {
				distance: Number.POSITIVE_INFINITY,
				query: 'cabernay',
				threshold: Number.POSITIVE_INFINITY,
			});
			const rule = FuzzySearchRule.deserialize(JSON.parse(JSON.stringify(original.serialize())) as SerializedRule);

			expect(rule.config).toEqual({ distance: Number.POSITIVE_INFINITY, query: 'cabernay', threshold: Number.POSITIVE_INFINITY });
		});

		it('matches through JSON what the original matches with an unlimited distance', () => {
			const original = new FuzzySearchRule('title', { distance: Number.POSITIVE_INFINITY, query: 'cabernay' });
			const rule = FuzzySearchRule.deserialize(JSON.parse(JSON.stringify(original.serialize())) as SerializedRule);
			const farMatch = { title: 'pinot noir from somewhere far away cabernay' };

			expect(original.action(farMatch, original)).toBe(true);
			expect(rule.action(farMatch, rule)).toBe(true);
		});

		it('leaves absent options absent, so the defaults apply', () => {
			const rule = FuzzySearchRule.deserialize({ config: { query: 'merlot' }, field: 'title', type: 'FuzzySearchRule' });

			expect(rule.config).toEqual({ query: 'merlot' });
		});

		it('revives as the class registered under its name, so a replacing subclass revives as itself', () => {
			/** A subclass registered in place of the built-in. */
			class AuditedSearch extends FuzzySearchRule {
				readonly isAudited = true;
			}
			const registry = new RuleRegistry();

			registry.unregister('FuzzySearchRule');
			registry.register('FuzzySearchRule', AuditedSearch);

			expect(registry.deserialize({ config: { query: 'a' }, field: 'title', type: 'FuzzySearchRule' })).toBeInstanceOf(AuditedSearch);
		});

		it.each([
			[{ distance: '100', query: 'a' }, 'FuzzySearchRule config.distance must be a number, or null for an open bound; got "100".'],
			[{ query: 'a', threshold: Number.NaN }, 'FuzzySearchRule config.threshold must be a number, or null for an open bound; got NaN.'],
		])('rejects the config %o', (config, message) => {
			expect(() => FuzzySearchRule.deserialize({ config, field: 'title', type: 'FuzzySearchRule' })).toThrowError(FilterEngineRuleError);
			expect(() => FuzzySearchRule.deserialize({ config, field: 'title', type: 'FuzzySearchRule' })).toThrowError(message);
		});
	});
});
