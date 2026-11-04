/**
 * `TextIndexCache` — the `TextInvertedIndex`es one `BitmapIndex` keeps: one per text field and fold.
 *
 * @remarks
 * Keyed by the text rule's `field` extractor (NOT the rule) and then by its fold (`textFoldKey`) —
 * the spatial cache's rationale: postings are a pure function of (source data, field, fold), so all
 * text rules on one field that fold text alike share an index, and a query change never rebuilds
 * it. Fuzzy rules and plain `'allWords'` rules share the default fold; a `TextSearchRule` with
 * `diacritics` or `locale` gets an index of its own, built on first use. Each index self-invalidates
 * on a source-data version bump; `clear()` drops them all.
 *
 * @packageDocumentation
 */

import type { FuzzySearchRule } from '../rules/FuzzySearchRule.js';
import type { TextSearchRule } from '../rules/TextSearchRule.js';
import type { InternalStore } from '../store/InternalStore.js';
import type { FieldExtractor } from '../types.js';

import { type TextFold, textFoldKey } from '../lib/textFold.js';
import { TextInvertedIndex } from './TextInvertedIndex.js';

/**
 * The text indexes of one `BitmapIndex`, by field and fold.
 *
 * @typeParam T - The source-data item type
 */
export class TextIndexCache<T> {
	private readonly _byField = new Map<FieldExtractor, Map<string, TextInvertedIndex<T>>>();

	/**
	 * The index for a rule's field and a fold, built (empty, its postings still lazy) on first ask.
	 *
	 * @param store - The engine's store the index reads
	 * @param rule - The text rule; its field extractor keys the index and extracts the text
	 * @param fold - How the index normalizes field text
	 * @returns The shared index
	 */
	get(store: InternalStore<T>, rule: FuzzySearchRule | TextSearchRule, fold: TextFold): TextInvertedIndex<T> {
		let byFold = this._byField.get(rule.field);

		if (byFold === undefined) {
			byFold = new Map();
			this._byField.set(rule.field, byFold);
		}
		const key = textFoldKey(fold);
		let index = byFold.get(key);

		if (index === undefined) {
			index = new TextInvertedIndex<T>(store, (item) => rule.extractText(item), fold);
			byFold.set(key, index);
		}

		return index;
	}

	/** Drop every index (on source-data change / reset). */
	clear(): void {
		this._byField.clear();
	}
}
