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
 * Provenance: what ships is synthetic, produced by the seeded generator in `./generate.ts` from
 * aggregate statistics of the Kaggle "Wine Reviews" dataset — never from its records:
 *   - **Origin and varietal** — all 1,619 measured country → province → region → subregion leaves
 *     and 701 varietals, paired at their measured shares (Napa Cabernet, Barolo Nebbiolo,
 *     Champagne sparkling)
 *   - **Points, price, vintage** — the measured score histogram, price-by-score curve and vintage
 *     ages, with country and varietal leans
 *   - **ABV, body, sweetness** — hand-curated domain tables (the dataset records none of them)
 *   - **Winery, designation** — invented names in each country's language
 *   - **Tasting notes** — descriptors chosen at the frequency measured for the varietal
 *     (Cabernet Sauvignon → cassis + cedar; Sauvignon Blanc → grapefruit + grass)
 *
 * ⚠ The one real-data path is local only: `pnpm regen:wine:real --accept-data-license` downloads
 * the Kaggle "Wine Reviews" dataset (scraped from WineEnthusiast in 2017) into gitignored JSON in
 * the same `Wine` shape. It is licensed CC BY-NC-SA 4.0, so it is never packaged or deployed.
 *
 * **Full tier = 150k records** (`FULL_WINE_TIER_SIZE`), generated on demand in Node or a browser
 * Web Worker — the stress-test dataset for the benchmark suite and the worker-offload demos.
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
	/** Empty when the province has no named region (about one wine in six, as in the reviews measured). */
	readonly region: string;
	/** Empty when the region has no named subregion: every wine outside the United States, and some inside it. */
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
