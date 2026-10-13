/**
 * `FuzzySearchRule` — typo-tolerant fuzzy text search, backed by Fuse.js.
 *
 * @remarks
 * Wraps Fuse.js for approximate string matching with configurable threshold, edit distance,
 * and multi-field support. For zero-dep exact / substring / startsWith / endsWith / tokenized
 * matching, use `TextSearchRule` instead.
 *
 * **Acceleration.** The per-item `action` below is the exact, always-correct evaluator — and
 * doubles as the confirm step + the fallback. When the bitmap layer engages this rule with
 * `acceleration.textIndex` on, a Roaring inverted **trigram** index (`internals/TextInvertedIndex`)
 * pre-filters candidates via the sound bound in `internals/fuzzyTrigramBound` before this `action`
 * confirms the survivors, so no real match is dropped. Default-threshold (0.4) and multi-key fuzzy
 * bypass the index (the bound proves nothing / the index is single-field) and run `action` directly.
 *
 * @packageDocumentation
 */

import Fuse, { type IFuseOptions } from 'fuse.js';

import type { FieldExtractor, FilterRuleAction } from '../types.js';

import { coerceStringField } from '../lib/textTokens.js';
import { FilterRule } from './FilterRule.js';

// #region docs:fuzzy-search-rule
/**
 * Configuration for `FuzzySearchRule`.
 *
 * Mirrors a subset of Fuse.js's option set. See [Fuse.js
 * docs](https://www.fusejs.io/api/options.html) for the full option reference.
 */
export interface FuzzySearchRuleConfig {
	/** The search query. Empty string matches every item with a string field. */
	readonly query: string;
	/**
	 * Match strictness — 0 means exact match, 1 means anything matches. Default 0.4.
	 */
	readonly threshold?: number;
	/**
	 * Maximum allowed distance between matched characters in the source string. Higher values
	 * allow more lenient matching. See Fuse.js `distance` option.
	 */
	readonly distance?: number;
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

		// Multi-key mode: search the entire item via Fuse, not just the field extractor.
		if (cfg.keys && cfg.keys.length > 0) {
			const fuse = new Fuse([item], buildFuseOptions(cfg));

			return fuse.search(cfg.query).length > 0;
		}

		// Single-field mode: extract the string and probe.
		const fieldValue = this.getFieldValue(item);

		if (typeof fieldValue !== 'string') {
			return false;
		}
		const fuse = new Fuse([fieldValue], buildFuseOptions(cfg));

		return fuse.search(cfg.query).length > 0;
	};
	// #endregion docs:fuzzy-search-rule

	config: FuzzySearchRuleConfig;

	constructor(field: FieldExtractor, config: FuzzySearchRuleConfig) {
		super(field);
		this.config = config;
	}

	/**
	 * Extract the item's single-field value as a string for the inverted trigram index — mirrors
	 * the single-field `action` path (non-string fields yield `undefined`). Only meaningful for
	 * single-field rules; multi-key fuzzy bypasses the index entirely (see `textPlan`).
	 */
	extractText(item: unknown): string | undefined {
		return coerceStringField(this.getFieldValue(item));
	}
}

/**
 * Build the Fuse.js option set from a `FuzzySearchRuleConfig`. Module-level (stateless) helper —
 * it depends only on its argument, never on rule instance state.
 */
function buildFuseOptions(cfg: FuzzySearchRuleConfig): IFuseOptions<unknown> {
	const options: IFuseOptions<unknown> = {
		includeScore: false,
		threshold: cfg.threshold ?? 0.4,
	};

	if (cfg.distance !== undefined) {
		options.distance = cfg.distance;
	}
	if (cfg.keys !== undefined) {
		options.keys = [...cfg.keys];
	}

	return options;
}
