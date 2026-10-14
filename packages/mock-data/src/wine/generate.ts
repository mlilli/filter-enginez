/**
 * Synthetic wine generator: deterministic, realistic `Wine` records at any count, in Node or a
 * browser Web Worker.
 *
 * @remarks
 * Every wine this package ships comes from here. None is a real review: the generator samples from
 * aggregate statistics measured on the public Kaggle "Wine Reviews" dataset (`./generate-origins.ts`,
 * `./generate-profile.ts`) and from hand-curated domain tables (`./generate-data.ts`), and writes
 * its own producer names and tasting notes (`./generate-names.ts`, `./generate-text.ts`).
 *
 * **One stream, every tier.** Record `i` depends only on the seed and `i`, never on how many records
 * were asked for. The 10k default tier is therefore exactly the first 10,000 records of the 150k full
 * tier (only the `tier` stamp differs), and any range can be generated on its own — a worker can
 * produce the full tier in chunks and report progress between them.
 *
 * **Shares are exact at full-tier size.** Origin and varietal are not drawn independently per
 * record. The generator apportions {@link FULL_WINE_TIER_SIZE} records across every measured
 * (origin leaf, varietal) pair by largest remainder, then deals them out in a seeded shuffle. At
 * 150k every leaf and every varietal therefore appears at its measured share, the rarest at least
 * once, and any prefix (such as the default tier) is a uniform random sample of that allocation.
 * Counts beyond the full tier continue with a freshly shuffled second allocation.
 *
 * **Per-record fields** are then drawn from the record's own seeded random source:
 *
 *   - **points** from the measured score histogram, leaning by country and varietal;
 *   - **price** from the measured price-by-score curve, leaning by country and varietal, with the
 *     measured heavy right tail;
 *   - **vintage** from the measured age profile of the wine's color, or non-vintage at the measured
 *     share (most Champagne and Port);
 *   - **sweetness, alcohol and body** from the domain tables, alcohol leaning by sweetness and body
 *     rising with alcohol;
 *   - **winery** from a per-country pool sized by the measured producer count, a few producers
 *     accounting for many wines as in the real market;
 *   - **designation** at the measured share, **tasting notes and description** from the measured
 *     descriptor frequencies of the wine's varietal.
 *
 * **Worker-safe and portable.** This module and everything it imports are plain computation: no
 * `node:` modules, no file or network access, no top-level `await`, no browser globals. Import it
 * from `@filter-enginez/mock-data/wine/generator` in a Web Worker without pulling in the corpus
 * loaders. Every value is computed with correctly rounded arithmetic only (`./generate-math.ts`),
 * so a seed gives the same records in Node and in any browser engine.
 *
 * @packageDocumentation
 */

import type { DatasetTier } from '../shared.js';
import type { Wine, WineColor, WineOrigin, WineSweetness } from './types.js';

import { mulberry32, randomInt, type SeededRng, slugify } from '../_generation/random.js';
import { FULL_WINE_TIER_SIZE } from '../tier-sizes.js';
import {
	ABV_LEAN_BY_COUNTRY,
	ABV_LEAN_BY_SWEETNESS,
	ABV_LEAN_BY_VARIETAL,
	ABV_PROFILE_BY_COLOR,
	BODY_CENTER_BY_COLOR,
	BODY_LEAN_BY_VARIETAL,
	BODY_NOISE_STANDARD_DEVIATION,
	BODY_SCALE,
	BODY_STEPS_PER_ABV_POINT,
	NON_VINTAGE_YEAR,
	SWEETNESS_SCALE,
	SWEETNESS_WEIGHTS_BY_COLOR,
	SWEETNESS_WEIGHTS_BY_VARIETAL,
	VINTAGE_REFERENCE_YEAR,
} from './generate-data.js';
import {
	apportionByLargestRemainder,
	cumulativeDistribution,
	deriveSeed,
	firstIndexAtOrAbove,
	interpolateQuantile,
	pickByWeights,
	portableExp,
	portableStandardNormal,
	roundToTenthWithin,
} from './generate-math.js';
import { designationFor, wineryName } from './generate-names.js';
import { WINE_ORIGIN_LEAF_ROWS, WINE_VARIETAL_ROWS } from './generate-origins.js';
import {
	DESIGNATION_SHARE,
	LOG_PRICE_BY_POINTS,
	LOG_PRICE_RESIDUAL_QUANTILES_BY_SCORE_BAND,
	MIN_POINTS,
	POINTS_LATENT_THRESHOLDS,
	POINTS_WITHIN_STANDARD_DEVIATION,
	PRICE_BOUNDS_USD,
	VINTAGE_PROFILE_BY_COLOR,
	WINE_COUNTRY_ROWS,
} from './generate-profile.js';
import { chooseDescriptors, writeTastingText } from './generate-text.js';

/** The seed of the canonical dataset: the one every tier, test and demo uses. */
export const WINE_GENERATOR_SEED = 0xC4B3A4E7;

/**
 * How many producers each country's pool holds per producer the measured reviews name there.
 * Larger than one because a popularity-skewed draw leaves part of any pool unused.
 */
const WINERY_POOL_SCALE = 1.25;


/** Days of `lastUpdated` spread before {@link LAST_UPDATED_REFERENCE_MS}. */
const LAST_UPDATED_SPREAD_DAYS = 730;

/** Fixed reference instant for `lastUpdated`, so records do not change as wall-clock time passes. */
const LAST_UPDATED_REFERENCE_MS = Date.UTC(2026, 4, 1);

/** Most times a price below the measured minimum is redrawn before it is clamped. */
const MAX_PRICE_REDRAWS = 8;

/** Milliseconds in a day. */
const MS_PER_DAY = 86_400_000;

/** Cell color-override codes in the origin table. */
const COLOR_BY_CODE: Readonly<Record<string, WineColor>> = { d: 'dessert', f: 'fortified', s: 'sparkling' };

/** A varietal with every per-varietal adjustment resolved. */
interface VarietalModel {
	readonly abvLean: number;
	readonly bodyLean: number;
	readonly color: WineColor;
	readonly logPriceOffset: number;
	readonly name: string;
	readonly pointsShift: number;
	readonly sweetnessWeights: undefined | readonly number[];
}

/** An origin leaf with its shared `origin` object and country-level adjustments. */
interface LeafModel {
	readonly abvLean: number;
	readonly country: string;
	readonly logPriceOffset: number;
	readonly origin: WineOrigin;
	readonly originId: string;
	readonly pointsShift: number;
	/** Region for the wine name's parenthesis: the deepest of region and province that exists. */
	readonly titleRegion: string;
	readonly wineryPoolSize: number;
}

/** A vintage-age distribution for one color. */
interface VintageModel {
	readonly ages: Int32Array;
	readonly cumulative: Float64Array;
	readonly nonVintageShare: number;
}

/** Everything parsed from the statistics tables, built once on first use. */
interface GeneratorModel {
	/** Each cell's color override (sparkling Chardonnay from Champagne), or `undefined` for the varietal's own. */
	readonly cellColors: readonly (WineColor | undefined)[];
	/** Measured count of each (leaf, varietal) cell. */
	readonly cellCounts: Uint32Array;
	/** Each cell's origin leaf, as an index into `leaves`. */
	readonly cellLeaves: Uint16Array;
	/** Each cell's varietal, as an index into `varietals`. */
	readonly cellVarietals: Uint16Array;
	readonly leaves: readonly LeafModel[];
	readonly varietals: readonly VarietalModel[];
	readonly vintageByColor: ReadonlyMap<WineColor, VintageModel>;
}

/** The parsed model; `null` until the first record is generated. */
let generatorModel: GeneratorModel | null = null;

/**
 * Parse the vintage profile of one color.
 *
 * @param ageCounts - Space-separated `age:count` pairs.
 * @param nonVintageShare - Share of the color's wines without a vintage.
 * @returns The sampling model.
 */
function parseVintageModel(ageCounts: string, nonVintageShare: number): VintageModel {
	const pairs = ageCounts.split(' ').map((pair) => pair.split(':').map(Number));

	return {
		ages: Int32Array.from(pairs.map(([age]) => age ?? 0)),
		cumulative: cumulativeDistribution(pairs.map(([, count]) => count ?? 0)),
		nonVintageShare,
	};
}

/**
 * Build the generator model from the statistics tables.
 *
 * @returns The parsed model.
 */
function buildGeneratorModel(): GeneratorModel {
	const countries = new Map(WINE_COUNTRY_ROWS.map(([country, pointsShift, logPriceOffset, wineryCount]) => [
		country,
		{ logPriceOffset, pointsShift, wineryPoolSize: Math.max(1, Math.ceil(wineryCount * WINERY_POOL_SCALE)) },
	]));
	const varietals = WINE_VARIETAL_ROWS.map(([name, color, pointsShift, logPriceOffset]): VarietalModel => ({
		abvLean: ABV_LEAN_BY_VARIETAL[name] ?? 0,
		bodyLean: BODY_LEAN_BY_VARIETAL[name] ?? 0,
		color,
		logPriceOffset,
		name,
		pointsShift,
		sweetnessWeights: SWEETNESS_WEIGHTS_BY_VARIETAL[name],
	}));
	const leaves: LeafModel[] = [];
	const cellLeaves: number[] = [];
	const cellVarietals: number[] = [];
	const cellCounts: number[] = [];
	const cellColors: (WineColor | undefined)[] = [];

	WINE_ORIGIN_LEAF_ROWS.forEach(([country, province, region, subregion, cells], leafIndex) => {
		const countryModel = countries.get(country) ?? { logPriceOffset: 0, pointsShift: 0, wineryPoolSize: 1 };

		leaves.push({
			abvLean: ABV_LEAN_BY_COUNTRY[country] ?? 0,
			country,
			logPriceOffset: countryModel.logPriceOffset,
			origin: Object.freeze({ country, province, region, subregion }),
			originId: [country, province, region, subregion].filter((level) => level.length > 0).join('|'),
			pointsShift: countryModel.pointsShift,
			titleRegion: region.length > 0 ? region : province,
			wineryPoolSize: countryModel.wineryPoolSize,
		});
		for (const cell of cells.split(' ')) {
			const [varietalIndex, count, colorCode] = cell.split(':');

			cellLeaves.push(leafIndex);
			cellVarietals.push(Number(varietalIndex));
			cellCounts.push(Number(count));
			cellColors.push(colorCode === undefined ? undefined : COLOR_BY_CODE[colorCode]);
		}
	});

	const vintageByColor = new Map<WineColor, VintageModel>();

	for (const [color, profile] of Object.entries(VINTAGE_PROFILE_BY_COLOR)) {
		vintageByColor.set(color as WineColor, parseVintageModel(profile.ageCounts, profile.nonVintageShare));
	}

	return {
		cellColors,
		cellCounts: Uint32Array.from(cellCounts),
		cellLeaves: Uint16Array.from(cellLeaves),
		cellVarietals: Uint16Array.from(cellVarietals),
		leaves,
		varietals,
		vintageByColor,
	};
}

/**
 * The generator model, parsed on first use.
 *
 * @returns The shared model.
 */
function getGeneratorModel(): GeneratorModel {
	generatorModel ??= buildGeneratorModel();

	return generatorModel;
}

/** Salt that separates the schedule shuffle's random stream from every record's. */
const SCHEDULE_SALT = 0x5EED_CE11;

/** Cached cell schedules, keyed by `seed:epoch`. Normally holds one entry. */
const scheduleCache = new Map<string, Uint32Array>();

/** Most schedules kept at once; each is {@link FULL_WINE_TIER_SIZE} × 4 bytes. */
const MAX_CACHED_SCHEDULES = 4;

/**
 * The cell schedule for one epoch: which (leaf, varietal) cell each of the epoch's
 * {@link FULL_WINE_TIER_SIZE} records draws.
 *
 * @param seed - Generator seed.
 * @param epoch - Which block of {@link FULL_WINE_TIER_SIZE} records (0 for the full tier itself).
 * @returns Cell index per position in the epoch.
 */
function scheduleFor(seed: number, epoch: number): Uint32Array {
	const key = `${seed}:${epoch}`;
	const cached = scheduleCache.get(key);

	if (cached !== undefined) {
		return cached;
	}

	const model = getGeneratorModel();
	const allocation = apportionByLargestRemainder(model.cellCounts, FULL_WINE_TIER_SIZE);
	const schedule = new Uint32Array(FULL_WINE_TIER_SIZE);
	let position = 0;

	allocation.forEach((records, cell) => {
		schedule.fill(cell, position, position + records);
		position += records;
	});

	const rng = mulberry32(deriveSeed(seed ^ SCHEDULE_SALT, epoch));

	for (let index = schedule.length - 1; index > 0; index--) {
		const swapWith = Math.floor(rng() * (index + 1));
		const atIndex = schedule[index] ?? 0;

		schedule[index] = schedule[swapWith] ?? 0;
		schedule[swapWith] = atIndex;
	}

	if (scheduleCache.size >= MAX_CACHED_SCHEDULES) {
		scheduleCache.clear();
	}
	scheduleCache.set(key, schedule);

	return schedule;
}

/**
 * Draw a list price: the measured log-price curve at the score, the country and varietal lean, and
 * a residual from the score band's measured spread.
 *
 * @remarks
 * A draw below the cheapest measured price is redrawn rather than clamped, so no false spike forms
 * at the floor; after {@link MAX_PRICE_REDRAWS} attempts it is clamped after all.
 *
 * @param rng - The record's seeded random source.
 * @param points - The wine's score.
 * @param logPriceLean - The country's plus the varietal's natural-log price lean.
 * @returns The price in whole US dollars, within {@link PRICE_BOUNDS_USD}.
 */
function samplePriceUsd(rng: SeededRng, points: number, logPriceLean: number): number {
	const residualQuantiles = (LOG_PRICE_RESIDUAL_QUANTILES_BY_SCORE_BAND.find((band) => points <= band.maximumPoints)
		?? LOG_PRICE_RESIDUAL_QUANTILES_BY_SCORE_BAND.at(-1))?.quantiles ?? [];
	const expectedLogPrice = (LOG_PRICE_BY_POINTS[points - MIN_POINTS] ?? 0) + logPriceLean;
	let priceUsd = Math.round(portableExp(expectedLogPrice + interpolateQuantile(residualQuantiles, rng())));

	for (let redraw = 0; redraw < MAX_PRICE_REDRAWS && priceUsd < PRICE_BOUNDS_USD.min; redraw++) {
		priceUsd = Math.round(portableExp(expectedLogPrice + interpolateQuantile(residualQuantiles, rng())));
	}

	return Math.min(PRICE_BOUNDS_USD.max, Math.max(PRICE_BOUNDS_USD.min, priceUsd));
}

/**
 * Generate record `index` of the stream for `seed`.
 *
 * @param seed - Generator seed.
 * @param index - Stream position, from 0.
 * @param tier - Tier stamp for the record.
 * @returns The wine.
 */
function generateWineAt(seed: number, index: number, tier: DatasetTier): Wine {
	const model = getGeneratorModel();
	const cell = scheduleFor(seed, Math.floor(index / FULL_WINE_TIER_SIZE))[index % FULL_WINE_TIER_SIZE] ?? 0;
	const leaf = model.leaves[model.cellLeaves[cell] ?? 0] as LeafModel;
	const varietal = model.varietals[model.cellVarietals[cell] ?? 0] as VarietalModel;
	const color = model.cellColors[cell] ?? varietal.color;
	const rng = mulberry32(deriveSeed(seed, index));

	// Score: the measured histogram, leaning by country and varietal in standard-normal units.
	const latentScore = POINTS_WITHIN_STANDARD_DEVIATION * portableStandardNormal(rng) + leaf.pointsShift + varietal.pointsShift;
	const points = MIN_POINTS + firstIndexAtOrAbove(POINTS_LATENT_THRESHOLDS, latentScore);

	// Price: the measured log-price curve for that score, the country and varietal leans, and the
	// measured residual spread for the score's band, with its heavy right tail.
	const priceUsd = samplePriceUsd(rng, points, leaf.logPriceOffset + varietal.logPriceOffset);

	// Vintage: non-vintage at the color's measured share, otherwise the color's measured age.
	const vintageModel = model.vintageByColor.get(color) as VintageModel;
	const isNonVintage = rng() < vintageModel.nonVintageShare;
	const vintage = isNonVintage
		? NON_VINTAGE_YEAR
		: VINTAGE_REFERENCE_YEAR - (vintageModel.ages[firstIndexAtOrAbove(vintageModel.cumulative, rng())] ?? 0);

	// Sweetness, then alcohol (sugar left unfermented is alcohol that never formed), then body.
	const canBeSweet = color === 'white' || color === 'sparkling' || color === 'dessert';
	const sweetnessWeights = (canBeSweet ? varietal.sweetnessWeights : undefined) ?? SWEETNESS_WEIGHTS_BY_COLOR[color];
	const sweetness: WineSweetness = pickByWeights(rng, SWEETNESS_SCALE, sweetnessWeights);
	const abvProfile = ABV_PROFILE_BY_COLOR[color];
	const sweetnessLean = color === 'fortified' ? 0 : ABV_LEAN_BY_SWEETNESS[sweetness];
	const abv = roundToTenthWithin(
		abvProfile.mean + varietal.abvLean + leaf.abvLean + sweetnessLean + abvProfile.standardDeviation * portableStandardNormal(rng),
		abvProfile.minimum,
		abvProfile.maximum,
	);
	const bodyCenter = BODY_CENTER_BY_COLOR[color] + varietal.bodyLean + BODY_STEPS_PER_ABV_POINT * (abv - abvProfile.mean)
		+ BODY_NOISE_STANDARD_DEVIATION * portableStandardNormal(rng);
	const body = BODY_SCALE[Math.min(BODY_SCALE.length, Math.max(1, Math.round(bodyCenter))) - 1] ?? 'medium';

	// Producer: a popularity-skewed draw from the country's pool. Squaring the uniform draw gives the
	// top 1% of producers about a tenth of all wines, as in the measured reviews.
	const popularityDraw = rng();
	const winery = wineryName(leaf.country, Math.floor(leaf.wineryPoolSize * popularityDraw * popularityDraw));
	const designation = rng() < DESIGNATION_SHARE ? designationFor(rng, leaf.country, color) : '';

	// Tasting notes and description.
	const { description, tastingNotes } = writeTastingText(rng, {
		body,
		color,
		descriptorIndices: chooseDescriptors(rng, varietal.name, color, points),
		isNonVintage,
		place: leaf.titleRegion,
		points,
		varietal: varietal.name,
		vintage,
	});

	// "{Winery} {Vintage} {Designation} {Varietal} ({Region})": the review-title convention.
	const name = `${winery} ${isNonVintage ? 'NV' : String(vintage)}${designation.length > 0 ? ` ${designation}` : ''} ${varietal.name} (${leaf.titleRegion})`;
	const lastUpdated = new Date(LAST_UPDATED_REFERENCE_MS - randomInt(rng, 0, LAST_UPDATED_SPREAD_DAYS) * MS_PER_DAY).toISOString();

	return {
		abv,
		body,
		color,
		description,
		designation,
		id: `${slugify(name)}-${index}`,
		labelImage: `https://placehold.co/240x360/0b1220/22d3ee?text=${encodeURIComponent(varietal.name)}`,
		lastUpdated,
		name,
		origin: leaf.origin,
		originId: leaf.originId,
		points,
		priceUsd,
		sweetness,
		tastingNotes,
		tier,
		varietal: varietal.name,
		vintage,
		winery,
	};
}

/**
 * Generate records `startIndex` (inclusive) to `endIndex` (exclusive) of the wine stream.
 *
 * @remarks
 * Identical to `generateWines(endIndex, seed, tier).slice(startIndex)`, without generating the
 * records before `startIndex`. Use it to build a large tier in chunks, for example in a Web Worker
 * that reports progress between chunks.
 *
 * @param startIndex - First stream position, a non-negative integer.
 * @param endIndex - One past the last position, an integer no smaller than `startIndex`.
 * @param seed - 32-bit unsigned seed. Defaults to {@link WINE_GENERATOR_SEED}.
 * @param tier - Tier stamp for every record. Defaults to `'default'`.
 * @returns The records, in stream order.
 * @throws RangeError when the bounds are not integers with `0 <= startIndex <= endIndex`.
 */
export function generateWineRange(
	startIndex: number,
	endIndex: number,
	seed: number = WINE_GENERATOR_SEED,
	tier: DatasetTier = 'default',
): readonly Wine[] {
	if (!Number.isSafeInteger(startIndex) || !Number.isSafeInteger(endIndex) || startIndex < 0 || endIndex < startIndex) {
		throw new RangeError(`generateWineRange: expected integers 0 <= startIndex <= endIndex, got ${startIndex} and ${endIndex}.`);
	}

	const wines: Wine[] = [];

	for (let index = startIndex; index < endIndex; index++) {
		wines.push(generateWineAt(seed, index, tier));
	}

	return wines;
}

/**
 * Generate the first `count` records of the wine stream.
 *
 * @remarks
 * The default tier is `generateWines(DEFAULT_TIER_SIZE)`; the full tier is
 * `generateWines(FULL_WINE_TIER_SIZE, WINE_GENERATOR_SEED, 'full')`. A shorter run is always a
 * prefix of a longer one with the same seed.
 *
 * @param count - Number of records. Values below 1 give an empty array; fractions round up.
 * @param seed - 32-bit unsigned seed. Defaults to {@link WINE_GENERATOR_SEED}, the canonical dataset.
 * @param tier - Tier stamp for every record. Defaults to `'default'`.
 * @returns The records, in stream order.
 */
export function generateWines(count: number, seed: number = WINE_GENERATOR_SEED, tier: DatasetTier = 'default'): readonly Wine[] {
	return generateWineRange(0, count > 0 ? Math.ceil(count) : 0, seed, tier);
}
