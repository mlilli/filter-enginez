/**
 * `TextSearchRule` — string match in one of several modes: exact, substring, startsWith,
 * endsWith, tokenized, allWords.
 *
 * @remarks
 * The zero-dep workhorse for "search box" filter UIs. For fuzzy / typo-tolerant search, use
 * `FuzzySearchRule` (which wraps Fuse.js).
 *
 * Empty query is treated as a no-op (matches every item with a string field). Non-string
 * field values always fail.
 *
 * Matching is case-insensitive by default (`toLowerCase()` on both sides). `locale` folds case by
 * that language's rules instead (`toLocaleLowerCase(locale)`: under `'tr'`, `'I'` lowercases to the
 * dotless `'ı'`), and `diacritics: 'ignore'` strips accents from both sides, so `'Cafe'` finds
 * `'Café'`. Both apply in every mode, through `lib/textFold`, the same fold the inverted word index
 * builds its postings with, so an indexed `'allWords'` search and the predicate scan agree.
 *
 * @packageDocumentation
 */

import type { FilterEngineRuleError } from '../errors/index.js';
import type { FieldExtractor, FilterRuleAction, SerializedRule } from '../types.js';

import { foldText, type TextFold } from '../lib/textFold.js';
import { coerceStringField, extractWords } from '../lib/textTokens.js';
import { FilterRule } from './FilterRule.js';
import { invalidConfig, invalidRuleConfig, readRecord, revivedField } from './serializedConfig.js';

// #region docs:text-search-config
/**
 * The six supported text-search modes.
 *
 * - `'exact'` — entire string equals the query
 * - `'substring'` — query appears anywhere in the string
 * - `'startsWith'` — string begins with the query
 * - `'endsWith'` — string ends with the query
 * - `'tokenized'` — query is split on whitespace; ALL tokens must appear as SUBSTRINGS
 * - `'allWords'` — query is split into words; ALL query words must appear as WHOLE WORDS (a word
 *   being a maximal run of Unicode letters/numbers, per `lib/textTokens`). Unlike `'tokenized'`,
 *   `'oak'` matches the whole word `oak` but NOT a substring like `oakwood`. This is the mode the
 *   inverted word index accelerates (an exact AND of word postings).
 */
export type TextSearchMode = 'allWords' | 'endsWith' | 'exact' | 'startsWith' | 'substring' | 'tokenized';

/**
 * Configuration for `TextSearchRule`.
 *
 * - `diacritics` — `'ignore'` strips accents from both sides before comparing (`'Cafe'` finds
 *   `'Café'`, `'Zoe'` finds `'Zoë'`); `'match'` (the default) compares them as written
 * - `locale` — a BCP 47 tag whose case rules fold case (`toLocaleLowerCase`), e.g. `'tr'` for Turkish
 *   dotted and dotless I; without it case folds by `toLowerCase()`. Unused when `caseSensitive`.
 */
export interface TextSearchRuleConfig {
	readonly caseSensitive?: boolean;
	readonly diacritics?: 'ignore' | 'match';
	readonly locale?: string;
	readonly mode: TextSearchMode;
	readonly query: string;
}
// #endregion docs:text-search-config

/**
 * Filter items by string match in a configurable mode.
 *
 * @example
 *   // Items whose title contains 'pinot' (case-insensitive):
 *   engine.addRule(
 *     'title-search',
 *     new TextSearchRule('title', { query: 'pinot', mode: 'substring' }),
 *   );
 *
 *   // Items whose description contains BOTH 'oak' AND 'leather' (as substrings):
 *   engine.addRule(
 *     'tasting-notes',
 *     new TextSearchRule('description', { query: 'oak leather', mode: 'tokenized' }),
 *   );
 *
 *   // Items whose description contains the WHOLE WORDS 'oak' and 'leather' (not substrings):
 *   engine.addRule(
 *     'whole-words',
 *     new TextSearchRule('description', { mode: 'allWords', query: 'oak leather' }),
 *   );
 */
export class TextSearchRule extends FilterRule {
	/**
	 * Minifier-proof wire name — see {@link FilterRule.ruleTypeName}. Declared as a literal so
	 * `ruleRegistry.register` can reject a key that disagrees with it at compile time.
	 */
	static override readonly ruleTypeName = 'TextSearchRule';

	override action: FilterRuleAction = (item, rule): boolean => {
		const fieldValue = this.getFieldValue(item);

		if (typeof fieldValue !== 'string') {
			return false;
		}
		const { config } = rule as TextSearchRule;
		const { mode, query } = config;

		if (query.length === 0) {
			return true;
		}
		const fold = textFoldOf(config);
		const haystack = foldText(fieldValue, fold);
		const needle = foldText(query, fold);

		switch (mode) {
			case 'allWords': {
				const queryWords = extractWords(needle);

				if (queryWords.length === 0) {
					return true;
				}
				const haystackWords = new Set(extractWords(haystack));

				return queryWords.every((word) => haystackWords.has(word));
			}
			case 'endsWith':
				return haystack.endsWith(needle);
			case 'exact':
				return haystack === needle;
			case 'startsWith':
				return haystack.startsWith(needle);
			case 'substring':
				return haystack.includes(needle);
			case 'tokenized': {
				const tokens = needle.split(/\s+/).filter((token) => token.length > 0);

				return tokens.every((token) => haystack.includes(token));
			}
		}
	};

	config: TextSearchRuleConfig;

	/**
	 * @param field - The field holding the text
	 * @param config - The query, mode, and case and accent options
	 * @throws `FilterEngineRuleError` with code `RULE_INVALID_CONFIG` when `diacritics` is neither
	 *   `'ignore'` nor `'match'`, or `locale` is not a well-formed BCP 47 tag
	 */
	constructor(field: FieldExtractor, config: TextSearchRuleConfig) {
		super(field);
		checkFoldOptions(config, invalidRuleConfig);
		this.config = config;
	}

	/**
	 * Reconstruct a `TextSearchRule` from its serialized form, checking its case and accent options
	 * first. A hook rather than the registry's generic path, which retries a constructor that throws
	 * with the field alone and so would turn a bad option into a rule with no config.
	 *
	 * @param json - The serialized rule (must be a `TextSearchRule` shape)
	 * @returns The revived rule
	 * @throws `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG` when `config` is not
	 *   an object, `diacritics` is neither `'ignore'` nor `'match'`, or `locale` is not a well-formed
	 *   BCP 47 tag
	 */
	static deserialize(json: SerializedRule): TextSearchRule {
		const config = readRecord(json.config, 'TextSearchRule config');

		checkFoldOptions(config, invalidConfig);

		return new TextSearchRule(revivedField(json), config as unknown as TextSearchRuleConfig);
	}

	/**
	 * Extract the item's field value as a string for the inverted text index — mirrors `action`'s
	 * string-field handling (non-string fields yield `undefined`). Public so the engine's
	 * `TextInvertedIndex` resolves fields identically to the predicate.
	 */
	extractText(item: unknown): string | undefined {
		return coerceStringField(this.getFieldValue(item));
	}
}

/**
 * The fold a config compares with: its case and accent options with their defaults filled in.
 *
 * @param config - The rule's config
 * @returns The fold for `foldText` and the word index
 */
export function textFoldOf(config: TextSearchRuleConfig): TextFold {
	return {
		caseSensitive: config.caseSensitive === true,
		diacritics: config.diacritics ?? 'match',
		locale: config.locale,
	};
}

/**
 * Check the case and accent options, throwing through `makeError` (the constructor's code, or the
 * payload's when `deserialize` checks first).
 *
 * @param config - The config, typed or as it arrived
 * @param makeError - Builds the error for one failed key
 */
function checkFoldOptions(
	config: Readonly<Record<string, unknown>> | TextSearchRuleConfig,
	makeError: (where: string, expected: string, value: unknown) => FilterEngineRuleError,
): void {
	const { diacritics, locale } = config as { diacritics?: unknown; locale?: unknown; };

	if (diacritics !== undefined && diacritics !== 'ignore' && diacritics !== 'match') {
		throw makeError('TextSearchRule config.diacritics', '\'ignore\', \'match\', or absent', diacritics);
	}
	if (locale !== undefined && !isLocaleTag(locale)) {
		throw makeError('TextSearchRule config.locale', 'a BCP 47 language tag, or absent', locale);
	}
}

/**
 * Whether `value` is a language tag `toLocaleLowerCase` accepts.
 *
 * @param value - Anything
 * @returns `true` for a well-formed BCP 47 tag
 */
function isLocaleTag(value: unknown): boolean {
	if (typeof value !== 'string') {
		return false;
	}
	try {
		Intl.getCanonicalLocales(value);

		return true;
	} catch {
		return false;
	}
}
