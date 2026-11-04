/**
 * Tests for `TextSearchRule`'s `diacritics` and `locale` options, and the checks on them.
 *
 * @remarks
 * Each of the six modes runs against a mixed string (accents, case, Turkish letters) with accents
 * ignored and matched; "Cafe" / "Café" and "Zoe" / "Zoë" match from either side; Turkish `'ı'` /
 * `'I'` and `'İ'` / `'i'` fold by `'tr'` and not without it; a case-sensitive rule strips accents and
 * ignores `locale`. The constructor rejects a bad option with `RULE_INVALID_CONFIG`, the `deserialize`
 * hook with `RULE_INVALID_SERIALIZED_CONFIG`, and both options survive the registry round trip. The
 * indexed `'allWords'` path is held to the predicate in `../internals/BitmapIndex.text.test.ts`.
 */

// cspell:ignore ISPARTA ısparta İstanbul ıspa
import { describe, expect, it } from 'vitest';

import { FilterEngineRuleError } from '../errors/index.js';
import { ruleRegistry } from './ruleRegistry.js';
import { type TextSearchMode, TextSearchRule, type TextSearchRuleConfig } from './TextSearchRule.js';

/** Test one value against a rule over `name`. */
function matches(config: TextSearchRuleConfig, value: unknown): boolean {
	const rule = new TextSearchRule('name', config);

	return rule.action({ name: value }, rule);
}

/** The error a call throws, for asserting its class, code and message together. */
function caught(call: () => unknown): unknown {
	try {
		call();
	} catch (error) {
		return error;
	}

	throw new Error('expected the call to throw');
}

const MIXED = 'Crème Brûlée at Café Zoë';

describe('TextSearchRule diacritics', () => {
	it.each([
		['exact', 'creme brulee at cafe zoe'],
		['substring', 'brulee at cafe'],
		['startsWith', 'CREME'],
		['endsWith', 'cafe zoe'],
		['tokenized', 'cafe creme'],
		['allWords', 'zoe cafe brulee'],
	] as const)('%s mode matches an accented string with diacritics ignore, and not with match', (mode: TextSearchMode, query) => {
		expect(matches({ diacritics: 'ignore', mode, query }, MIXED)).toBe(true);
		expect(matches({ diacritics: 'match', mode, query }, MIXED)).toBe(false);
		expect(matches({ mode, query }, MIXED)).toBe(false);
	});

	it.each([
		['Cafe', 'Café'],
		['Café', 'Cafe'],
		['Zoe', 'Zoë'],
		['Zoë', 'Zoe'],
		['cafe', 'Café'],
	])('finds %j in %j with diacritics ignore', (query, value) => {
		expect(matches({ diacritics: 'ignore', mode: 'exact', query }, value)).toBe(true);
		expect(matches({ mode: 'exact', query }, value)).toBe(false);
	});

	it('strips accents in a case-sensitive rule and still compares case', () => {
		expect(matches({ caseSensitive: true, diacritics: 'ignore', mode: 'exact', query: 'Cafe' }, 'Café')).toBe(true);
		expect(matches({ caseSensitive: true, diacritics: 'ignore', mode: 'exact', query: 'cafe' }, 'Café')).toBe(false);
	});
});

describe('TextSearchRule locale', () => {
	it('matches dotless ı against I under tr, and not without it', () => {
		expect(matches({ locale: 'tr', mode: 'exact', query: 'ısparta' }, 'ISPARTA')).toBe(true);
		expect(matches({ mode: 'exact', query: 'ısparta' }, 'ISPARTA')).toBe(false);
	});

	it('matches dotted i against İ under tr, where toLowerCase leaves a combining dot', () => {
		expect(matches({ locale: 'tr', mode: 'startsWith', query: 'istanbul' }, 'İstanbul')).toBe(true);
		expect(matches({ mode: 'startsWith', query: 'istanbul' }, 'İstanbul')).toBe(false);
	});

	it.each([
		['exact', 'ısparta istanbul'],
		['substring', 'ta ist'],
		['startsWith', 'ıspa'],
		['endsWith', 'bul'],
		['tokenized', 'istanbul ısparta'],
		['allWords', 'istanbul ısparta'],
	] as const)('folds by tr in %s mode', (mode: TextSearchMode, query) => {
		expect(matches({ locale: 'tr', mode, query }, 'ISPARTA İstanbul')).toBe(true);
	});

	it('ignores locale in a case-sensitive rule', () => {
		expect(matches({ caseSensitive: true, locale: 'tr', mode: 'exact', query: 'ISPARTA' }, 'ISPARTA')).toBe(true);
		expect(matches({ caseSensitive: true, locale: 'tr', mode: 'exact', query: 'ısparta' }, 'ISPARTA')).toBe(false);
	});
});

describe('TextSearchRule option checks', () => {
	it.each([
		[{ diacritics: 'strip' }, 'TextSearchRule config.diacritics must be \'ignore\', \'match\', or absent; got "strip".'],
		[{ locale: 'not a locale!' }, 'TextSearchRule config.locale must be a BCP 47 language tag, or absent; got "not a locale!".'],
		[{ locale: '' }, 'TextSearchRule config.locale must be a BCP 47 language tag, or absent; got "".'],
		[{ locale: 42 }, 'TextSearchRule config.locale must be a BCP 47 language tag, or absent; got 42.'],
	])('the constructor rejects %o with RULE_INVALID_CONFIG', (options, message) => {
		const error = caught(() => new TextSearchRule('name', { mode: 'exact', query: 'a', ...options } as unknown as TextSearchRuleConfig));

		expect(error).toBeInstanceOf(FilterEngineRuleError);
		expect(error).toMatchObject({ code: 'RULE_INVALID_CONFIG' });
		expect((error as Error).message).toBe(message);
	});

	it.each([['tr'], ['en-US'], ['de']])('accepts the locale %j', (locale) => {
		expect(new TextSearchRule('name', { locale, mode: 'exact', query: 'a' }).config.locale).toBe(locale);
	});

	it.each([
		[{ diacritics: 'strip', mode: 'exact', query: 'a' }, 'TextSearchRule config.diacritics must be'],
		[{ locale: 'xx-!!', mode: 'exact', query: 'a' }, 'TextSearchRule config.locale must be'],
		['exact', 'TextSearchRule config must be an object'],
	])('deserialize rejects %o with RULE_INVALID_SERIALIZED_CONFIG', (config, message) => {
		const error = caught(() => TextSearchRule.deserialize({ config, field: 'name', type: 'TextSearchRule' }));

		expect(error).toBeInstanceOf(FilterEngineRuleError);
		expect(error).toMatchObject({ code: 'RULE_INVALID_SERIALIZED_CONFIG' });
		expect((error as Error).message).toContain(message);
	});

	it('round-trips both options through the registry', () => {
		const rule = new TextSearchRule('name', { diacritics: 'ignore', locale: 'tr', mode: 'allWords', query: 'İstanbul' });
		const revived = ruleRegistry.deserialize(JSON.parse(JSON.stringify(rule.serialize())) as ReturnType<TextSearchRule['serialize']>);

		expect(revived).toBeInstanceOf(TextSearchRule);
		expect((revived as TextSearchRule).config).toEqual(rule.config);
		expect(revived.action({ name: 'istanbul notes' }, revived)).toBe(true);
	});

	it('revives a function field placeholder as undefined', () => {
		const revived = TextSearchRule.deserialize({ config: { mode: 'exact', query: 'a' }, field: '<function>', type: 'TextSearchRule' });

		expect(revived.field).toBeUndefined();
		expect(revived.action('a', revived)).toBe(true);
	});
});
