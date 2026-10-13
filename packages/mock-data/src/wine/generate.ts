/**
 * Procedural wine dataset generator. Produces deterministic, realistic-looking `Wine[]` via
 * a seeded RNG plus curated reference lists (varietals, regions, wineries, descriptors).
 *
 * @remarks
 * This generator is the source of every wine this package ships. It contains no Kaggle or
 * WineEnthusiast records: varietal weights roughly mirror the review volume in the Kaggle "Wine
 * Reviews" dataset, and the origin hierarchy and descriptor library are hand-curated. It produces
 * realistic distributions across every facet the example filter UI exercises — varietal cascading,
 * region hierarchy, price/points clustering, tasting-note co-occurrence by varietal-typicality.
 * (The optional real corpus from `scripts/import-kaggle-wine.mjs` is a separate, local-only path;
 * see `./corpusLoaders.ts`.)
 *
 * **Why a generator, not a JSON dump.** Two reasons:
 *
 *   1. **Reproducibility** — the same seed always produces the same dataset, which keeps
 *      snapshot tests stable AND keeps "the wine at index 42" a stable reference across
 *      every docs example. A committed JSON dump achieves the same, but a generator is
 *      tunable: bump the sample size, change the seed, regen.
 *   2. **Bundle size** — a 10,000-record JSON file imported directly bloats consumer bundles
 *      even when the engine code-splits. A function called inside an init effect lives
 *      outside the consumer bundle's static graph; tree-shakers can drop it from
 *      production builds that supply their own data.
 *
 * @packageDocumentation
 */

import type { Wine } from './types.js';

import {
	mulberry32,
	normalSample,
	pickN,
	pickOne,
	pickWeighted,
	randomFloat,
	randomInt,
	type SeededRng,
	slugify,
} from '../_generation/random.js';
import {
	BODY_WEIGHTS_BY_COLOR,
	COLOR_BY_VARIETAL,
	DESCRIPTION_TEMPLATES,
	ORIGIN_HIERARCHY,
	SWEETNESS_WEIGHTS_BY_COLOR,
	TASTING_NOTES_BY_VARIETAL,
	VARIETAL_OUTLIER_PROBABILITY,
	VARIETALS_WITH_WEIGHTS,
	WINERY_PREFIXES,
	WINERY_SUFFIXES,
} from './generate-data.js';

/**
 * Generate a single procedural wine record at the given index. Deterministic given the seed
 * passed to the parent `generateWines` call.
 *
 * @internal
 */
function generateWine(rng: SeededRng, index: number, tier: 'default' | 'full'): Wine {
	const originEntry = pickOne(rng, ORIGIN_HIERARCHY);
	const { colorOverride, designation, origin, typicalVarietals } = originEntry;

	// Pick varietal: usually from the region-typical pool, occasionally from the global
	// distribution (~5%) so the dataset has a handful of plausible outliers (Cab Sauv from
	// Burgundy, Pinot Noir from Sonoma, etc. — these DO exist in the real world).
	let varietal: string;

	if (rng() < VARIETAL_OUTLIER_PROBABILITY) {
		varietal = pickWeighted(rng, VARIETALS_WITH_WEIGHTS);
	} else {
		varietal = pickWeighted(rng, typicalVarietals);
	}

	// Color: per-region override (e.g., Champagne → sparkling) wins; otherwise derived from
	// the varietal's natural color via the lookup table. Fallback to 'red' for varietals
	// not yet in the COLOR_BY_VARIETAL table (defensive — every varietal in our pools is
	// covered today, but this keeps the generator non-throwing if someone adds a new one).
	const color = colorOverride ?? COLOR_BY_VARIETAL[varietal] ?? 'red';
	const body = pickWeighted(rng, BODY_WEIGHTS_BY_COLOR[color]);
	const sweetness = pickWeighted(rng, SWEETNESS_WEIGHTS_BY_COLOR[color]);
	const vintage = randomInt(rng, 2008, 2024);
	const wineryName = `${pickOne(rng, WINERY_PREFIXES)} ${pickOne(rng, WINERY_SUFFIXES)}`;

	// Price clustering: most wines $15-50, long tail to $200+
	const priceUsd = Math.round(normalSample(rng, 38, 30, 8, 350) * 100) / 100;

	// Points clustering around 88 with σ=3 — matches Wine Enthusiast's review distribution
	const points = Math.round(normalSample(rng, 88, 3, 80, 100));

	// ABV mostly 12-15%, occasional fortified at 18+
	const abv = Math.round(randomFloat(rng, 11.0, color === 'fortified' ? 20 : 15.5) * 10) / 10;

	// Pick 3-6 tasting notes weighted toward the varietal's typicality. Fall back to a
	// reasonable generic palette if the varietal isn't in our table (defensive — shouldn't
	// happen with our curated list, but allows the table to evolve without crashing).
	const typicalNotes = TASTING_NOTES_BY_VARIETAL[varietal] ?? ['fruit', 'oak', 'spice'];
	const noteCount = randomInt(rng, 3, 6);
	const tastingNotes = pickN(rng, typicalNotes, noteCount);

	// Build the wine name: "{Winery} {Varietal} {Vintage}" — matches Wine Enthusiast convention
	const wineName = `${wineryName} ${varietal} ${vintage}`;
	const id = `${slugify(wineName)}-${index}`;

	// Description: pick a template, interpolate
	const descriptionTemplate = pickOne(rng, DESCRIPTION_TEMPLATES);
	const description = descriptionTemplate
		.replace('{varietal}', varietal)
		.replace('{vintage}', String(vintage))
		.replace('{color}', color)
		.replace('{body}', body)
		.replace('{region}', origin.region || origin.province)
		.replace('{subregion}', origin.subregion || origin.region || origin.province)
		.replace('{winery}', wineryName)
		.replace('{notes}', tastingNotes.slice(0, 3).join(', '))
		.replace('{drinkBy}', String(vintage + randomInt(rng, 5, 20)));

	// Last updated within the past 2 years from a fixed reference date so the dataset stays
	// deterministic even as wall-clock time progresses.
	const baseDate = new Date('2026-05-01T00:00:00Z').getTime();
	const lastUpdated = new Date(baseDate - randomInt(rng, 0, 730) * 86400_000).toISOString();

	// Build the pipe-joined originId path — drops empty levels so wines with no subregion
	// still get a sensible path (e.g. "Italy|Sicily|Etna" rather than "Italy|Sicily|Etna|").
	// The wineFilterConfig tree uses these exact path strings as node ids so the
	// HierarchicalRule resolves correctly at every level.
	const originLevels = [origin.country, origin.province, origin.region, origin.subregion]
		.filter((level) => level.length > 0);
	const originId = originLevels.join('|');

	return {
		abv,
		body,
		color,
		description,
		designation,
		id,
		labelImage: `https://placehold.co/240x360/0b1220/22d3ee?text=${encodeURIComponent(varietal)}`,
		lastUpdated,
		name: wineName,
		origin,
		originId,
		points,
		priceUsd,
		sweetness,
		tastingNotes,
		tier,
		varietal,
		vintage,
		winery: wineryName,
	};
}

/**
 * Generate `count` wine records deterministically from `seed`. The default seed produces the
 * canonical bootstrap dataset; consumers regenerating with a different seed get a different
 * (still-realistic) dataset.
 *
 * @param count - Number of records to generate. The default tier uses 10,000; the full tier
 *   uses 130,000.
 * @param seed - 32-bit unsigned integer seed. Default `0xC4B3A4E7` for the canonical sample.
 * @param tier - The tier marker to stamp onto every record's `tier` field.
 * @returns A readonly array of `Wine` records
 */
export function generateWines(
	count: number,
	seed = 0xC4B3A4E7,
	tier: 'default' | 'full' = 'default',
): readonly Wine[] {
	const rng = mulberry32(seed);
	const wines: Wine[] = [];

	for (let i = 0; i < count; i++) {
		wines.push(generateWine(rng, i, tier));
	}

	return wines;
}
