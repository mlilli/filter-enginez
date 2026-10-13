/**
 * Tests for `TextSearchRule` — the zero-dep, mode-switched string-match rule.
 *
 * @remarks
 * Exercises every `mode` branch (exact / substring / startsWith / endsWith / tokenized / allWords),
 * both the case-sensitive and case-insensitive paths, the empty-query no-op, the non-string-field
 * fail, the tokenized whitespace-split (including empty-token filtering), and the whole-word
 * `allWords` semantics (word-not-substring, plus the punctuation-only no-op). The inherited
 * `serialize()` shape is asserted for completeness.
 */

import { describe, expect, it } from 'vitest';

import { TextSearchRule } from './TextSearchRule.js';

describe('TextSearchRule', () => {
	it('matches in substring mode (case-insensitive by default)', () => {
		const rule = new TextSearchRule('title', { mode: 'substring', query: 'PINOT' });

		expect(rule.action({ title: 'Domaine Pinot Noir' }, rule)).toBe(true);
		expect(rule.action({ title: 'Cabernet Sauvignon' }, rule)).toBe(false);
	});

	it('respects caseSensitive when set', () => {
		const rule = new TextSearchRule('title', {
			caseSensitive: true,
			mode: 'substring',
			query: 'Pinot',
		});

		expect(rule.action({ title: 'Domaine Pinot Noir' }, rule)).toBe(true);
		expect(rule.action({ title: 'domaine pinot noir' }, rule)).toBe(false);
	});

	it('matches in exact mode only on a full-string equality', () => {
		const rule = new TextSearchRule('title', { mode: 'exact', query: 'red' });

		expect(rule.action({ title: 'Red' }, rule)).toBe(true);
		expect(rule.action({ title: 'Red Wine' }, rule)).toBe(false);
	});

	it('matches in startsWith mode', () => {
		const rule = new TextSearchRule('sku', { mode: 'startsWith', query: 'cv1f' });

		expect(rule.action({ sku: 'CV1F-0099' }, rule)).toBe(true);
		expect(rule.action({ sku: 'AB1F-0099' }, rule)).toBe(false);
	});

	it('matches in endsWith mode', () => {
		const rule = new TextSearchRule('file', { mode: 'endsWith', query: '.pdf' });

		expect(rule.action({ file: 'report.pdf' }, rule)).toBe(true);
		expect(rule.action({ file: 'report.txt' }, rule)).toBe(false);
	});

	it('requires ALL tokens to appear in tokenized mode', () => {
		const rule = new TextSearchRule('notes', { mode: 'tokenized', query: 'oak leather' });

		expect(rule.action({ notes: 'aged oak with a leather finish' }, rule)).toBe(true);
		expect(rule.action({ notes: 'just oak here' }, rule)).toBe(false);
	});

	it('drops empty tokens from extra whitespace in tokenized mode', () => {
		const rule = new TextSearchRule('notes', { mode: 'tokenized', query: '  oak   leather  ' });

		expect(rule.action({ notes: 'oak and leather' }, rule)).toBe(true);
	});

	it('matches whole words only in allWords mode (not substrings)', () => {
		const rule = new TextSearchRule('notes', { mode: 'allWords', query: 'oak leather' });

		// both present as whole words
		expect(rule.action({ notes: 'aged oak with a leather finish' }, rule)).toBe(true);
		// 'leather' appears only inside 'leathery' — a substring, not a whole word
		expect(rule.action({ notes: 'aged oak with a leathery note' }, rule)).toBe(false);
	});

	it('rejects a query word that appears only as a substring in allWords mode', () => {
		const rule = new TextSearchRule('notes', { mode: 'allWords', query: 'oak' });

		expect(rule.action({ notes: 'oakwood barrel' }, rule)).toBe(false);
		expect(rule.action({ notes: 'oak barrel' }, rule)).toBe(true);
	});

	it('treats a punctuation-only query as a no-op in allWords mode', () => {
		const rule = new TextSearchRule('notes', { mode: 'allWords', query: '!!! ...' });

		expect(rule.action({ notes: 'anything at all' }, rule)).toBe(true);
	});

	it('treats an empty query as a no-op that matches any string field', () => {
		const rule = new TextSearchRule('title', { mode: 'exact', query: '' });

		expect(rule.action({ title: 'anything at all' }, rule)).toBe(true);
	});

	it('fails when the field value is not a string', () => {
		const rule = new TextSearchRule('count', { mode: 'substring', query: 'x' });

		expect(rule.action({ count: 42 }, rule)).toBe(false);
	});

	it('fails when the field is missing entirely', () => {
		const rule = new TextSearchRule('title', { mode: 'substring', query: 'x' });

		expect(rule.action({}, rule)).toBe(false);
	});

	it('serializes to the inherited JSON shape', () => {
		const rule = new TextSearchRule('title', { mode: 'substring', query: 'pinot' });

		expect(rule.serialize()).toEqual({
			config: { mode: 'substring', query: 'pinot' },
			field: 'title',
			type: 'TextSearchRule',
		});
	});
});
