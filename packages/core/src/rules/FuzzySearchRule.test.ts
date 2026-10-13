/**
 * Tests for `FuzzySearchRule` — the Fuse.js-backed, typo-tolerant search rule.
 *
 * @remarks
 * Covers both evaluation modes (single-field extraction vs multi-`keys` whole-item search),
 * the empty-query no-op, the non-string-field fail, and every branch of the module-level
 * `buildFuseOptions` helper: the default threshold, an explicit threshold, the optional
 * `distance` option (set vs unset), and the optional `keys` option (set vs unset). Fuzzy
 * behavior is asserted at the level the rule guarantees — a close typo matches, a clearly
 * unrelated query does not.
 */

// cspell:ignore cabxrnet cabernay -- deliberate typo fixtures exercising fuzzy tolerance

import { describe, expect, it } from 'vitest';

import { FuzzySearchRule } from './FuzzySearchRule.js';

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
});
