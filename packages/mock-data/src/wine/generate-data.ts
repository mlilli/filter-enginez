/**
 * Curated reference data for the procedural wine generator (`./generate.ts`).
 *
 * @remarks
 * Split out of `generate.ts` purely to keep both files under the 500-line cap. These are the
 * factual / non-copyrightable reference lists the generator weaves together — varietal pools,
 * the origin hierarchy, per-varietal tasting-note typicality, and color/body/sweetness weight
 * tables. Real varietal + region names are factual (varietal is a taxonomic identifier;
 * region names are geographic). Distribution weights reflect approximate market share so the
 * generated dataset has the same skew real Wine Enthusiast reviews show (Cabernet +
 * Chardonnay + Pinot Noir dominate; obscure varietals are rare).
 *
 * @packageDocumentation
 */

import type {
	WineBody,
	WineColor,
	WineOrigin,
	WineSweetness,
} from './types.js';

/**
 * Varietal pool with weights — roughly mirrors Wine Enthusiast review-volume distribution.
 *
 * @internal
 */
export const VARIETALS_WITH_WEIGHTS: readonly (readonly [string, number])[] = [
	['Cabernet Sauvignon', 18],
	['Chardonnay', 14],
	['Pinot Noir', 12],
	['Sauvignon Blanc', 9],
	['Merlot', 8],
	['Syrah', 7],
	['Riesling', 6],
	['Zinfandel', 5],
	['Malbec', 4],
	['Tempranillo', 4],
	['Sangiovese', 4],
	['Pinot Gris', 3],
	['Grenache', 3],
	['Gewürztraminer', 1],
	['Nebbiolo', 1],
	['Albariño', 1],
];

/**
 * One entry in the origin hierarchy. Each origin carries its `WineOrigin`, the typical
 * designation for that subregion (Grand Cru / DOCG / AVA / etc.), and a per-region typical-
 * varietal weighting so the generator produces sensible wine-region pairings — Bordeaux
 * Left Bank ships Cabernet Sauvignon, Barolo ships Nebbiolo, Champagne ships sparkling
 * Chardonnay + Pinot Noir, instead of the prior generator's surreal "Cabernet from Chianti"
 * combinations.
 *
 * @internal
 */
export interface OriginEntry {
	readonly designation: string;
	readonly origin: WineOrigin;
	/**
	 * Typical varietals for this region, with relative weights. Picking is biased ~80% toward
	 * this region-specific pool and ~20% toward the global pool, so atypical wines still
	 * occasionally appear (real-world data has outliers too — Italian wineries making Cab,
	 * Napa producers planting Nebbiolo).
	 */
	readonly typicalVarietals: readonly (readonly [string, number])[];
	/**
	 * Optional color override for this region. When set, wines from this origin always get
	 * this color regardless of the varietal's default — used for Champagne (Chardonnay +
	 * Pinot Noir → `sparkling`, not `white` / `red`).
	 */
	readonly colorOverride?: WineColor;
}

/**
 * Origin hierarchy with designations + region-typical varietal weights. Five well-known
 * wine countries with realistic province → region → subregion cascades.
 *
 * @internal
 */
export const ORIGIN_HIERARCHY: readonly OriginEntry[] = [
	// ─── France ────────────────────────────────────────────────────────────
	{
		designation: 'Grand Cru Classé',
		origin: { country: 'France', province: 'Bordeaux', region: 'Left Bank', subregion: 'Pauillac' },
		typicalVarietals: [['Cabernet Sauvignon', 0.55], ['Merlot', 0.35], ['Cabernet Franc', 0.10]],
	},
	{
		designation: 'Cru Bourgeois',
		origin: { country: 'France', province: 'Bordeaux', region: 'Left Bank', subregion: 'Saint-Estèphe' },
		typicalVarietals: [['Cabernet Sauvignon', 0.50], ['Merlot', 0.40], ['Cabernet Franc', 0.10]],
	},
	{
		designation: 'Grand Cru',
		origin: { country: 'France', province: 'Bordeaux', region: 'Right Bank', subregion: 'Saint-Émilion' },
		typicalVarietals: [['Merlot', 0.65], ['Cabernet Franc', 0.30], ['Cabernet Sauvignon', 0.05]],
	},
	{
		designation: 'Village',
		origin: { country: 'France', province: 'Burgundy', region: 'Côte de Nuits', subregion: 'Gevrey-Chambertin' },
		typicalVarietals: [['Pinot Noir', 0.95], ['Chardonnay', 0.05]],
	},
	{
		designation: 'Premier Cru',
		origin: { country: 'France', province: 'Burgundy', region: 'Côte de Beaune', subregion: 'Meursault' },
		typicalVarietals: [['Chardonnay', 0.90], ['Pinot Noir', 0.10]],
	},
	{
		designation: 'AOC',
		origin: { country: 'France', province: 'Rhône', region: 'Northern Rhône', subregion: 'Côte-Rôtie' },
		typicalVarietals: [['Syrah', 0.95], ['Viognier', 0.05]],
	},
	{
		designation: 'AOC',
		origin: { country: 'France', province: 'Rhône', region: 'Southern Rhône', subregion: 'Châteauneuf-du-Pape' },
		typicalVarietals: [['Grenache', 0.60], ['Syrah', 0.25], ['Mourvèdre', 0.15]],
	},
	{
		designation: 'AOC',
		origin: { country: 'France', province: 'Loire', region: 'Central Loire', subregion: 'Sancerre' },
		typicalVarietals: [['Sauvignon Blanc', 0.90], ['Pinot Noir', 0.10]],
	},
	{
		colorOverride: 'sparkling',
		designation: 'Grand Cru',
		origin: { country: 'France', province: 'Champagne', region: 'Montagne de Reims', subregion: '' },
		typicalVarietals: [['Chardonnay', 0.40], ['Pinot Noir', 0.40], ['Pinot Meunier', 0.20]],
	},
	// ─── Italy ─────────────────────────────────────────────────────────────
	{
		designation: 'DOCG',
		origin: { country: 'Italy', province: 'Tuscany', region: 'Chianti', subregion: 'Chianti Classico' },
		typicalVarietals: [['Sangiovese', 0.85], ['Cabernet Sauvignon', 0.10], ['Merlot', 0.05]],
	},
	{
		designation: 'Brunello DOCG',
		origin: { country: 'Italy', province: 'Tuscany', region: 'Montalcino', subregion: '' },
		typicalVarietals: [['Sangiovese', 0.95], ['Cabernet Sauvignon', 0.05]],
	},
	{
		designation: 'DOCG',
		origin: { country: 'Italy', province: 'Piedmont', region: 'Langhe', subregion: 'Barolo' },
		typicalVarietals: [['Nebbiolo', 0.98], ['Barbera', 0.02]],
	},
	{
		designation: 'DOCG',
		origin: { country: 'Italy', province: 'Piedmont', region: 'Langhe', subregion: 'Barbaresco' },
		typicalVarietals: [['Nebbiolo', 0.97], ['Barbera', 0.03]],
	},
	{
		designation: 'DOCG',
		origin: { country: 'Italy', province: 'Veneto', region: 'Valpolicella', subregion: 'Amarone' },
		typicalVarietals: [['Corvina', 0.70], ['Rondinella', 0.25], ['Sangiovese', 0.05]],
	},
	{
		designation: 'DOC',
		origin: { country: 'Italy', province: 'Sicily', region: 'Etna', subregion: '' },
		typicalVarietals: [['Nerello Mascalese', 0.65], ['Carricante', 0.20], ['Nero d\'Avola', 0.15]],
	},
	// ─── United States ────────────────────────────────────────────────────
	{
		designation: 'AVA',
		origin: { country: 'United States', province: 'California', region: 'Napa Valley', subregion: 'Oakville' },
		typicalVarietals: [['Cabernet Sauvignon', 0.75], ['Merlot', 0.15], ['Chardonnay', 0.10]],
	},
	{
		designation: 'AVA',
		origin: { country: 'United States', province: 'California', region: 'Napa Valley', subregion: 'Rutherford' },
		typicalVarietals: [['Cabernet Sauvignon', 0.70], ['Merlot', 0.20], ['Chardonnay', 0.10]],
	},
	{
		designation: 'AVA',
		origin: { country: 'United States', province: 'California', region: 'Sonoma County', subregion: 'Russian River Valley' },
		typicalVarietals: [['Pinot Noir', 0.50], ['Chardonnay', 0.45], ['Zinfandel', 0.05]],
	},
	{
		designation: 'AVA',
		origin: { country: 'United States', province: 'California', region: 'Sonoma County', subregion: 'Dry Creek Valley' },
		typicalVarietals: [['Zinfandel', 0.55], ['Cabernet Sauvignon', 0.25], ['Sauvignon Blanc', 0.20]],
	},
	{
		designation: 'AVA',
		origin: { country: 'United States', province: 'Oregon', region: 'Willamette Valley', subregion: 'Dundee Hills' },
		typicalVarietals: [['Pinot Noir', 0.80], ['Chardonnay', 0.15], ['Pinot Gris', 0.05]],
	},
	{
		designation: 'AVA',
		origin: { country: 'United States', province: 'Washington', region: 'Columbia Valley', subregion: 'Walla Walla' },
		typicalVarietals: [['Cabernet Sauvignon', 0.40], ['Syrah', 0.30], ['Merlot', 0.30]],
	},
	// ─── Spain ─────────────────────────────────────────────────────────────
	{
		designation: 'DOCa',
		origin: { country: 'Spain', province: 'La Rioja', region: 'Rioja Alta', subregion: '' },
		typicalVarietals: [['Tempranillo', 0.85], ['Grenache', 0.15]],
	},
	{
		designation: 'DO',
		origin: { country: 'Spain', province: 'Castilla y León', region: 'Ribera del Duero', subregion: '' },
		typicalVarietals: [['Tempranillo', 0.95], ['Cabernet Sauvignon', 0.05]],
	},
	{
		designation: 'DO',
		origin: { country: 'Spain', province: 'Galicia', region: 'Rías Baixas', subregion: '' },
		typicalVarietals: [['Albariño', 0.95], ['Treixadura', 0.05]],
	},
	// ─── Argentina ────────────────────────────────────────────────────────
	{
		designation: 'GI',
		origin: { country: 'Argentina', province: 'Mendoza', region: 'Uco Valley', subregion: 'Tupungato' },
		typicalVarietals: [['Malbec', 0.75], ['Cabernet Sauvignon', 0.15], ['Chardonnay', 0.10]],
	},
	{
		designation: 'GI',
		origin: { country: 'Argentina', province: 'Mendoza', region: 'Luján de Cuyo', subregion: '' },
		typicalVarietals: [['Malbec', 0.80], ['Cabernet Sauvignon', 0.20]],
	},
];

/**
 * Varietal-typicality table — which tasting-note descriptors appear most often for each
 * varietal. Used by the generator to pick 3-6 tasting notes per wine in a way that doesn't
 * produce "Sauvignon Blanc with leather and tobacco" nonsense.
 *
 * @internal
 */
export const TASTING_NOTES_BY_VARIETAL: Readonly<Record<string, readonly string[]>> = {
	Albariño: ['lemon', 'peach', 'salt', 'sea spray', 'mineral'],
	Barbera: ['cherry', 'plum', 'high acidity', 'spice'],
	// New region-specific varietals
	'Cabernet Franc': ['raspberry', 'bell pepper', 'graphite', 'violet', 'tobacco'],
	'Cabernet Sauvignon': ['blackberry', 'cassis', 'tobacco', 'leather', 'cedar', 'graphite', 'dark chocolate', 'eucalyptus'],
	Carricante: ['lemon', 'mineral', 'volcanic ash', 'green apple'],
	Chardonnay: ['apple', 'pear', 'butter', 'vanilla', 'toast', 'lemon curd', 'crème brûlée'],
	Corvina: ['sour cherry', 'almond', 'herbs', 'cinnamon'],
	Gewürztraminer: ['lychee', 'rose', 'ginger', 'orange peel', 'honey'],
	Grenache: ['strawberry', 'raspberry', 'white pepper', 'herbs de Provence'],
	Malbec: ['blackberry', 'plum', 'cocoa', 'violet', 'leather', 'vanilla'],
	Merlot: ['plum', 'cherry', 'chocolate', 'mocha', 'fig', 'baking spice', 'soft tannins'],
	Mourvèdre: ['blackberry', 'gamy', 'earth', 'black pepper', 'leather'],
	Nebbiolo: ['rose', 'tar', 'cherry', 'truffle', 'leather', 'high tannins'],
	'Nerello Mascalese': ['red cherry', 'volcanic mineral', 'herbs', 'orange peel'],
	'Nero d\'Avola': ['black plum', 'tobacco', 'spice', 'licorice'],
	'Pinot Gris': ['pear', 'apple', 'almond', 'honeysuckle', 'spice'],
	'Pinot Meunier': ['strawberry', 'apple', 'biscuit', 'brioche'],
	'Pinot Noir': ['cherry', 'raspberry', 'forest floor', 'mushroom', 'rose petal', 'cola', 'silky tannins'],
	Riesling: ['lime', 'green apple', 'petrol', 'jasmine', 'honey', 'slate'],
	Rondinella: ['cherry', 'rose', 'spice'],
	Sangiovese: ['sour cherry', 'tomato leaf', 'leather', 'tobacco', 'earth'],
	'Sauvignon Blanc': ['grapefruit', 'gooseberry', 'cut grass', 'lime', 'mineral', 'passionfruit'],
	Syrah: ['blueberry', 'black pepper', 'olive', 'smoked meat', 'violet', 'licorice'],
	Tempranillo: ['cherry', 'fig', 'leather', 'vanilla', 'dill'],
	Treixadura: ['pear', 'lemon zest', 'almond', 'floral'],
	Viognier: ['apricot', 'honeysuckle', 'peach', 'orange blossom'],
	Zinfandel: ['raspberry', 'jam', 'black pepper', 'baking spice', 'tobacco'],
};

/**
 * Map a varietal to its likely wine color. Used to keep color/varietal pairings honest.
 *
 * @internal
 */
export const COLOR_BY_VARIETAL: Readonly<Record<string, WineColor>> = {
	Albariño: 'white',
	Barbera: 'red',
	'Cabernet Franc': 'red',
	// Reds
	'Cabernet Sauvignon': 'red',
	Carricante: 'white',
	// Whites
	Chardonnay: 'white',
	Corvina: 'red',
	Gewürztraminer: 'white',
	Grenache: 'red',
	Malbec: 'red',
	Merlot: 'red',
	Mourvèdre: 'red',
	Nebbiolo: 'red',
	'Nerello Mascalese': 'red',
	'Nero d\'Avola': 'red',
	'Pinot Gris': 'white',
	'Pinot Meunier': 'white',
	'Pinot Noir': 'red',
	Riesling: 'white',
	Rondinella: 'red',
	Sangiovese: 'red',
	'Sauvignon Blanc': 'white',
	Syrah: 'red',
	Tempranillo: 'red',
	Treixadura: 'white',
	Viognier: 'white',
	Zinfandel: 'red',
};

/**
 * Body weights per color — red wines skew heavier, whites lighter. These weights drive the
 * body-classification distribution so the resulting dataset matches real-world expectations.
 *
 * @internal
 */
export const BODY_WEIGHTS_BY_COLOR: Readonly<Record<WineColor, readonly (readonly [WineBody, number])[]>> = {
	dessert: [['light', 1], ['medium-light', 1], ['medium', 2], ['medium-full', 3], ['full', 5]],
	fortified: [['light', 1], ['medium-light', 1], ['medium', 2], ['medium-full', 3], ['full', 5]],
	red: [['light', 1], ['medium-light', 2], ['medium', 4], ['medium-full', 5], ['full', 3]],
	rosé: [['light', 5], ['medium-light', 4], ['medium', 2], ['medium-full', 1], ['full', 1]],
	sparkling: [['light', 5], ['medium-light', 4], ['medium', 2], ['medium-full', 1], ['full', 1]],
	white: [['light', 3], ['medium-light', 4], ['medium', 5], ['medium-full', 2], ['full', 1]],
};

/**
 * Sweetness weights per color — most wine is dry; dessert and certain whites skew sweet.
 *
 * @internal
 */
export const SWEETNESS_WEIGHTS_BY_COLOR: Readonly<Record<WineColor, readonly (readonly [WineSweetness, number])[]>> = {
	dessert: [['bone-dry', 0], ['dry', 0], ['off-dry', 1], ['medium-sweet', 3], ['sweet', 5], ['dessert', 8]],
	fortified: [['bone-dry', 1], ['dry', 2], ['off-dry', 2], ['medium-sweet', 3], ['sweet', 4], ['dessert', 3]],
	red: [['bone-dry', 6], ['dry', 10], ['off-dry', 2], ['medium-sweet', 1], ['sweet', 0], ['dessert', 0]],
	rosé: [['bone-dry', 5], ['dry', 8], ['off-dry', 3], ['medium-sweet', 1], ['sweet', 0], ['dessert', 0]],
	sparkling: [['bone-dry', 3], ['dry', 6], ['off-dry', 4], ['medium-sweet', 2], ['sweet', 1], ['dessert', 0]],
	white: [['bone-dry', 3], ['dry', 8], ['off-dry', 4], ['medium-sweet', 3], ['sweet', 2], ['dessert', 0]],
};

/**
 * Winery name prefixes — generates plausible winery names by combining family names with
 * vineyard descriptors. ~25 × 12 = 300 unique combos, plenty for 1k records.
 *
 * @internal
 */
export const WINERY_PREFIXES: readonly string[] = [
	'Hartmann',
	'Beaumont',
	'Aldridge',
	'Castellini',
	'Vasquez',
	'Mercer',
	'Holloway',
	'Whitfield',
	'Caruso',
	'Devereaux',
	'Fontaine',
	'Greenwood',
	'Halstead',
	'Iversen',
	'Jameson',
	'Kellerman',
	'Larkspur',
	'Marchetti',
	'Nightingale',
	'Oakhurst',
	'Pemberton',
	'Quinones',
	'Ravenscroft',
	'Sutherland',
	'Tarrington',
	'Vandermark',
	'Westmoreland',
];

/**
 * Winery suffixes — descriptors of place / style.
 *
 * @internal
 */
export const WINERY_SUFFIXES: readonly string[] = [
	'Estate',
	'Vineyards',
	'Cellars',
	'Winery',
	'Reserve',
	'Family Wines',
	'Domaine',
	'Bodega',
	'Hill',
	'Ridge',
	'Crossing',
	'Springs',
];

/**
 * Marketing-copy templates the generator weaves with the wine's varietal + tasting notes.
 * Three templates, picked randomly per wine; the resulting `description` field exercises the
 * TextSearchRule + FuzzySearchRule paths.
 *
 * @internal
 */
export const DESCRIPTION_TEMPLATES: readonly string[] = [
	'A {body}-bodied {color} {varietal} from {region} showing notes of {notes}. Drink now through {drinkBy}.',
	'This {vintage} {varietal} reveals {notes} on the palate, with a {body} mouthfeel typical of {region}.',
	'{winery} crafts a quietly impressive {color} {varietal}: {notes}, finishing with the characteristic poise of {subregion}.',
];

/**
 * Probability that a wine's varietal comes from the OUTLIER pool (the global typicality
 * distribution) rather than the region's typical-varietal pool. Set to 5% — high enough
 * that the dataset contains a few "Cab from Burgundy"-style anomalies (which DO exist in
 * the real world), low enough that signature-region pairings dominate.
 *
 * @internal
 */
export const VARIETAL_OUTLIER_PROBABILITY = 0.05;
