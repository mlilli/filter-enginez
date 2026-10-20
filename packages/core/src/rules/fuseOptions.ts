/**
 * The Fuse.js options `FuzzySearchRule` passes through: their types, how they become Fuse's option
 * object, and how a serialized config is checked as it loads.
 *
 * @remarks
 * **Only options JSON can carry.** A rule's config travels through `exportConfig`, URL state, the
 * worker bridge and devtools persistence, so the passthrough holds only Fuse.js options that are
 * numbers, booleans or strings. Fuse's function options are left out on purpose: `getFn` (use the
 * rule's `field` extractor, which can be a function, for custom extraction in single-field mode)
 * and `sortFn` (a filter keeps or drops items and never ranks them). Neither does any option that
 * shapes Fuse's result list rather than which items it returns: `includeScore`, `includeMatches`,
 * `shouldSort`. A config key outside the list is kept on the config, as before, and never reaches
 * Fuse.
 *
 * Internal to `core`; `FuzzySearchRule` is the only caller.
 *
 * @packageDocumentation
 */

import type { IFuseOptions } from 'fuse.js';

import type { SerializedRule } from '../types.js';

import { invalidConfig, reviveBounds, reviveFiniteNumber } from './serializedConfig.js';

/**
 * The Fuse.js options a `FuzzySearchRule` config may set, each with the meaning Fuse.js gives it
 * (<https://www.fusejs.io/api/options.html>). Every one is optional; an absent option takes Fuse's
 * default, except `threshold`, whose default here is Fuse's own 0.4 written out.
 */
export interface FuzzySearchFuseOptions {
	/**
	 * Maximum allowed distance between matched characters in the source string. Higher values
	 * allow more lenient matching. See Fuse.js `distance` option.
	 */
	readonly distance?: number;
	/** How much the field-length norm weighs in scoring. Scoring only: it never changes which items match. */
	readonly fieldNormWeight?: number;
	/** Keep searching after a perfect match has been found. */
	readonly findAllMatches?: boolean;
	/** Match `é` as `e`: diacritics are stripped from the query and the text before matching. */
	readonly ignoreDiacritics?: boolean;
	/** Leave the field-length norm out of scoring. Scoring only. */
	readonly ignoreFieldNorm?: boolean;
	/** Match anywhere in the text, ignoring `location` and `distance`. */
	readonly ignoreLocation?: boolean;
	/** Compare case-sensitively. */
	readonly isCaseSensitive?: boolean;
	/** Where in the text the match is expected to be found (with `distance`). */
	readonly location?: number;
	/** Count a match only when its matched run is at least this many characters long. */
	readonly minMatchCharLength?: number;
	/**
	 * Match strictness — 0 means exact match, 1 means anything matches. Default 0.4.
	 */
	readonly threshold?: number;
	/** With `useTokenSearch`, whether an item must match every query word (`'all'`) or any (`'any'`, default). */
	readonly tokenMatch?: 'all' | 'any';
	/** Read the query as Fuse.js extended-search syntax (`'exact`, `^prefix`, `!negation`, `|` for OR). */
	readonly useExtendedSearch?: boolean;
	/** Match the query word by word (Fuse.js token search) instead of as one pattern. */
	readonly useTokenSearch?: boolean;
}

/** How each passthrough option is checked when a serialized config loads. */
type OptionKind = 'boolean' | 'bound' | 'number' | 'tokenMatch';

/** Every passthrough option, with how it is checked. The single list `buildFuseOptions` copies from. */
const FUSE_OPTION_KINDS: Readonly<Record<keyof FuzzySearchFuseOptions, OptionKind>> = {
	distance: 'bound',
	fieldNormWeight: 'number',
	findAllMatches: 'boolean',
	ignoreDiacritics: 'boolean',
	ignoreFieldNorm: 'boolean',
	ignoreLocation: 'boolean',
	isCaseSensitive: 'boolean',
	location: 'number',
	minMatchCharLength: 'number',
	threshold: 'bound',
	tokenMatch: 'tokenMatch',
	useExtendedSearch: 'boolean',
	useTokenSearch: 'boolean',
};

/** The passthrough option names, in a stable order. */
const FUSE_OPTION_NAMES = Object.keys(FUSE_OPTION_KINDS) as readonly (keyof FuzzySearchFuseOptions)[];

/** Fuse.js's default `threshold`, applied when a config omits it. */
export const FUSE_DEFAULT_THRESHOLD = 0.4;

/**
 * Build the Fuse.js option object for a config: every passthrough option it sets, its `keys`, and
 * the default `threshold`. Results are never sorted or scored for the caller, since a filter only
 * asks which items match.
 *
 * @param config - The rule's config
 * @returns Options for `new Fuse(...)`
 */
export function buildFuseOptions(config: { readonly keys?: readonly string[] } & FuzzySearchFuseOptions): IFuseOptions<unknown> {
	const options: Record<string, unknown> = {
		includeScore: false,
		shouldSort: false,
		threshold: FUSE_DEFAULT_THRESHOLD,
	};

	for (const name of FUSE_OPTION_NAMES) {
		if (config[name] !== undefined) {
			options[name] = config[name];
		}
	}
	if (config.keys !== undefined) {
		options['keys'] = [...config.keys];
	}

	return options;
}

/**
 * Read a serialized `FuzzySearchRule` config, reviving and checking every passthrough option.
 *
 * @remarks
 * `threshold` and `distance` are upper limits, and a `null` one is unlimited (`Infinity`), which is
 * what `JSON.stringify` writes for `Infinity`. The other options have no open form: a number must be
 * finite, a flag a boolean, `tokenMatch` `'all'` or `'any'`. An absent option stays absent, so the
 * default applies; every other key is carried over unchanged.
 *
 * @param json - The serialized rule
 * @returns The config, its options revived
 * @throws `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG` when `config` is not an
 *   object, or a present option has the wrong type
 */
export function reviveFuzzyConfig(json: SerializedRule): Readonly<Record<string, unknown>> {
	const config = reviveBounds(json, { distance: Number.POSITIVE_INFINITY, threshold: Number.POSITIVE_INFINITY }, true);

	for (const name of FUSE_OPTION_NAMES) {
		const value = config[name];
		const where = `${json.type} config.${name}`;

		if (value === undefined) {
			continue;
		}
		switch (FUSE_OPTION_KINDS[name]) {
			case 'boolean':
				if (typeof value !== 'boolean') {
					throw invalidConfig(where, 'a boolean', value);
				}
				break;
			case 'bound':
				// Revived above.
				break;
			case 'number':
				reviveFiniteNumber(value, where);
				break;
			case 'tokenMatch':
				if (value !== 'all' && value !== 'any') {
					throw invalidConfig(where, '\'all\' or \'any\'', value);
				}
				break;
		}
	}

	return config;
}
