/**
 * Wine `FilterEngineConfig` — JSON-driven filter definition served by the MSW handler at
 * `GET /api/wine/filter-config`.
 *
 * @remarks
 * Demonstrates the cascading hierarchical
 * filter (country → province → region → subregion) as the headline UX moment, alongside
 * varietal / color / body / sweetness facets, price + points + ABV ranges, and full-text +
 * fuzzy search affordances. The config is dynamically built from the loaded `wines` corpus
 * so the hierarchy tree + varietal set always reflect the actual data — no manual
 * synchronization required when the dataset regenerates.
 *
 * @packageDocumentation
 */

import { CURRENT_CONFIG_VERSION, type FilterEngineConfig } from '@filter-enginez/core';

import type { Wine } from './types.js';

/**
 * Build a hierarchical-rule tree from the loaded wine corpus. Walks every wine's origin and
 * assembles the nested country → province → region → subregion structure.
 *
 * @remarks
 * **The id scheme.** Each node's id is the pipe-joined path FROM the root to that node —
 * `"France"` for the country level, `"France|Bordeaux"` for the province level, all the way
 * to the leaf `"France|Bordeaux|Left Bank|Pauillac"`. The leaf id matches exactly what the
 * wine generator computes into `wine.originId`, so `HierarchicalRule` (configured with
 * `field: 'originId'`) resolves at every level:
 *
 *   - Selecting node `"France"` matches every wine whose `originId` starts with `"France|"`
 *     (because the tree walk finds the France subtree and every wine's path is a descendant
 *     of that subtree).
 *   - Selecting node `"France|Bordeaux"` narrows to Bordeaux wines specifically.
 *   - Selecting a leaf matches only wines with that exact `originId`.
 *
 * **Skips empty levels.** A wine with `region=""` (e.g., Spain's Rías Baixas which has no
 * sub-region) gets a 3-segment path (`"Spain|Galicia|Rías Baixas"`); the tree similarly
 * skips empty levels so the structure matches what the data actually shapes itself like.
 *
 * **Corpus-parameterized** (no module-load-time corpus dependency) so this module stays pure and
 * import-safe — the wine MSW handlers import it without dragging in `data.ts`'s eager corpus. The
 * caller supplies the corpus: the eager `wineFilterConfig` in `data.ts` passes the bootstrap tier;
 * the streaming handlers pass the lazily-loaded default tier; the SvelteKit routes pass the fetched
 * corpus.
 *
 * @internal
 */
export function buildOriginTree(
	source: readonly Pick<Wine, 'origin'>[],
): { readonly id: string; readonly children: readonly TreeNodeJson[] } {
	// Build the tree by walking each wine's origin path. Use nested Maps so duplicate
	// paths collapse to a single node automatically, then convert to plain arrays.
	const countryMap = new Map<string, Map<string, Map<string, Set<string>>>>();

	for (const wine of source) {
		const { country, province, region, subregion } = wine.origin;

		if (!country) {
			continue;
		}
		let provMap = countryMap.get(country);

		if (provMap === undefined) {
			provMap = new Map();
			countryMap.set(country, provMap);
		}
		const provKey = province || '';
		let regMap = provMap.get(provKey);

		if (regMap === undefined) {
			regMap = new Map();
			provMap.set(provKey, regMap);
		}
		const regKey = region || '';
		let subSet = regMap.get(regKey);

		if (subSet === undefined) {
			subSet = new Set();
			regMap.set(regKey, subSet);
		}
		subSet.add(subregion || '');
	}

	return {
		children: Array.from(countryMap.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([country, provMap]) => buildLevel(country, provMap, country)),
		id: 'origin',
	};
}

/**
 * Build a country-level tree node + its province-level descendants.
 *
 * @internal
 */
function buildLevel(
	label: string,
	provMap: Map<string, Map<string, Set<string>>>,
	pathSoFar: string,
): TreeNodeJson {
	const provinceNodes = Array.from(provMap.entries())
		.filter(([key]) => key.length > 0)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([provKey, regMap]) => buildProvinceLevel(provKey, regMap, `${pathSoFar}|${provKey}`));

	if (provinceNodes.length === 0) {
		return { id: pathSoFar, label };
	}

	return { children: provinceNodes, id: pathSoFar, label };
}

/**
 * Build a province-level tree node + its region-level descendants.
 *
 * @internal
 */
function buildProvinceLevel(
	label: string,
	regMap: Map<string, Set<string>>,
	pathSoFar: string,
): TreeNodeJson {
	const regionNodes = Array.from(regMap.entries())
		.filter(([key]) => key.length > 0)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([regKey, subSet]) => buildRegionLevel(regKey, subSet, `${pathSoFar}|${regKey}`));

	if (regionNodes.length === 0) {
		return { id: pathSoFar, label };
	}

	return { children: regionNodes, id: pathSoFar, label };
}

/**
 * Build a region-level tree node + its subregion (leaf) descendants.
 *
 * @internal
 */
function buildRegionLevel(
	label: string,
	subSet: Set<string>,
	pathSoFar: string,
): TreeNodeJson {
	const subregions = Array.from(subSet).filter((s) => s.length > 0).sort();

	if (subregions.length === 0) {
		return { id: pathSoFar, label };
	}

	return {
		children: subregions.map((sub) => ({
			id: `${pathSoFar}|${sub}`,
			label: sub,
		})),
		id: pathSoFar,
		label,
	};
}

/**
 * Type describing the tree-node shape with display labels. The runtime `HierarchicalRule`
 * doesn't look at `label`, but the UI uses it to render human-readable text without
 * re-parsing the path id on every render.
 *
 * @internal
 */
interface TreeNodeJson {
	readonly id: string;
	readonly children?: readonly TreeNodeJson[];
	readonly label: string;
}

/**
 * Collect unique varietals from the given corpus, sorted for stable UI ordering.
 *
 * @internal
 */
function collectUniqueVarietals(source: readonly Pick<Wine, 'varietal'>[]): readonly string[] {
	return Array.from(new Set(source.map((w) => w.varietal))).sort();
}

/**
 * Build the full wine `FilterEngineConfig` from a corpus — the origin tree + varietal set reflect
 * the actual data. Pure + corpus-parameterized so this module never imports the eager corpus (keeps
 * the wine handlers import-safe); callers pass the tier they want the config to describe.
 */
export function buildWineFilterConfig(corpus: readonly Wine[]): FilterEngineConfig {
	return {
		// One default group so the example filter panel has a visible facet collection.
		groups: [
			{
				composition: 'and',
				displayName: 'All wine filters',
				filterIds: [
					'origin',
					'varietal',
					'color',
					'body',
					'sweetness',
					'vintage',
					'price',
					'points',
					'abv',
					'notes',
					'winery',
				],
				id: 'all-filters',
			},
		],
		label: 'Wine reviews',
		metadata: {
			dataset: 'wine',
			description: 'Kaggle Wine Reviews-shaped wines — synthetic unless the real corpus was imported locally',
			primaryDimensions: ['origin', 'varietal', 'priceUsd', 'points', 'color', 'body'],
			uniqueVarietals: collectUniqueVarietals(corpus),
		},
		rules: [
		// ─── Origin hierarchy (the cascading filter showcase) ──────────────
			{
				id: 'origin',
				rule: {
					config: {
						selected: [],
						tree: buildOriginTree(corpus),
					},
					// `originId` (computed per wine in the generator) is the pipe-joined path
					// matching the tree's path-based node ids. Selecting any tree node from a
					// country down to a leaf works because the rule's tree-walk finds the
					// selection's subtree and checks every wine's full path against it.
					field: 'originId',
					type: 'HierarchicalRule',
				},
			},

			// ─── Varietal facet (InSet over the varietal pool) ─────────────────
			{
				id: 'varietal',
				rule: {
					config: { set: [] satisfies readonly string[] },
					field: 'varietal',
					type: 'InSetRule',
				},
			},

			// ─── Color / body / sweetness facets ───────────────────────────────
			{
				id: 'color',
				rule: {
					config: { set: [] satisfies readonly string[] },
					field: 'color',
					type: 'InSetRule',
				},
			},
			{
				id: 'body',
				rule: {
					config: { set: [] satisfies readonly string[] },
					field: 'body',
					type: 'InSetRule',
				},
			},
			{
				id: 'sweetness',
				rule: {
					config: { set: [] satisfies readonly string[] },
					field: 'sweetness',
					type: 'InSetRule',
				},
			},

			// ─── Vintage (InSet — narrow set of years) ─────────────────────────
			{
				id: 'vintage',
				rule: {
					config: { set: [] satisfies readonly number[] },
					field: 'vintage',
					type: 'InSetRule',
				},
			},

			// ─── Numeric ranges ────────────────────────────────────────────────
			{
				id: 'price',
				rule: {
					config: { max: Number.POSITIVE_INFINITY, min: 0 },
					field: 'priceUsd',
					type: 'RangeRule',
				},
			},
			{
				id: 'points',
				rule: {
					config: { max: 100, min: 80 },
					field: 'points',
					type: 'RangeRule',
				},
			},
			{
				id: 'abv',
				rule: {
					config: { max: 25, min: 0 },
					field: 'abv',
					type: 'RangeRule',
				},
			},

			// ─── Fuzzy search × 2 ──────────────────────────────────────────────
			// Both description (tasting notes) and winery search are typo-tolerant via Fuse.js.
			// Tasting notes use a looser threshold (0.45) because the text is longer free-form
			// prose where users routinely misspell or paraphrase. Winery names are proper nouns
			// where tight matching matters more, so a tighter 0.35 threshold.
			{
				id: 'notes',
				rule: {
					config: { query: '', threshold: 0.45 },
					field: 'description',
					type: 'FuzzySearchRule',
				},
			},
			{
				id: 'winery',
				rule: {
					config: { query: '', threshold: 0.35 },
					field: 'winery',
					type: 'FuzzySearchRule',
				},
			},
		],
		version: CURRENT_CONFIG_VERSION,
	};
}

/**
 * Get the filter config for a corpus. Exposed alongside {@link buildWineFilterConfig} as the
 * public-API name consumers wiring against JSON-config mode reach for; identical behavior.
 */
export function getWineFilterConfig(corpus: readonly Wine[]): FilterEngineConfig {
	return buildWineFilterConfig(corpus);
}
