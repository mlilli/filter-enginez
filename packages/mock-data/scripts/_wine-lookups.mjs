/**
 * `_wine-lookups.mjs` — static lookup tables shared by `import-kaggle-wine.mjs`.
 *
 * @remarks
 * The importer's own tables, kept in plain JavaScript so the import script stays self-contained
 * (it must run before the package is built). They are not the synthetic generator's: that one's
 * color, alcohol, body and sweetness models live in `src/wine/generate-*.ts`. They sit in their
 * own module purely to keep `import-kaggle-wine.mjs` under the 500-line cap; the values here are
 * the source of truth for the script's color/body/sweetness synthesis and tasting-note
 * extraction, and MUST stay byte-identical to keep the generated JSON stable.
 *
 * @packageDocumentation
 */

/**
 * Variety (Kaggle column) → wine color. Covers the common varieties that show up in the
 * Kaggle Wine Reviews dataset. Unknown varieties fall back to 'red' via the
 * `colorFromVariety()` helper.
 *
 * @internal
 */
export const COLOR_BY_VARIETY = {
	Aglianico: 'red', Albarino: 'white', Albariño: 'white',
	Barbera: 'red', 'Bordeaux-style Red Blend': 'red', 'Bordeaux-style White Blend': 'white', 'Cabernet Franc': 'red',
	// Reds
	'Cabernet Sauvignon': 'red', 'Cabernet Sauvignon-Merlot': 'red', Carignan: 'red',
	Carignane: 'red', Carmenère: 'red', Carricante: 'white',
	Cava: 'sparkling', 'Champagne Blend': 'sparkling', // Whites
	Chardonnay: 'white',
	'Chenin Blanc': 'white', Cinsault: 'red', Cortese: 'white',
	Corvina: 'red', Falanghina: 'white', Gamay: 'red',
	Garganega: 'white', Garnacha: 'red',
	Gewürztraminer: 'white', Grenache: 'red',
	'Grüner Veltliner': 'white', 'Ice Wine': 'dessert', Madeira: 'fortified',
	Malbec: 'red', Marsanne: 'white', Merlot: 'red', Monastrell: 'red',
	Moscato: 'dessert', 'Moscato d\'Asti': 'dessert',
	Mourvèdre: 'red', Nebbiolo: 'red', 'Nerello Mascalese': 'red',
	"Nero d'Avola": 'red', 'Petite Sirah': 'red', 'Petit Verdot': 'red',
	'Pinot Grigio': 'white', 'Pinot Gris': 'white', 'Pinot Meunier': 'white',
	'Pinot Noir': 'red', 'Pinot Noir Rosé': 'rosé', Port: 'fortified',
	Primitivo: 'red', Prosecco: 'sparkling', 'Red Blend': 'red',
	'Rhône-style Red Blend': 'red', 'Rhône-style White Blend': 'white', Riesling: 'white',
	Rondinella: 'red', Rose: 'rosé', // Rosé / sparkling / dessert / fortified
	Rosé: 'rosé',
	Roussanne: 'white', Sangiovese: 'red',
	Sauternes: 'dessert', 'Sauvignon Blanc': 'white', Sémillon: 'white',
	Sherry: 'fortified', Shiraz: 'red', 'Sparkling Blend': 'sparkling',
	Syrah: 'red', Tannat: 'red',
	Tempranillo: 'red', 'Touriga Nacional': 'red',
	Trebbiano: 'white', Treixadura: 'white', Verdejo: 'white',
	Vermentino: 'white',
	Vermouth: 'fortified', Viognier: 'white',
	'White Blend': 'white', Zinfandel: 'red',
};

/** Body weights per color — for synthesizing body. @internal */
export const BODY_WEIGHTS_BY_COLOR = {
	dessert: [['light', 1], ['medium-light', 1], ['medium', 2], ['medium-full', 3], ['full', 5]],
	fortified: [['light', 1], ['medium-light', 1], ['medium', 2], ['medium-full', 3], ['full', 5]],
	red: [['light', 1], ['medium-light', 2], ['medium', 4], ['medium-full', 5], ['full', 3]],
	rosé: [['light', 5], ['medium-light', 4], ['medium', 2], ['medium-full', 1], ['full', 1]],
	sparkling: [['light', 5], ['medium-light', 4], ['medium', 2], ['medium-full', 1], ['full', 1]],
	white: [['light', 3], ['medium-light', 4], ['medium', 5], ['medium-full', 2], ['full', 1]],
};

/** Sweetness weights per color — for synthesizing sweetness. @internal */
export const SWEETNESS_WEIGHTS_BY_COLOR = {
	dessert: [['bone-dry', 0], ['dry', 0], ['off-dry', 1], ['medium-sweet', 3], ['sweet', 5], ['dessert', 8]],
	fortified: [['bone-dry', 1], ['dry', 2], ['off-dry', 2], ['medium-sweet', 3], ['sweet', 4], ['dessert', 3]],
	red: [['bone-dry', 6], ['dry', 10], ['off-dry', 2], ['medium-sweet', 1], ['sweet', 0], ['dessert', 0]],
	rosé: [['bone-dry', 5], ['dry', 8], ['off-dry', 3], ['medium-sweet', 1], ['sweet', 0], ['dessert', 0]],
	sparkling: [['bone-dry', 3], ['dry', 6], ['off-dry', 4], ['medium-sweet', 2], ['sweet', 1], ['dessert', 0]],
	white: [['bone-dry', 3], ['dry', 8], ['off-dry', 4], ['medium-sweet', 3], ['sweet', 2], ['dessert', 0]],
};

/**
 * Common tasting-note descriptors to look for in the real Wine Enthusiast review prose.
 * Each note that appears in the description gets added to the wine's `tastingNotes` array,
 * which powers the engine's similarity search + the dedicated tasting-notes filter.
 *
 * @internal
 */
export const TASTING_NOTE_VOCAB = [
	'blackberry',
	'cassis',
	'tobacco',
	'leather',
	'cedar',
	'graphite',
	'chocolate',
	'mocha',
	'eucalyptus',
	'plum',
	'cherry',
	'fig',
	'cherry',
	'raspberry',
	'forest floor',
	'mushroom',
	'rose petal',
	'cola',
	'blueberry',
	'black pepper',
	'olive',
	'smoked meat',
	'violet',
	'licorice',
	'cocoa',
	'vanilla',
	'jam',
	'baking spice',
	'sour cherry',
	'tomato leaf',
	'earth',
	'dill',
	'tar',
	'truffle',
	'strawberry',
	'white pepper',
	'herbs',
	'apple',
	'pear',
	'butter',
	'toast',
	'lemon curd',
	'crème brûlée',
	'grapefruit',
	'gooseberry',
	'cut grass',
	'grass',
	'lime',
	'mineral',
	'passionfruit',
	'green apple',
	'petrol',
	'jasmine',
	'honey',
	'slate',
	'almond',
	'honeysuckle',
	'lychee',
	'ginger',
	'orange peel',
	'lemon',
	'peach',
	'salt',
	'sea spray',
	'bell pepper',
	'apricot',
	'orange blossom',
	'biscuit',
	'brioche',
	'volcanic',
	'oak',
	'spice',
	'tannin',
	'tannins',
	'acidity',
	'currant',
	'pomegranate',
	'guava',
	'pineapple',
	'tropical',
	'citrus',
];
