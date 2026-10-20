/**
 * `FuzzySearchRule` — typo-tolerant fuzzy text search, backed by Fuse.js.
 *
 * @remarks
 * Wraps Fuse.js for approximate string matching with configurable threshold, edit distance,
 * multi-field support, and the rest of Fuse's serializable options (`./fuseOptions.ts`). For
 * zero-dep exact / substring / startsWith / endsWith / tokenized matching, use `TextSearchRule`
 * instead.
 *
 * **One Fuse index per collection.** Before the engine runs `action` across a collection it calls
 * {@link FuzzySearchRule.prepareForCollection}, which builds one Fuse.js index over that collection
 * (the field's strings in single-field mode, the items themselves with `keys`), searches it once,
 * and records which items matched; `action` then answers each of those items with a lookup. The
 * index is kept per collection and per Fuse configuration, so a new query searches the existing
 * index rather than rebuilding it, and a new collection (`setSourceData`, `setWorkingSet`), a new
 * `field`, or a change to `keys` or any Fuse option builds a new one. An item outside the prepared
 * collection is answered the original way, by a one-item Fuse search, so `action` stays exact for
 * any item it is handed.
 *
 * **Same matches as one item at a time.** Fuse decides whether a record matches from that record
 * alone: the threshold applies to each field's own Bitap score, and the parts of scoring that read
 * the whole collection (the field-length norm, token search's inverse document frequency) only
 * order the matches. Searching the collection therefore returns exactly the items the per-item
 * search accepts, for every option; only the scores differ, and a filter never reads them.
 * `FuzzySearchRule.collection.test.ts` holds the two to the same answer across the options.
 *
 * **Acceleration.** When the bitmap layer engages this rule with `acceleration.textIndex` on, a
 * Roaring inverted **trigram** index (`internals/TextInvertedIndex`) pre-filters candidates via the
 * sound bound in `internals/fuzzyTrigramBound` before `action` confirms the survivors, so no real
 * match is dropped. Default-threshold (0.4) fuzzy, multi-key fuzzy, and the options that change
 * what a query means (`ignoreDiacritics`, `useExtendedSearch`, `useTokenSearch`) bypass the index
 * and go through the collection search.
 *
 * An unlimited `threshold` or `distance` survives JSON: `JSON.stringify` writes `Infinity` as `null`,
 * and {@link FuzzySearchRule.deserialize} reads a `null` option back as `Infinity`.
 *
 * @packageDocumentation
 */

import Fuse from 'fuse.js';

import type { FieldExtractor, FilterRuleAction, SerializedRule } from '../types.js';

import { coerceStringField } from '../lib/textTokens.js';
import { FilterRule } from './FilterRule.js';
import { buildFuseOptions, type FuzzySearchFuseOptions, reviveFuzzyConfig } from './fuseOptions.js';
import { revivedField } from './serializedConfig.js';

/** A constructor with `FuzzySearchRule`'s signature: the class itself, or a subclass that keeps it. */
type FuzzySearchRuleClass = new (field: FieldExtractor, config: FuzzySearchRuleConfig) => FuzzySearchRule;

/** One Fuse.js index over a collection, for one `field` and one set of Fuse options. */
interface CollectionIndex {
	/** The extractor the index was built with (single-field mode reads through it). */
	readonly field: FieldExtractor;
	/** The index's documents' items: `items[i]` is the item Fuse reports as `refIndex` `i`. */
	readonly items: readonly unknown[];
	/** The index. */
	readonly fuse: Fuse<unknown>;
	/** The Fuse options the index was built with, as JSON, to tell when they change. */
	readonly optionsKey: string;
}

/** The answers one search of a collection index gave, for one config. */
interface CollectionVerdicts {
	/** The config searched; a different config object means a different search. */
	readonly config: FuzzySearchRuleConfig;
	/** The extractor in effect; a different one means a different search. */
	readonly field: FieldExtractor;
	/** Each indexed item, with whether it matched. Items the index left out are absent. */
	readonly matched: ReadonlyMap<unknown, boolean>;
}

// #region docs:fuzzy-search-rule
/**
 * Configuration for `FuzzySearchRule`: the query, optional `keys`, and any of the Fuse.js options
 * in {@link FuzzySearchFuseOptions}, passed through to Fuse as they are.
 *
 * See [Fuse.js docs](https://www.fusejs.io/api/options.html) for the full option reference.
 */
export interface FuzzySearchRuleConfig extends FuzzySearchFuseOptions {
	/** The search query. Empty string matches every item with a string field. */
	readonly query: string;
	/**
	 * Optional list of property paths to search within (for object items). When set, overrides
	 * the rule's `field` extractor in favor of multi-field Fuse search.
	 */
	readonly keys?: readonly string[];
}

/**
 * Filter items by fuzzy / typo-tolerant text match.
 *
 * @example
 *   // Items whose title fuzzy-matches 'cabernay' (catches 'cabernet' too):
 *   engine.addRule(
 *     'fuzzy-title',
 *     new FuzzySearchRule('title', { query: 'cabernay', threshold: 0.4 }),
 *   );
 *
 *   // Several fields, matched anywhere in the text, ignoring one-character runs:
 *   new FuzzySearchRule(undefined, {
 *     ignoreLocation: true,
 *     keys: ['name', 'winery'],
 *     minMatchCharLength: 2,
 *     query: 'cabernay',
 *   });
 */
export class FuzzySearchRule extends FilterRule {
	/**
	 * Minifier-proof wire name — see {@link FilterRule.ruleTypeName}. Declared as a literal so
	 * `ruleRegistry.register` can reject a key that disagrees with it at compile time.
	 */
	static override readonly ruleTypeName = 'FuzzySearchRule';

	override action: FilterRuleAction = (item, rule): boolean => {
		const cfg = (rule as FuzzySearchRule).config;

		if (cfg.query.length === 0) {
			return true;
		}

		// The prepared collection's answer, when this item is in it and nothing has changed since.
		const verdicts = this._verdicts;

		if (verdicts?.config === cfg && verdicts.field === this.field) {
			const isMatch = verdicts.matched.get(item);

			if (isMatch !== undefined) {
				return isMatch;
			}
		}

		// Multi-key mode: search the entire item via Fuse, not just the field extractor.
		if (cfg.keys && cfg.keys.length > 0) {
			return new Fuse([item], buildFuseOptions(cfg)).search(cfg.query).length > 0;
		}

		// Single-field mode: extract the string and probe.
		const fieldValue = this.getFieldValue(item);

		if (typeof fieldValue !== 'string') {
			return false;
		}

		return new Fuse([fieldValue], buildFuseOptions(cfg)).search(cfg.query).length > 0;
	};
	// #endregion docs:fuzzy-search-rule

	config: FuzzySearchRuleConfig;

	/** The Fuse index per collection, rebuilt when the field or the Fuse options change. */
	private readonly _indexes = new WeakMap<readonly unknown[], CollectionIndex>();

	/** The answers for the collection prepared last — the one the current pass iterates. */
	private _verdicts: CollectionVerdicts | null = null;

	/** Every collection's last answers, so a pass over a collection prepared before reuses them. */
	private readonly _verdictsByCollection = new WeakMap<readonly unknown[], CollectionVerdicts>();

	constructor(field: FieldExtractor, config: FuzzySearchRuleConfig) {
		super(field);
		this.config = config;
	}

	/**
	 * Search `collection` once, through one Fuse.js index over it, so `action` answers each of its
	 * items with a lookup — see {@link FilterRule.prepareForCollection}.
	 *
	 * @remarks
	 * The index is reused for as long as the collection, the `field` and every Fuse option except
	 * `query` stay the same; the answers for as long as the `config` object and the `field` do.
	 * An empty query prepares nothing, because `action` passes every item without searching.
	 *
	 * @param collection - The items the coming pass will evaluate
	 */
	override prepareForCollection(collection: readonly unknown[]): void {
		const config = this.config;
		const cached = this._verdictsByCollection.get(collection);

		if (cached?.config === config && cached.field === this.field) {
			this._verdicts = cached;

			return;
		}
		this._verdicts = null;
		if (config.query.length === 0) {
			return;
		}
		const index = this._indexFor(collection);
		const matched = new Map<unknown, boolean>();

		for (const item of index.items) {
			matched.set(item, false);
		}
		for (const result of index.fuse.search(config.query)) {
			matched.set(index.items[result.refIndex], true);
		}
		this._verdicts = { config, field: this.field, matched };
		this._verdictsByCollection.set(collection, this._verdicts);
	}

	/**
	 * Extract the item's single-field value as a string for the inverted trigram index — mirrors
	 * the single-field `action` path (non-string fields yield `undefined`). Only meaningful for
	 * single-field rules; multi-key fuzzy bypasses the index entirely (see `textPlan`).
	 */
	extractText(item: unknown): string | undefined {
		return coerceStringField(this.getFieldValue(item));
	}

	/**
	 * Get (building when stale) the Fuse index over `collection` for the current `field` and Fuse
	 * options.
	 *
	 * @remarks
	 * Holds the same documents the per-item path would search one at a time: in single-field mode
	 * each item whose field is a string, as that string; with `keys`, each item that is an object.
	 * Any other item is left out, and `action` answers it the per-item way.
	 *
	 * @param collection - The items to index
	 * @returns The index
	 */
	private _indexFor(collection: readonly unknown[]): CollectionIndex {
		// The options never include `query`, so one index serves every query.
		const options = buildFuseOptions(this.config);
		const optionsKey = JSON.stringify(options);
		const cached = this._indexes.get(collection);

		if (cached?.optionsKey === optionsKey && cached.field === this.field) {
			return cached;
		}
		const { keys } = this.config;
		const isMultiKey = keys !== undefined && keys.length > 0;
		const items: unknown[] = [];
		const documents: unknown[] = [];

		for (const item of collection) {
			const document = isMultiKey ? item : this.getFieldValue(item);

			if (isMultiKey ? typeof item === 'object' && item !== null : typeof document === 'string') {
				items.push(item);
				documents.push(document);
			}
		}
		const index: CollectionIndex = { field: this.field, fuse: new Fuse(documents, options), items, optionsKey };

		this._indexes.set(collection, index);

		return index;
	}

	/**
	 * Revive a `FuzzySearchRule` from its serialized form. `ruleRegistry.deserialize` calls this hook
	 * with the registered class as `this`, so a subclass registered in its place revives as itself.
	 *
	 * @remarks
	 * `threshold` and `distance` are upper limits, and a `null` one is unlimited (`Infinity`), which is
	 * what `JSON.stringify` writes for `Infinity`. Passed to Fuse.js as it is, a `null` `distance`
	 * would weigh every match by its location as `distance: 0` does. Every other Fuse option is
	 * checked for its type. An absent option stays absent, so the defaults apply; any other config
	 * keys are carried over unchanged.
	 *
	 * @param json - The serialized rule
	 * @returns The revived rule
	 * @throws `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG` when `config` is not an
	 *   object, `threshold` or `distance` is present but neither a number nor `null`, a numeric option
	 *   is not a finite number, a flag is not a boolean, or `tokenMatch` is neither `'all'` nor `'any'`
	 */
	static deserialize(this: FuzzySearchRuleClass, json: SerializedRule): FuzzySearchRule {
		// `query` and `keys` are carried over unchecked, as the generic revival path carries them.
		return new this(revivedField(json), reviveFuzzyConfig(json) as unknown as FuzzySearchRuleConfig);
	}
}
