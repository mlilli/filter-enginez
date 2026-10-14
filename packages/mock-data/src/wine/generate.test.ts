/**
 * The synthetic wine generator's contract: one deterministic stream, every origin and varietal
 * present at full-tier size, and distributions within tolerance of the measured statistics.
 *
 * @remarks
 * Node runtime. The full tier (150k records, about a second) is generated once and shared.
 *
 * Two kinds of target appear below:
 *
 * - **Committed tables** (`./generate-origins.ts`, `./generate-profile.ts`): the generator's own
 *   inputs. Asserting against them catches sampling bugs — a mis-indexed table, an off-by-one in the
 *   score scale, a broken apportionment.
 * - **Measured targets** (the constants in this file): statistics of the Kaggle "Wine Reviews"
 *   dataset that the generator does NOT read directly (price quantiles, description lengths,
 *   descriptor frequencies, the price-score correlation). Asserting against them catches drift in
 *   the generator's emergent behavior, which is what the demos' filters and searches see.
 *
 * Tolerances are wide enough for sampling noise at 150k and narrow enough that a wrong table, a
 * dropped lean or a broken correlation fails.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import type { Wine, WineColor } from './types.js';

import { DEFAULT_TIER_SIZE, FULL_WINE_TIER_SIZE } from '../tier-sizes.js';
import { ABV_PROFILE_BY_COLOR, NON_VINTAGE_YEAR, VINTAGE_REFERENCE_YEAR } from './generate-data.js';
import { WINE_ORIGIN_LEAF_ROWS, WINE_ORIGIN_MEASURED_TOTAL, WINE_VARIETAL_ROWS } from './generate-origins.js';
import {
	DESCRIPTOR_VOCABULARY,
	DESIGNATION_SHARE,
	MIN_POINTS,
	POINTS_HISTOGRAM,
	VINTAGE_PROFILE_BY_COLOR,
	WINE_COUNTRY_ROWS,
} from './generate-profile.js';
import { generateWineRange, generateWines, WINE_GENERATOR_SEED } from './generate.js';

/** Measured list-price quantiles (US dollars), over reviews that list a price. */
const MEASURED_PRICE_QUANTILES: readonly (readonly [quantile: number, priceUsd: number])[] = [
	[0.1, 12],
	[0.25, 17],
	[0.5, 25],
	[0.75, 42],
	[0.9, 65],
	[0.95, 85],
	[0.99, 155],
];

/** Measured share of listed prices at or above $500: the long tail the price slider must reach. */
const MEASURED_SHARE_AT_LEAST_500_USD = 105 / 121_006;

/** Measured Spearman rank correlation between score and price. */
const MEASURED_POINTS_PRICE_SPEARMAN = 0.61;

/** Measured review length quantiles, in whitespace-separated words. */
const MEASURED_DESCRIPTION_WORD_QUANTILES: readonly (readonly [quantile: number, words: number, tolerance: number])[] = [
	[0.05, 24, 5],
	[0.25, 33, 4],
	[0.5, 40, 4],
	[0.75, 47, 4],
	[0.95, 60, 8],
];

/** Measured share of reviews mentioning each of the twenty most frequent descriptors, in percent. */
const MEASURED_DESCRIPTOR_PERCENT: readonly (readonly [descriptor: string, percent: number])[] = [
	['tannins', 28.79],
	['acidity', 26.25],
	['spice', 19.39],
	['cherry', 15.24],
	['oak', 14.12],
	['blackberry', 11.08],
	['berry', 11.06],
	['plum', 9.92],
	['citrus', 9.5],
	['apple', 8.87],
	['toast', 8.68],
	['raspberry', 8.28],
	['herbs', 8.27],
	['vanilla', 8.19],
	['lemon', 7.12],
	['black cherry', 6.68],
	['earth', 6.56],
	['pear', 6.48],
	['mineral', 5.95],
	['smoke', 5.51],
];

/** Measured mean score of the largest producing countries. */
const MEASURED_MEAN_POINTS_BY_COUNTRY: readonly (readonly [country: string, meanPoints: number])[] = [
	['US', 88.56],
	['France', 88.85],
	['Italy', 88.56],
	['Spain', 87.29],
	['Chile', 86.49],
	['Argentina', 86.71],
	['Austria', 90.1],
	['Germany', 89.85],
];

/** Measured number of distinct producers across the 129,907 reviews. */
const MEASURED_WINERY_COUNT = 16_745;

/** The full tier, generated once for the whole file. */
let fullTier: readonly Wine[] = [];

/** Count occurrences of each key. */
function countBy<T>(items: readonly T[], key: (item: T) => string): Map<string, number> {
	const counts = new Map<string, number>();

	for (const item of items) {
		const k = key(item);

		counts.set(k, (counts.get(k) ?? 0) + 1);
	}

	return counts;
}

/** The value at quantile `q` of a numeric list. */
function quantile(values: readonly number[], q: number): number {
	const sorted = Float64Array.from(values).sort();

	return sorted[Math.floor(q * (sorted.length - 1))] ?? Number.NaN;
}

/** Smallest value of a long list (spreading 150k arguments into `Math.min` overflows the stack). */
function minimumOf(values: readonly number[]): number {
	return values.reduce((smallest, value) => Math.min(smallest, value), Number.POSITIVE_INFINITY);
}

/** Largest value of a long list. */
function maximumOf(values: readonly number[]): number {
	return values.reduce((largest, value) => Math.max(largest, value), Number.NEGATIVE_INFINITY);
}

/** Arithmetic mean. */
function mean(values: readonly number[]): number {
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Average ranks (ties share their mean rank). */
function ranks(values: readonly number[]): Float64Array {
	const order = values.map((value, index) => [value, index] as const).sort((left, right) => left[0] - right[0]);
	const result = new Float64Array(values.length);
	let start = 0;

	while (start < order.length) {
		let end = start;

		while (end + 1 < order.length && order[end + 1]?.[0] === order[start]?.[0]) {
			end += 1;
		}
		for (let position = start; position <= end; position++) {
			result[order[position]?.[1] ?? 0] = (start + end) / 2;
		}
		start = end + 1;
	}

	return result;
}

/** Spearman rank correlation of two equal-length lists. */
function spearman(left: readonly number[], right: readonly number[]): number {
	const leftRanks = ranks(left);
	const rightRanks = ranks(right);
	const leftMean = mean(Array.from(leftRanks));
	const rightMean = mean(Array.from(rightRanks));
	let covariance = 0;
	let leftVariance = 0;
	let rightVariance = 0;

	for (let index = 0; index < left.length; index++) {
		const leftDeviation = (leftRanks[index] ?? 0) - leftMean;
		const rightDeviation = (rightRanks[index] ?? 0) - rightMean;

		covariance += leftDeviation * rightDeviation;
		leftVariance += leftDeviation * leftDeviation;
		rightVariance += rightDeviation * rightDeviation;
	}

	return covariance / Math.sqrt(leftVariance * rightVariance);
}

/**
 * The vocabulary descriptors a description mentions, matching two-word descriptors before their
 * one-word tails, so "black cherry" does not also count as "cherry".
 */
function descriptorsIn(description: string): Set<string> {
	const words = description.toLowerCase().match(/[a-zà-ÿ]+/gu) ?? [];
	const vocabulary = new Set(DESCRIPTOR_VOCABULARY.map(([descriptor]) => descriptor));
	const found = new Set<string>();

	for (let index = 0; index < words.length; index++) {
		const pair = `${words[index] ?? ''} ${words[index + 1] ?? ''}`;

		if (vocabulary.has(pair)) {
			found.add(pair);
			index += 1;
		} else if (vocabulary.has(words[index] ?? '')) {
			found.add(words[index] ?? '');
		}
	}

	return found;
}

beforeAll(() => {
	fullTier = generateWines(FULL_WINE_TIER_SIZE, WINE_GENERATOR_SEED, 'full');
});

describe('the wine stream', () => {
	it('generates the full tier at the advertised size', () => {
		expect(fullTier).toHaveLength(FULL_WINE_TIER_SIZE);
		expect(new Set(fullTier.map((wine) => wine.id)).size).toBe(FULL_WINE_TIER_SIZE);
	});

	it('gives identical records for the same seed', () => {
		expect(generateWines(500)).toStrictEqual(generateWines(500));
	});

	it('gives different records for a different seed', () => {
		const canonical = generateWines(50);
		const other = generateWines(50, WINE_GENERATOR_SEED + 1);

		expect(other.filter((wine, index) => wine.name === canonical[index]?.name).length).toBeLessThan(5);
	});

	it('makes the default tier the first DEFAULT_TIER_SIZE records of the full tier', () => {
		const defaultTier = generateWines(DEFAULT_TIER_SIZE);
		const fullPrefix = fullTier.slice(0, DEFAULT_TIER_SIZE).map((wine) => ({ ...wine, tier: 'default' as const }));

		expect(defaultTier).toHaveLength(DEFAULT_TIER_SIZE);
		expect(defaultTier).toStrictEqual(fullPrefix);
	});

	it('generates any range exactly as the matching slice of the stream', () => {
		expect(generateWineRange(149_000, FULL_WINE_TIER_SIZE, WINE_GENERATOR_SEED, 'full')).toStrictEqual(fullTier.slice(149_000));
		expect(generateWineRange(0, 0)).toStrictEqual([]);
	});

	it('continues past the full tier with a fresh allocation', () => {
		const beyond = generateWineRange(FULL_WINE_TIER_SIZE, FULL_WINE_TIER_SIZE + 200);

		expect(beyond).toHaveLength(200);
		expect(beyond[0]?.id.endsWith(`-${FULL_WINE_TIER_SIZE}`)).toBe(true);
		expect(generateWineRange(FULL_WINE_TIER_SIZE, FULL_WINE_TIER_SIZE + 200)).toStrictEqual(beyond);
	});

	it('rejects malformed ranges and treats non-positive counts as empty', () => {
		expect(() => generateWineRange(-1, 5)).toThrow(RangeError);
		expect(() => generateWineRange(5, 4)).toThrow(RangeError);
		expect(() => generateWineRange(0.5, 4)).toThrow(RangeError);
		expect(generateWines(0)).toStrictEqual([]);
		expect(generateWines(-3)).toStrictEqual([]);
		expect(generateWines(2.5)).toHaveLength(3);
	});
});

describe('full-variance coverage at full-tier size', () => {
	it('emits every origin leaf, every varietal and every measured (leaf, varietal) pairing', () => {
		const leafIds = new Set(WINE_ORIGIN_LEAF_ROWS.map((row) => row.slice(0, 4).filter((level) => level.length > 0).join('|')));
		const measuredPairs = WINE_ORIGIN_LEAF_ROWS.reduce((sum, row) => sum + row[4].split(' ').length, 0);

		expect(leafIds.size, 'vacuity: the origin table is loaded').toBeGreaterThan(1500);
		expect(WINE_VARIETAL_ROWS.length, 'vacuity: the varietal table is loaded').toBeGreaterThan(600);
		expect(new Set(fullTier.map((wine) => wine.originId))).toStrictEqual(leafIds);
		expect(new Set(fullTier.map((wine) => wine.varietal)).size).toBe(WINE_VARIETAL_ROWS.length);
		expect(new Set(fullTier.map((wine) => `${wine.originId}#${wine.varietal}`)).size).toBe(measuredPairs);
	});

	it('emits every value of every categorical facet and the full numeric ranges', () => {
		expect(new Set(fullTier.map((wine) => wine.points))).toStrictEqual(new Set(POINTS_HISTOGRAM.map((_, index) => MIN_POINTS + index)));
		expect(new Set(fullTier.map((wine) => wine.color))).toStrictEqual(new Set(['dessert', 'fortified', 'red', 'rosé', 'sparkling', 'white']));
		expect(new Set(fullTier.map((wine) => wine.body))).toStrictEqual(new Set(['full', 'light', 'medium', 'medium-full', 'medium-light']));
		expect(new Set(fullTier.map((wine) => wine.sweetness))).toStrictEqual(
			new Set(['bone-dry', 'dessert', 'dry', 'medium-sweet', 'off-dry', 'sweet']),
		);

		const prices = fullTier.map((wine) => wine.priceUsd);
		const alcoholLevels = fullTier.map((wine) => wine.abv);
		const vintages = fullTier.map((wine) => wine.vintage);

		expect(minimumOf(prices)).toBeLessThanOrEqual(5);
		expect(maximumOf(prices)).toBeGreaterThanOrEqual(1000);
		expect(minimumOf(alcoholLevels)).toBeLessThanOrEqual(7);
		expect(maximumOf(alcoholLevels)).toBeGreaterThanOrEqual(20);
		expect(minimumOf(vintages)).toBeLessThanOrEqual(1960);
		expect(maximumOf(vintages)).toBe(NON_VINTAGE_YEAR);
		expect(fullTier.every((wine) => (wine.vintage === NON_VINTAGE_YEAR) === wine.name.includes(' NV '))).toBe(true);
	});
});

describe('distributions against the committed tables', () => {
	it('allocates every leaf and varietal its measured share, within rounding', () => {
		const byLeaf = countBy(fullTier, (wine) => wine.originId);
		const byVarietal = countBy(fullTier, (wine) => wine.varietal);
		const expectedByVarietal = new Map<string, number>();
		const cellsByVarietal = new Map<string, number>();
		const scale = FULL_WINE_TIER_SIZE / WINE_ORIGIN_MEASURED_TOTAL;

		for (const [country, province, region, subregion, cells] of WINE_ORIGIN_LEAF_ROWS) {
			const leafId = [country, province, region, subregion].filter((level) => level.length > 0).join('|');
			const parsed = cells.split(' ').map((cell) => cell.split(':').map(Number));
			const measured = parsed.reduce((sum, [, count]) => sum + (count ?? 0), 0);

			expect(Math.abs((byLeaf.get(leafId) ?? 0) - measured * scale), leafId).toBeLessThanOrEqual(parsed.length);
			for (const [varietalIndex, count] of parsed) {
				const varietal = WINE_VARIETAL_ROWS[varietalIndex ?? -1]?.[0] ?? '';

				expectedByVarietal.set(varietal, (expectedByVarietal.get(varietal) ?? 0) + (count ?? 0) * scale);
				cellsByVarietal.set(varietal, (cellsByVarietal.get(varietal) ?? 0) + 1);
			}
		}
		for (const [varietal, expected] of expectedByVarietal) {
			expect(Math.abs((byVarietal.get(varietal) ?? 0) - expected), varietal).toBeLessThanOrEqual(cellsByVarietal.get(varietal) ?? 0);
		}
	});

	it('reproduces the measured score histogram', () => {
		const total = POINTS_HISTOGRAM.reduce((sum, count) => sum + count, 0);
		const byPoints = countBy(fullTier, (wine) => String(wine.points));

		POINTS_HISTOGRAM.forEach((count, index) => {
			const measuredShare = count / total;
			const generatedShare = (byPoints.get(String(MIN_POINTS + index)) ?? 0) / fullTier.length;

			expect(Math.abs(generatedShare - measuredShare), `${MIN_POINTS + index} points`).toBeLessThanOrEqual(Math.max(0.0015, measuredShare * 0.08));
		});
	});

	it('keeps each country\'s score lean', () => {
		expect(WINE_COUNTRY_ROWS.length).toBeGreaterThan(40);
		for (const [country, measuredMean] of MEASURED_MEAN_POINTS_BY_COUNTRY) {
			const scores = fullTier.filter((wine) => wine.origin.country === country).map((wine) => wine.points);

			expect(Math.abs(mean(scores) - measuredMean), country).toBeLessThanOrEqual(0.3);
		}
	});

	it('reproduces the measured non-vintage share and vintage age of each color', () => {
		for (const [color, profile] of Object.entries(VINTAGE_PROFILE_BY_COLOR)) {
			const ofColor = fullTier.filter((wine) => wine.color === color);
			const nonVintage = ofColor.filter((wine) => wine.vintage === NON_VINTAGE_YEAR);
			const pairs = profile.ageCounts.split(' ').map((pair) => pair.split(':').map(Number));
			const measuredAge = pairs.reduce((sum, [age, count]) => sum + (age ?? 0) * (count ?? 0), 0)
				/ pairs.reduce((sum, [, count]) => sum + (count ?? 0), 0);
			const vintageAges = ofColor.filter((wine) => wine.vintage !== NON_VINTAGE_YEAR).map((wine) => VINTAGE_REFERENCE_YEAR - wine.vintage);

			expect(ofColor.length, color).toBeGreaterThan(500);
			expect(Math.abs(nonVintage.length / ofColor.length - profile.nonVintageShare), color).toBeLessThanOrEqual(0.03);
			expect(Math.abs(mean(vintageAges) - measuredAge), color).toBeLessThanOrEqual(ofColor.length > 10_000 ? 0.2 : 1);
		}
	});

	it('names a designation at the measured share', () => {
		const designated = fullTier.filter((wine) => wine.designation.length > 0).length / fullTier.length;

		expect(Math.abs(designated - DESIGNATION_SHARE)).toBeLessThanOrEqual(0.01);
	});

	it('keeps alcohol near each color\'s domain mean', () => {
		for (const [color, profile] of Object.entries(ABV_PROFILE_BY_COLOR)) {
			const alcoholLevels = fullTier.filter((wine) => wine.color === color).map((wine) => wine.abv);

			expect(Math.abs(mean(alcoholLevels) - profile.mean), color).toBeLessThanOrEqual(color === 'dessert' ? 4.5 : 1);
			expect(minimumOf(alcoholLevels), color).toBeGreaterThanOrEqual(profile.minimum);
			expect(maximumOf(alcoholLevels), color).toBeLessThanOrEqual(profile.maximum);
		}
	});
});

describe('distributions against the measured targets', () => {
	it('matches the measured price quantiles', () => {
		const prices = fullTier.map((wine) => wine.priceUsd);

		for (const [q, measured] of MEASURED_PRICE_QUANTILES) {
			expect(Math.abs(quantile(prices, q) / measured - 1), `price p${q * 100}`).toBeLessThanOrEqual(0.12);
		}
		expect(prices.filter((price) => price >= 500).length / prices.length / MEASURED_SHARE_AT_LEAST_500_USD).toBeGreaterThan(0.6);
		expect(prices.filter((price) => price >= 500).length / prices.length / MEASURED_SHARE_AT_LEAST_500_USD).toBeLessThan(1.6);
	});

	it('ties price to score as strongly as the measured reviews do', () => {
		const sample = fullTier.filter((_, index) => index % 5 === 0);
		const correlation = spearman(sample.map((wine) => wine.points), sample.map((wine) => wine.priceUsd));

		expect(Math.abs(correlation - MEASURED_POINTS_PRICE_SPEARMAN)).toBeLessThanOrEqual(0.05);
	});

	it('writes descriptions of the measured length, longer for higher scores', () => {
		const words = fullTier.map((wine) => wine.description.split(/\s+/u).length);
		const lowScoring = fullTier.filter((wine) => wine.points <= 84).map((wine) => wine.description.split(/\s+/u).length);
		const highScoring = fullTier.filter((wine) => wine.points >= 94).map((wine) => wine.description.split(/\s+/u).length);

		for (const [q, measured, tolerance] of MEASURED_DESCRIPTION_WORD_QUANTILES) {
			expect(Math.abs(quantile(words, q) - measured), `words p${q * 100}`).toBeLessThanOrEqual(tolerance);
		}
		expect(mean(highScoring)).toBeGreaterThan(mean(lowScoring) * 1.4);
	});

	it('mentions each frequent descriptor about as often as the measured reviews', () => {
		const mentions = new Map<string, number>();

		for (const wine of fullTier) {
			for (const descriptor of descriptorsIn(wine.description)) {
				mentions.set(descriptor, (mentions.get(descriptor) ?? 0) + 1);
			}
		}
		for (const [descriptor, measuredPercent] of MEASURED_DESCRIPTOR_PERCENT) {
			const percent = 100 * (mentions.get(descriptor) ?? 0) / fullTier.length;

			expect(Math.abs(percent / measuredPercent - 1), descriptor).toBeLessThanOrEqual(0.12);
		}
	});

	it('writes each varietal\'s signature descriptors, not just its color\'s', () => {
		/** Percent of a varietal's wines whose description mentions the descriptor. */
		const mentionPercent = (varietal: string, descriptor: string): number => {
			const ofVarietal = fullTier.filter((wine) => wine.varietal === varietal);

			return 100 * ofVarietal.filter((wine) => descriptorsIn(wine.description).has(descriptor)).length / ofVarietal.length;
		};

		expect(mentionPercent('Cabernet Sauvignon', 'cassis')).toBeGreaterThan(3 * mentionPercent('Pinot Noir', 'cassis'));
		expect(mentionPercent('Riesling', 'petrol')).toBeGreaterThan(5 * mentionPercent('Chardonnay', 'petrol'));
		expect(mentionPercent('Pinot Noir', 'cola')).toBeGreaterThan(3 * mentionPercent('Syrah', 'cola'));
	});

	it('lists tasting notes in the order the description mentions them, at most six', () => {
		for (const wine of fullTier.slice(0, 2000)) {
			const description = wine.description.toLowerCase();
			let searchFrom = 0;

			expect(wine.tastingNotes.length).toBeLessThanOrEqual(6);
			for (const note of wine.tastingNotes) {
				const at = description.indexOf(note, searchFrom);

				expect(at, `${wine.id}: ${note}`).toBeGreaterThanOrEqual(0);
				searchFrom = at + note.length;
			}
		}
		expect(fullTier.filter((wine) => wine.tastingNotes.length === 0).length / fullTier.length).toBeLessThan(0.03);
	});

	it('has a producer population of the measured size and skew', () => {
		const byWinery = countBy(fullTier, (wine) => `${wine.origin.country}#${wine.winery}`);
		const sizes = [...byWinery.values()].sort((left, right) => right - left);
		const topPercentShare = sizes.slice(0, Math.ceil(sizes.length / 100)).reduce((sum, size) => sum + size, 0) / fullTier.length;

		expect(byWinery.size).toBeGreaterThan(MEASURED_WINERY_COUNT * 0.9);
		expect(byWinery.size).toBeLessThan(MEASURED_WINERY_COUNT * 1.4);
		expect(topPercentShare).toBeGreaterThan(0.07);
		expect(topPercentShare).toBeLessThan(0.15);
	});
});

describe('correlations the filters rely on', () => {
	/** Share of the wines matching `where` that also match `then`. */
	function conditionalShare(where: (wine: Wine) => boolean, then: (wine: Wine) => boolean): number {
		const matching = fullTier.filter(where);

		return matching.filter(then).length / matching.length;
	}

	it('pairs varietals with their colors and their regions', () => {
		expect(conditionalShare((wine) => wine.varietal === 'Pinot Noir', (wine) => wine.color === 'red')).toBeGreaterThan(0.97);
		expect(conditionalShare((wine) => wine.varietal === 'Rosé', (wine) => wine.color === 'rosé')).toBe(1);
		expect(conditionalShare((wine) => wine.origin.province === 'Champagne', (wine) => wine.color === 'sparkling')).toBeGreaterThan(0.95);
		expect(conditionalShare((wine) => wine.varietal === 'Nebbiolo', (wine) => wine.origin.country === 'Italy')).toBeGreaterThan(0.95);
		expect(conditionalShare((wine) => wine.varietal === 'Zinfandel', (wine) => wine.origin.country === 'US')).toBeGreaterThan(0.99);
		expect(conditionalShare((wine) => wine.origin.region === 'Napa Valley', (wine) => wine.varietal === 'Cabernet Sauvignon')).toBeGreaterThan(0.3);
	});

	it('gives fuller-bodied varietals a fuller body and fortified wines the most alcohol', () => {
		const bodyRank = (wine: Wine): number => ['light', 'medium-light', 'medium', 'medium-full', 'full'].indexOf(wine.body);
		const meanBody = (varietal: string): number => mean(fullTier.filter((wine) => wine.varietal === varietal).map(bodyRank));
		const meanAbv = (color: WineColor): number => mean(fullTier.filter((wine) => wine.color === color).map((wine) => wine.abv));

		expect(meanBody('Cabernet Sauvignon')).toBeGreaterThan(meanBody('Pinot Noir') + 0.8);
		expect(meanAbv('fortified')).toBeGreaterThan(meanAbv('red') + 3);
		expect(meanAbv('red')).toBeGreaterThan(meanAbv('sparkling'));
	});

	it('never makes a red or rosé wine sweet', () => {
		const sweetRedsOrRoses = fullTier.filter((wine) => (wine.color === 'red' || wine.color === 'rosé') && (wine.sweetness === 'sweet' || wine.sweetness === 'dessert'));

		expect(sweetRedsOrRoses).toHaveLength(0);
	});
});

describe('the demo presets on the default tier', () => {
	/** The default tier, as the demos load it. */
	const defaultTier = (): readonly Wine[] => fullTier.slice(0, DEFAULT_TIER_SIZE);

	it('gives every smart-filter preset a non-empty, partial result', () => {
		const presets: Readonly<Record<string, (wine: Wine) => boolean>> = {
			boldReds: (wine) => wine.color === 'red' && wine.priceUsd <= 25 && wine.points >= 88,
			cellarPicks: (wine) => (wine.points >= 93 || wine.priceUsd >= 60) && wine.color !== 'rosé' && wine.color !== 'sparkling',
			crispWhites: (wine) => wine.color === 'white' && !['dessert', 'medium-sweet', 'sweet'].includes(wine.sweetness),
			pinot: (wine) => ['Pinot Grigio', 'Pinot Gris', 'Pinot Noir'].includes(wine.varietal),
		};

		for (const [name, matches] of Object.entries(presets)) {
			const hits = defaultTier().filter(matches).length;

			expect(hits, name).toBeGreaterThan(0);
			expect(hits, name).toBeLessThan(DEFAULT_TIER_SIZE);
		}
	});

	it('has sweet whites but no sweet reds among the first 400 wines', () => {
		const first400 = defaultTier().slice(0, 400);

		expect(first400.some((wine) => wine.color === 'white' && wine.sweetness === 'sweet')).toBe(true);
		expect(first400.some((wine) => wine.color === 'red' && wine.sweetness === 'sweet')).toBe(false);
	});
});
