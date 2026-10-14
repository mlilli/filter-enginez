// cspell:disable -- grape names in several languages
/**
 * Hand-curated domain tables for the synthetic wine generator (`./generate.ts`): alcohol, body and
 * sweetness.
 *
 * @remarks
 * The measured statistics in `./generate-origins.ts` and `./generate-profile.ts` cover every field
 * the Kaggle "Wine Reviews" dataset records. It records no alcohol, body or sweetness, so these
 * three come from general wine knowledge instead, kept deliberately coarse:
 *
 *   - **Alcohol** starts from a per-color mean, then leans by varietal (Zinfandel runs hot, Moscato
 *     d'Asti barely reaches 6%), by country (warm New World regions run higher, Germany and England
 *     lower) and by sweetness (unfermented sugar is alcohol that never formed).
 *   - **Body** starts from a per-color center, leans by varietal (Cabernet Sauvignon fuller, Gamay
 *     lighter) and rises with alcohol, which is most of what "body" measures on the palate.
 *   - **Sweetness** is weighted per color, with overrides for the grapes most often made off-dry
 *     or sweet (Riesling, Chenin Blanc, Moscato). Red and rosé wines are never `sweet` or
 *     `dessert`: a sweet red is a fortified or dessert wine and carries that color instead.
 *
 * Varietals absent from a lean table take no lean.
 *
 * @packageDocumentation
 */

import type { WineBody, WineColor, WineSweetness } from './types.js';

/** Mean, spread and hard bounds of alcohol by volume for one wine color, in percent. */
export interface AbvProfile {
	readonly maximum: number;
	readonly mean: number;
	readonly minimum: number;
	readonly standardDeviation: number;
}

/**
 * Alcohol by volume per color, before any lean.
 *
 * @internal
 */
export const ABV_PROFILE_BY_COLOR: Readonly<Record<WineColor, AbvProfile>> = {
	dessert: { maximum: 15.5, mean: 12.6, minimum: 5.5, standardDeviation: 1.6 },
	fortified: { maximum: 22, mean: 19, minimum: 15, standardDeviation: 1.2 },
	red: { maximum: 16.5, mean: 13.7, minimum: 10.5, standardDeviation: 0.65 },
	rosé: { maximum: 14.5, mean: 12.8, minimum: 10.5, standardDeviation: 0.55 },
	sparkling: { maximum: 14, mean: 12.1, minimum: 6.5, standardDeviation: 0.45 },
	white: { maximum: 15.5, mean: 13.1, minimum: 7.5, standardDeviation: 0.7 },
};

/**
 * Alcohol lean per varietal, in percentage points.
 *
 * @internal
 */
export const ABV_LEAN_BY_VARIETAL: Readonly<Record<string, number>> = {
	Albariño: -0.4,
	Barbera: 0.2,
	'Cabernet Sauvignon': 0.4,
	Chardonnay: 0.4,
	'Chenin Blanc': -0.3,
	'Corvina, Rondinella, Molinara': 1.2,
	Gamay: -0.8,
	Garnacha: 0.6,
	Glera: -0.9,
	Grenache: 0.6,
	'Grüner Veltliner': -0.3,
	Lambrusco: -1.4,
	Malbec: 0.4,
	Moscato: -5,
	'Müller-Thurgau': -1,
	Nebbiolo: 0.3,
	'Petite Sirah': 0.8,
	'Pinot Grigio': -0.4,
	'Pinot Noir': -0.3,
	Primitivo: 0.9,
	Riesling: -1.6,
	'Sauvignon Blanc': -0.2,
	Sherry: -2.5,
	Shiraz: 0.6,
	Syrah: 0.4,
	Tannat: 0.4,
	Viognier: 0.6,
	Zinfandel: 1.1,
};

/**
 * Alcohol lean per country, in percentage points: warm-climate producers higher, cool-climate
 * lower.
 *
 * @internal
 */
export const ABV_LEAN_BY_COUNTRY: Readonly<Record<string, number>> = {
	Argentina: 0.4,
	Australia: 0.5,
	Austria: -0.2,
	Canada: -0.3,
	Chile: 0.3,
	England: -1,
	France: -0.2,
	Germany: -0.8,
	'New Zealand': -0.1,
	'South Africa': 0.3,
	Spain: 0.2,
	US: 0.4,
};

/**
 * Alcohol lean per sweetness level, in percentage points. Applied to every color except fortified,
 * whose sweetness comes from spirit added during fermentation rather than from stopping it.
 *
 * @internal
 */
export const ABV_LEAN_BY_SWEETNESS: Readonly<Record<WineSweetness, number>> = {
	'bone-dry': 0.1,
	dessert: -2,
	dry: 0,
	'medium-sweet': -1,
	'off-dry': -0.5,
	sweet: -1.6,
};

/**
 * Body scale, lightest first. A body center of 1 means `light`, 5 means `full`.
 *
 * @internal
 */
export const BODY_SCALE: readonly WineBody[] = ['light', 'medium-light', 'medium', 'medium-full', 'full'];

/**
 * Body center per color on the 1–5 {@link BODY_SCALE}, before any lean.
 *
 * @internal
 */
export const BODY_CENTER_BY_COLOR: Readonly<Record<WineColor, number>> = {
	dessert: 4,
	fortified: 4.5,
	red: 3.5,
	rosé: 1.9,
	sparkling: 1.8,
	white: 2.5,
};

/**
 * Body lean per varietal, in body-scale steps.
 *
 * @internal
 */
export const BODY_LEAN_BY_VARIETAL: Readonly<Record<string, number>> = {
	Aglianico: 0.5,
	Albariño: -0.4,
	Barbera: -0.2,
	'Bordeaux-style Red Blend': 0.4,
	'Cabernet Franc': -0.1,
	'Cabernet Sauvignon': 0.6,
	Chardonnay: 0.8,
	Dolcetto: -0.4,
	Gamay: -1.1,
	'Grüner Veltliner': -0.2,
	Malbec: 0.5,
	Mourvèdre: 0.5,
	Nebbiolo: 0.3,
	'Petite Sirah': 0.9,
	'Pinot Grigio': -0.7,
	'Pinot Noir': -0.8,
	Riesling: -0.6,
	Sangiovese: -0.2,
	'Sauvignon Blanc': -0.4,
	Shiraz: 0.6,
	Syrah: 0.6,
	Tannat: 0.8,
	'Touriga Nacional': 0.5,
	Viognier: 0.7,
	Zinfandel: 0.5,
	Zweigelt: -0.5,
};

/**
 * How many body-scale steps one percentage point of alcohol above the color's mean adds.
 *
 * @internal
 */
export const BODY_STEPS_PER_ABV_POINT = 0.6;

/**
 * Spread of the per-wine body noise, in body-scale steps.
 *
 * @internal
 */
export const BODY_NOISE_STANDARD_DEVIATION = 0.7;

/**
 * Sweetness weights per color, in the order of the {@link SWEETNESS_SCALE}.
 *
 * @internal
 */
export const SWEETNESS_WEIGHTS_BY_COLOR: Readonly<Record<WineColor, readonly number[]>> = {
	dessert: [0, 0, 2, 12, 36, 50],
	fortified: [10, 12, 8, 18, 32, 20],
	red: [28, 64, 6, 2, 0, 0],
	rosé: [24, 62, 11, 3, 0, 0],
	sparkling: [22, 58, 12, 6, 2, 0],
	white: [16, 56, 17, 7, 4, 0],
};

/**
 * Sweetness scale, driest first; the column order of every sweetness weight table.
 *
 * @internal
 */
export const SWEETNESS_SCALE: readonly WineSweetness[] = ['bone-dry', 'dry', 'off-dry', 'medium-sweet', 'sweet', 'dessert'];

/**
 * Sweetness weights for the grapes most often made off-dry or sweet, replacing their color's row.
 * Only applied when the wine's color is `white`, `sparkling` or `dessert`, so a red or rosé is
 * never sweet.
 *
 * @internal
 */
export const SWEETNESS_WEIGHTS_BY_VARIETAL: Readonly<Record<string, readonly number[]>> = {
	'Chenin Blanc': [10, 46, 26, 12, 6, 0],
	Furmint: [10, 40, 20, 12, 10, 8],
	Gewürztraminer: [6, 44, 30, 14, 6, 0],
	Glera: [6, 36, 40, 14, 4, 0],
	Moscatel: [4, 20, 20, 24, 24, 8],
	Moscato: [0, 0, 4, 20, 46, 30],
	Muscat: [4, 20, 20, 24, 24, 8],
	'Pinot Gris': [10, 56, 22, 9, 3, 0],
	Riesling: [6, 34, 30, 18, 10, 2],
	'Vidal Blanc': [0, 10, 14, 20, 30, 26],
};

/**
 * The review year that vintage ages are measured back from.
 *
 * @remarks
 * The measured vintage statistics are ages: a wine reviewed four years after its harvest has age
 * 4. The generator anchors them here, so the age profile reads as current; the few wines reviewed
 * in their harvest year carry this year itself.
 *
 * @internal
 */
export const VINTAGE_REFERENCE_YEAR = 2024;

/**
 * The year non-vintage wines carry: the year after the youngest possible vintage, the same way the
 * local real-corpus import marks them. The vintage filter can select it, and no harvest year
 * collides with it.
 *
 * @internal
 */
export const NON_VINTAGE_YEAR = VINTAGE_REFERENCE_YEAR + 1;
