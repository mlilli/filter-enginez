/**
 * Shared text tokenization helpers — the single source of truth for how `TextSearchRule` (and any
 * text-acceleration index built to pre-filter for it) splits strings into words.
 *
 * @remarks
 * Centralized deliberately: any structure that pre-screens or pre-filters text matches must tokenize
 * with the EXACT same definition the rule's exact confirm uses, or it would silently drop real
 * matches (a false negative — forbidden). Keeping the tokenizer in one module makes that agreement
 * structural rather than a convention two files hope to honor.
 *
 * A "word" is a maximal run of Unicode letters or numbers, so accented terms (`Vulkà`, `Château`)
 * stay intact while punctuation and whitespace separate tokens, and hyphenated compounds (`oak-aged`)
 * split on the hyphen. These helpers do NOT change case — the caller normalizes first (e.g. lowercase
 * for case-insensitive matching) so both the rule and the index can apply identical normalization.
 *
 * @packageDocumentation
 */

/** Matches a maximal run of Unicode letters or numbers — one "word". */
const WORD_PATTERN = /[\p{L}\p{N}]+/gu;

/**
 * Split text into words — maximal runs of Unicode letters/numbers. Punctuation and whitespace are
 * separators; case is preserved (normalize before calling if case-insensitivity is desired).
 *
 * @param text - The string to tokenize
 * @returns The words in order of appearance (empty array when the string has no word characters)
 */
export function extractWords(text: string): readonly string[] {
	return text.match(WORD_PATTERN) ?? [];
}

/**
 * Split text into its overlapping character trigrams via a sliding window (no padding).
 *
 * @remarks
 * **No padding / sentinels** — a fuzzy or substring match can occur at any offset inside the field,
 * so a boundary trigram like `^oa` would not exist in the haystack interior and would wrongly prune
 * real matches. The window is the raw normalized string (spaces and punctuation included), because
 * cross-word trigrams (e.g. `k l` in `oak leather`) are legitimate substrings a query can span.
 *
 * @param text - The (already normalized) string to shred into trigrams
 * @returns The trigrams in order, with duplicates (fewer than 3 characters → empty array)
 */
export function extractTrigrams(text: string): readonly string[] {
	const trigrams: string[] = [];

	for (let index = 0; index + 3 <= text.length; index++) {
		trigrams.push(text.slice(index, index + 3));
	}

	return trigrams;
}

/**
 * The distinct character trigrams of `text` (see {@link extractTrigrams}) — the form the q-gram
 * count bound and the inverted trigram index are built from.
 *
 * @param text - The (already normalized) string
 * @returns A set of its unique trigrams
 */
export function distinctTrigrams(text: string): ReadonlySet<string> {
	return new Set(extractTrigrams(text));
}


/**
 * Coerce an extracted field value to a string for text matching / indexing — the value unchanged
 * when it is a string, else `undefined` (non-string fields never match a text query and can't be
 * indexed). Shared by `TextSearchRule` / `FuzzySearchRule` and the inverted text index so the
 * definition of "a usable text field value" lives in one place.
 *
 * @param value - The raw extracted field value
 * @returns The string, or `undefined` when `value` is not a string
 */
export function coerceStringField(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}
