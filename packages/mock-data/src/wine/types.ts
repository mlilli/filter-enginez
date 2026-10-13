/**
 * Wine dataset types — `Wine` and its supporting enums.
 *
 * @remarks
 * The "showcase cascading + Bayesian + similarity"
 * dataset — exercises `HierarchicalRule` (country → province → region → subregion →
 * designation), `InSetRule` (varietal, winery, vintage), `RangeRule` (price, points, ABV),
 * `TextSearchRule` (tasting-note search), `FuzzySearchRule` (forgiving winery search). The
 * tasting-notes field powers similarity search via MinHash + LSH; the
 * varietal/region/vintage combinations power the Bayesian co-occurrence suggestion model.
 *
 * Provenance: what ships is synthetic, produced by the seeded generator in `./generate.ts`.
 *   - **Varietals** — a curated pool weighted to roughly mirror the review volume in the Kaggle
 *     "Wine Reviews" dataset (Cabernet + Chardonnay + Pinot Noir dominate)
 *   - **Origin hierarchy** — a hand-curated country → province → region → subregion table with
 *     region-typical varietal weights
 *   - **Winery, vintage, ABV, price, points** — generated per record
 *   - **Tasting notes** — a curated descriptor library weighted by varietal-typicality
 *     (Cabernet → blackberry + leather; Sauvignon Blanc → grass + citrus + mineral)
 *
 * ⚠ The one real-data path is local only: `pnpm regen:wine:real --accept-data-license` downloads
 * the Kaggle "Wine Reviews" dataset (scraped from WineEnthusiast in 2017) into gitignored JSON in
 * the same `Wine` shape. It is licensed CC BY-NC-SA 4.0, so it is never packaged or deployed.
 *
 * **Full corpus = 130k records** — the stress-test dataset for the benchmark suite.
 *
 * @packageDocumentation
 */

import type { BaseRecord } from '../shared.js';

/** Top-level wine color classification — primary facet. */
export type WineColor = 'dessert' | 'fortified' | 'red' | 'rosé' | 'sparkling' | 'white';

/**
 * Body / weight scale. Surfaced as an ordinal `InSetRule` (the example app renders these as a 5-step
 * pill toggle rather than checkboxes, but the rule type stays a clean inSet).
 */
export type WineBody = 'full' | 'light' | 'medium-full' | 'medium-light' | 'medium';

/** Sweetness scale, same ordinal treatment as body. */
export type WineSweetness = 'bone-dry' | 'dessert' | 'dry' | 'medium-sweet' | 'off-dry' | 'sweet';

/**
 * Hierarchical wine origin — drives the `HierarchicalRule` cascade in the filter UI.
 */
export interface WineOrigin {
	readonly country: string;
	readonly province: string;
	/** May be empty for wines from a regionless province (rare but possible in the dataset). */
	readonly region: string;
	/** May be empty if no subregion exists. */
	readonly subregion: string;
}

/**
 * A single wine record.
 */
export interface Wine extends BaseRecord {
	// ─── Identity ──────────────────────────────────────────────────────────
	readonly name: string;
	readonly varietal: string;
	readonly vintage: number;
	readonly winery: string;

	// ─── Origin (hierarchical) ─────────────────────────────────────────────
	readonly designation: string;
	readonly origin: WineOrigin;
	/**
	 * Pipe-joined fully-qualified origin path — e.g. `"France|Bordeaux|Left Bank|Pauillac"`.
	 * Empty origin levels are dropped from the path (no trailing pipes), so a wine with
	 * empty subregion gets `"Italy|Sicily|Etna"` and a wine with empty region+subregion gets
	 * `"Spain|La Rioja"`.
	 *
	 * This derived field exists so `HierarchicalRule` has a single string-field extractor
	 * point that matches the tree's path-based node IDs. Selecting any ancestor (country,
	 * province, region) in the picker walks the tree to find the wine via this path.
	 */
	readonly originId: string;

	// ─── Numerics ──────────────────────────────────────────────────────────
	readonly priceUsd: number;
	/** Wine Enthusiast point score, 80-100. */
	readonly points: number;
	/** Alcohol by volume, percentage. */
	readonly abv: number;

	// ─── Classifications ───────────────────────────────────────────────────
	readonly body: WineBody;
	readonly color: WineColor;
	readonly sweetness: WineSweetness;

	// ─── Tasting profile (drives similarity search) ────────────────────────
	readonly tastingNotes: readonly string[];

	// ─── Marketing ─────────────────────────────────────────────────────────
	readonly description: string;
	readonly labelImage: string;
}
