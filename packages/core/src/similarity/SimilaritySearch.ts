/**
 * `SimilaritySearch` — the `findSimilar(item, opts)` orchestrator, and what
 * {@link attachSimilarity} hands back.
 *
 * @remarks
 * Per `docs/architecture.md` §7.3. It is not an engine property: `similarity/` stays out of the
 * engine's import graph so consumers who never ask "what is similar to this?" don't ship MinHash
 * and LSH (1.65 kB gzipped, a tenth of `core`). See `attachSimilarity.ts` for the full trade.
 *
 * Ties together `MinHash` (signature computation) and `LSH`
 * (bucket lookup) into the public similarity API. Lazy-builds the per-source-data signatures
 * + LSH index on first `findSimilar` call; invalidates on `sourceDataVersion` change in O(1)
 * (cache key includes the version).
 *
 * **Two-phase query flow:**
 *
 *   1. **LSH candidate lookup** — query signature → bucket lookup → set of candidate item
 *      indices. Sub-linear in dataset size; typical candidate counts are 10-50 regardless of
 *      whether the corpus is 10k or 130k items.
 *   2. **Exact-Jaccard verification + ranking** — compute the precise MinHash-estimated
 *      similarity for each candidate, filter by `threshold`, sort descending, slice to `k`.
 *
 * Every candidate is verified against the exact MinHash estimate and `threshold` (default 0.5),
 * so no result falls below the threshold. Recall is probabilistic, though: an item is a
 * candidate only if it shares an LSH band with the query, so items between the threshold and
 * the banding curve's midpoint can be missed.
 *
 * **Banding curve tuning.** The default `numHashes=128, bandSize=8` (= 16 bands) has its curve
 * midpoint near 0.71 (≈0.06 recall at `s=0.5`, 0.61 at 0.7, 0.95 at 0.8), so it suits
 * thresholds of roughly 0.7 and up. For thresholds around 0.4-0.6, pass `bandSize: 4`
 * (32 bands; midpoint ≈ 0.42, ≈0.87 recall at `s=0.5`). See `docs/architecture.md` §7.2 for
 * the full curve analysis.
 *
 * @packageDocumentation
 */

import { FilterEngineConfigError } from '../errors/index.js';
import { getPath } from '../lib/getPath.js';
import { LSH } from './LSH.js';
import { MinHash } from './MinHash.js';

/**
 * Configuration for the engine's similarity search.
 *
 * Choose ONE of:
 *   - `attributes` — list of property paths; the orchestrator extracts each value, stringifies,
 *     and unions into the item's signature set
 *   - `signatureFn` — full custom signature function returning a `Set<string>` (escape hatch
 *     for any signature topology the `attributes` form can't express)
 */
export interface SimilarityConfig<T> {
	readonly attributes?: readonly string[];
	readonly signatureFn?: (item: T) => Set<string>;
	/** MinHash signature length. Higher = more accurate, more memory. Default 128. */
	readonly numHashes?: number;
	/**
	 * LSH banding parameter (`numHashes / bandSize = numBands`). Default 8 — recall curve
	 * midpoint ≈ 0.71, suited to thresholds ≥ 0.7. Lower values shift the curve down (`4` puts
	 * the midpoint near 0.42, for thresholds around 0.4-0.6).
	 */
	readonly bandSize?: number;
	/** Minimum Jaccard similarity to surface in results. Default 0.5. */
	readonly threshold?: number;
}

/**
 * Per-call options to {@link SimilaritySearch.findSimilar}.
 */
export interface SimilarityQuery {
	/** Top-k items to return. Default 5. */
	readonly k?: number;
	/** Per-call similarity threshold override. */
	readonly threshold?: number;
}

/**
 * Result entry for a similarity query.
 */
export interface SimilarityResult<T> {
	readonly item: T;
	/** Approximate Jaccard similarity in [0, 1]. */
	readonly similarity: number;
}

/**
 * Options for constructing `SimilaritySearch`.
 *
 * @remarks
 * The orchestrator needs to pull source data + the source-data version on demand for cache
 * invalidation. Wired via callbacks rather than a direct store reference so this class stays
 * decoupled from `InternalStore` (and can be tested in isolation with hand-rolled accessors).
 */
export interface SimilaritySearchOptions<T> {
	readonly config?: SimilarityConfig<T>;
	/** Source-data accessor — called on every `findSimilar`. The orchestrator caches by version. */
	readonly getSourceData?: () => readonly T[];
	/** Source-data version accessor — used as the cache invalidation key. */
	readonly getSourceDataVersion?: () => number;
}

/**
 * The validated, non-optional handles returned by `_ensureConfigured` — the config plus both
 * data accessors, already narrowed. Threaded into `_ensureIndexBuilt` / `_featureSetFor` so those
 * helpers don't re-narrow the optional fields (which would be a redundant, untestable guard).
 */
interface EnsureConfiguredHandles<T> {
	config: SimilarityConfig<T>;
	getSourceData: () => readonly T[];
	getSourceDataVersion: () => number;
}

/**
 * Similarity-search orchestrator.
 */
export class SimilaritySearch<T> {
	private _config: SimilarityConfig<T> | undefined;
	private readonly _getSourceData: (() => readonly T[]) | undefined;
	private readonly _getSourceDataVersion: (() => number) | undefined;

	/**
	 * Cached MinHash instance — recreated when `numHashes` or seed changes (via `configure`).
	 * The default seed is fixed to 42 so signatures round-trip across runs.
	 */
	private _minHash: MinHash | undefined;

	/**
	 * Cached LSH index — recreated when banding parameters change OR sourceDataVersion bumps.
	 */
	private _lsh: LSH | undefined;

	/**
	 * Cached per-item signatures, parallel-indexed with the source data. Rebuilt when
	 * sourceDataVersion bumps or config changes.
	 */
	private _itemSignatures: Uint32Array[] | undefined;

	/** Source-data version the current cached index was built against. */
	private _cachedVersion = -1;

	constructor(initialConfigOrOptions?: SimilarityConfig<T> | SimilaritySearchOptions<T>) {
		// Also accepts a bare config: `new SimilaritySearch(config)`.
		// If the argument has `getSourceData`/`getSourceDataVersion`, it's the options form;
		// otherwise treat it as a bare config.
		if (
			initialConfigOrOptions
			&& ('getSourceData' in initialConfigOrOptions || 'getSourceDataVersion' in initialConfigOrOptions
				|| 'config' in initialConfigOrOptions)
		) {
			const options = initialConfigOrOptions;

			this._config = options.config;
			this._getSourceData = options.getSourceData;
			this._getSourceDataVersion = options.getSourceDataVersion;
		} else {
			this._config = initialConfigOrOptions as SimilarityConfig<T> | undefined;
			this._getSourceData = undefined;
			this._getSourceDataVersion = undefined;
		}
	}

	/**
	 * Reconfigure at runtime — useful when the signature config depends on data only available
	 * once the engine has loaded its first dataset (e.g., dynamically-discovered attribute
	 * lists). Invalidates the cached index.
	 */
	configure(config: SimilarityConfig<T>): void {
		this._config = config;
		this.invalidateCache();
	}

	/** Current configuration, or `undefined` if none has been set. */
	getConfig(): SimilarityConfig<T> | undefined {
		return this._config;
	}

	// #region docs:similarity-find-similar
	/**
	 * Find the top-k items most similar to `item` in the current source data.
	 *
	 * @param item - The query item — typically one already in the dataset (its own signature
	 *   match is filtered out of results), but can also be a freshly-constructed "hypothetical
	 *   query item" with the same shape.
	 * @param options - Per-call query options (k, threshold override)
	 * @returns Items sorted by similarity descending, length ≤ k. Empty array if no
	 *   configuration is set, no source data is available, or no candidates pass threshold.
	 */
	findSimilar(item: T, options?: SimilarityQuery): SimilarityResult<T>[] {
		const configured = this._ensureConfigured();
		const { config, getSourceData } = configured;
		const { lsh, minHash, signatures } = this._ensureIndexBuilt(configured);
		const items = getSourceData();

		const querySig = minHash.signature(extractFeatureSet(item, config));
		const candidates = lsh.queryCandidates(querySig);

		const k = options?.k ?? 5;
		const threshold = options?.threshold ?? config.threshold ?? 0.5;

		const ranked: SimilarityResult<T>[] = [];

		for (const idx of candidates) {
			const candidate = items[idx];

			// Skip the query item itself (identity match) — consumers expect "items LIKE this,"
			// not "this item." Identity is detected by exact reference equality.
			if (candidate === item) {
				continue;
			}
			if (candidate === undefined) {
				continue;
			}
			const candidateSig = signatures[idx];

			/* v8 ignore next 3 -- defensive: signatures is parallel-indexed with items, so a valid idx always resolves to a signature */
			if (candidateSig === undefined) {
				continue;
			}
			const sim = MinHash.jaccardEstimate(querySig, candidateSig);

			if (sim >= threshold) {
				ranked.push({ item: candidate, similarity: sim });
			}
		}

		// Sort descending by similarity; slice to top-k. For small candidate sets the full
		// sort is cheaper than a heap-based top-k.
		ranked.sort((a, b) => b.similarity - a.similarity);

		return ranked.slice(0, k);
	}
	// #endregion docs:similarity-find-similar

	/**
	 * Find similar items by raw feature-set input — useful when querying with a "hypothetical
	 * profile" (not an actual item in the dataset). E.g., the wine app's "find wines like the
	 * one in my dream pairing" affordance, where the user composes attributes directly.
	 *
	 * @param featureSet - The string-set of features the hypothetical item would have
	 * @param options - Per-call query options
	 */
	findSimilarByFeatureSet(featureSet: ReadonlySet<string>, options?: SimilarityQuery): SimilarityResult<T>[] {
		const configured = this._ensureConfigured();
		const { config, getSourceData } = configured;
		const { lsh, minHash, signatures } = this._ensureIndexBuilt(configured);
		const items = getSourceData();

		const querySig = minHash.signature(featureSet);
		const candidates = lsh.queryCandidates(querySig);

		const k = options?.k ?? 5;
		const threshold = options?.threshold ?? config.threshold ?? 0.5;

		const ranked: SimilarityResult<T>[] = [];

		for (const idx of candidates) {
			const candidate = items[idx];

			if (candidate === undefined) {
				continue;
			}
			const candidateSig = signatures[idx];

			/* v8 ignore next 3 -- defensive: signatures is parallel-indexed with items, so a valid idx always resolves to a signature */
			if (candidateSig === undefined) {
				continue;
			}
			const sim = MinHash.jaccardEstimate(querySig, candidateSig);

			if (sim >= threshold) {
				ranked.push({ item: candidate, similarity: sim });
			}
		}

		ranked.sort((a, b) => b.similarity - a.similarity);

		return ranked.slice(0, k);
	}

	/**
	 * Explicit cache invalidation — usually unnecessary (the version check handles it
	 * automatically), but exposed for consumers who need to force a rebuild (e.g., after
	 * mutating items in-place, which is discouraged but does happen).
	 */
	invalidateCache(): void {
		this._minHash = undefined;
		this._lsh = undefined;
		this._itemSignatures = undefined;
		this._cachedVersion = -1;
	}

	// ─── Internal helpers ──────────────────────────────────────────────────

	/**
	 * Throw a clear error if the search isn't usable yet (no config, no data accessors).
	 * Returns the validated config + data accessors so callers avoid re-narrowing the
	 * optional fields.
	 */
	private _ensureConfigured(): EnsureConfiguredHandles<T> {
		const config = this._config;

		if (!config) {
			throw new FilterEngineConfigError(
				'SIMILARITY_NOT_CONFIGURED',
				'SimilaritySearch: no configuration set. Pass one to attachSimilarity(engine, ' +
				'{ attributes: [...] }) from @filter-enginez/core/similarity, or call .configure() ' +
				'on the search it returns.',
			);
		}
		if (!config.attributes && !config.signatureFn) {
			throw new FilterEngineConfigError(
				'SIMILARITY_INVALID_OPTIONS',
				'SimilaritySearch: configuration must provide either `attributes` or `signatureFn`.',
			);
		}
		if (!this._getSourceData || !this._getSourceDataVersion) {
			throw new FilterEngineConfigError(
				'SIMILARITY_NOT_CONFIGURED',
				'SimilaritySearch: source-data accessors not wired. SimilaritySearch must be ' +
				'constructed with `{ getSourceData, getSourceDataVersion }` — usually done by FilterEngine.',
			);
		}

		return { config, getSourceData: this._getSourceData, getSourceDataVersion: this._getSourceDataVersion };
	}

	// #region docs:similarity-index-build
	/**
	 * Build (or rebuild) the MinHash + LSH + per-item signature cache if it's stale relative
	 * to the current source-data version. Returns the live index handles so callers don't
	 * re-narrow the cached optional fields.
	 */
	private _ensureIndexBuilt(handles: EnsureConfiguredHandles<T>): {
		lsh: LSH;
		minHash: MinHash;
		signatures: Uint32Array[];
	} {
		const { config, getSourceData, getSourceDataVersion } = handles;
		const currentVersion = getSourceDataVersion();

		if (
			this._cachedVersion === currentVersion
			&& this._itemSignatures
			&& this._lsh
			&& this._minHash
		) {
			// Cache is fresh.
			return { lsh: this._lsh, minHash: this._minHash, signatures: this._itemSignatures };
		}

		const numHashes = config.numHashes ?? 128;
		const bandSize = config.bandSize ?? 8;

		const minHash = new MinHash(numHashes);
		const lsh = new LSH(numHashes, bandSize);
		const items = getSourceData();
		const signatures: Uint32Array[] = new Array<Uint32Array>(items.length);

		for (let i = 0; i < items.length; i++) {
			const item = items[i];

			if (item === undefined) {
				continue;
			}
			const features = extractFeatureSet(item, config);
			const sig = minHash.signature(features);

			signatures[i] = sig;
			lsh.insert(i, sig);
		}

		this._minHash = minHash;
		this._lsh = lsh;
		this._itemSignatures = signatures;
		this._cachedVersion = currentVersion;

		return { lsh, minHash, signatures };
	}
	// #endregion docs:similarity-index-build
}

/**
 * Extract the feature set for an item per its similarity config — either via the explicit
 * `signatureFn` or by stringifying values at each `attributes` path. Module-level + stateless so it
 * composes without reaching into `SimilaritySearch` instance state (the config is passed in).
 *
 * @internal
 */
function extractFeatureSet<T>(item: T, config: SimilarityConfig<T>): Set<string> {
	if (config.signatureFn) {
		return config.signatureFn(item);
	}
	const features = new Set<string>();

	/* v8 ignore next -- defensive: _ensureConfigured guarantees attributes when signatureFn is absent, so `?? []` never falls back */
	for (const path of config.attributes ?? []) {
		const value = getPath(item, path);

		collectFeatures(value, path, features);
	}

	return features;
}

/**
 * Flatten any value into a set of `path:stringified-value` tokens. Arrays add one token per
 * element; objects are stringified via JSON; primitives become `path:value`. Used by the
 * `attributes` config form to build the per-item feature set.
 *
 * @internal
 */
function collectFeatures(value: unknown, path: string, out: Set<string>): void {
	if (value === undefined || value === null) {
		return;
	}
	if (Array.isArray(value)) {
		for (const element of value) {
			out.add(`${path}:${stringifyPrimitive(element)}`);
		}

		return;
	}
	if (typeof value === 'object') {
		// Objects collapse to JSON. Rare in attribute-based configs; the escape hatch is
		// `signatureFn` for consumers who need richer object-aware feature extraction.
		out.add(`${path}:${JSON.stringify(value)}`);

		return;
	}
	out.add(`${path}:${stringifyPrimitive(value)}`);
}

function stringifyPrimitive(v: unknown): string {
	if (typeof v === 'string') {
		return v;
	}
	if (typeof v === 'number' || typeof v === 'boolean') {
		return String(v);
	}

	return JSON.stringify(v);
}
