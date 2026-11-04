/**
 * `textFold` — the one place a text rule's case and accent options turn into a comparison form, so
 * the predicate and the inverted word index normalize text identically.
 *
 * @remarks
 * Case is folded first, then accents are stripped. The order matters for Turkish: under `tr`,
 * `'İ'.toLocaleLowerCase('tr')` is `'i'`, while stripping first would leave `'I'`, which lowercases
 * to the dotless `'ı'`. Accents are stripped by decomposing to NFD and removing every combining mark
 * (`\p{M}`), so `'Café'` and `'Zoë'` fold to `'cafe'` and `'zoe'` whether the input was composed or
 * not.
 *
 * @packageDocumentation
 */

/**
 * How a text rule compares letters: whether case counts, whether accents count, and which
 * language's case rules fold case.
 */
export interface TextFold {
	readonly caseSensitive: boolean;
	readonly diacritics: 'ignore' | 'match';
	/** A BCP 47 tag for case folding (`toLocaleLowerCase`); `undefined` uses `toLowerCase`. */
	readonly locale: string | undefined;
}

const COMBINING_MARKS = /\p{M}/gu;

/**
 * Fold `text` into the form a {@link TextFold} compares.
 *
 * @param text - The text, from an item's field or a query
 * @param fold - The rule's case and accent options
 * @returns The comparison form: lowercased unless case-sensitive (in `locale`'s rules when one is
 *   given), then stripped of combining marks when accents are ignored
 */
export function foldText(text: string, fold: TextFold): string {
	const cased = fold.caseSensitive
		? text
		: fold.locale === undefined ? text.toLowerCase() : text.toLocaleLowerCase(fold.locale);

	return fold.diacritics === 'ignore' ? cased.normalize('NFD').replace(COMBINING_MARKS, '') : cased;
}

/**
 * A key that two folds share exactly when they fold every text the same way, for caching one word
 * index per fold.
 *
 * @param fold - The fold
 * @returns `'case|accents|locale'`; the default (case-insensitive, accents count, no locale) is
 *   `'i|match|'`
 */
export function textFoldKey(fold: TextFold): string {
	return `${fold.caseSensitive ? 's' : 'i'}|${fold.diacritics}|${fold.locale ?? ''}`;
}

/** The fold of a rule with no case or accent options: case-insensitive, accents count, no locale. */
export const DEFAULT_TEXT_FOLD: TextFold = { caseSensitive: false, diacritics: 'match', locale: undefined };
