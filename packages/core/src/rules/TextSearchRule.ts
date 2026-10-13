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
 * @packageDocumentation
 */

import type { FieldExtractor, FilterRuleAction } from '../types.js';

import { coerceStringField, extractWords } from '../lib/textTokens.js';
import { FilterRule } from './FilterRule.js';

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
 */
export interface TextSearchRuleConfig {
	readonly caseSensitive?: boolean;
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
		const { caseSensitive: isCaseSensitive, mode, query } = (rule as TextSearchRule).config;

		if (query.length === 0) {
			return true;
		}
		const haystack = isCaseSensitive ? fieldValue : fieldValue.toLowerCase();
		const needle = isCaseSensitive ? query : query.toLowerCase();

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

	constructor(field: FieldExtractor, config: TextSearchRuleConfig) {
		super(field);
		this.config = config;
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
