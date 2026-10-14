// cspell:ignore Acklam ACKLAM -- Peter Acklam's inverse-normal approximation
/**
 * Portable numeric helpers for the synthetic wine generator (`./generate.ts`).
 *
 * @remarks
 * **Why not `Math.exp` and friends.** The generator promises identical records in every
 * JavaScript engine: Node, and a Web Worker in Chrome, Firefox or Safari. IEEE 754 requires the
 * basic operations (`+ - * /`, `Math.sqrt`) to be correctly rounded, so they agree everywhere, but
 * leaves `Math.exp`, `Math.log`, `Math.cos` and `**` free to differ in the last bit, and engines do
 * differ. A one-bit difference that lands on a rounding or comparison boundary would change a
 * record. Everything on the path from a seed to a field value therefore uses only basic operations:
 * score thresholds are stored literals, and the exponential, logarithm and normal quantile are
 * computed here from series and rational approximations ({@link portableExp},
 * {@link portableLog}, {@link portableNormalQuantile}).
 *
 * @packageDocumentation
 */

import type { SeededRng } from '../_generation/random.js';

/**
 * Running sums of a list of non-negative weights, normalized to end at 1.
 *
 * @param weights - Non-negative weights with a positive sum.
 * @returns The normalized cumulative distribution.
 */
export function cumulativeDistribution(weights: readonly number[]): Float64Array {
	const total = weights.reduce((sum, weight) => sum + weight, 0);
	const cumulative = new Float64Array(weights.length);
	let running = 0;

	weights.forEach((weight, index) => {
		running += weight;
		cumulative[index] = running / total;
	});

	return cumulative;
}

/**
 * Index of the first value at or above `target` in a non-decreasing list (binary search); the
 * list's length when every value is below it.
 *
 * @param sorted - Non-decreasing values.
 * @param target - The value to place.
 * @returns The insertion index.
 */
export function firstIndexAtOrAbove(sorted: ArrayLike<number>, target: number): number {
	let low = 0;
	let high = sorted.length;

	while (low < high) {
		const middle = (low + high) >>> 1;

		if ((sorted[middle] ?? Number.POSITIVE_INFINITY) < target) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}

	return low;
}

/**
 * Mix a seed with a salt into a well-spread 32-bit seed (the MurmurHash3 finalizer).
 *
 * @param seed - Base seed.
 * @param salt - Record index or epoch tag.
 * @returns A derived unsigned 32-bit seed.
 */
export function deriveSeed(seed: number, salt: number): number {
	let hash = (seed ^ Math.imul(salt + 1, 0x9E3779B1)) >>> 0;

	hash = Math.imul(hash ^ (hash >>> 16), 0x85EBCA6B);
	hash = Math.imul(hash ^ (hash >>> 13), 0xC2B2AE35);

	return (hash ^ (hash >>> 16)) >>> 0;
}

/** High part of ln 2: its low bits are zero, so `k × LN2_HIGH` is exact for the `k` used here. */
const LN2_HIGH = 0.6931471803691238;

/** The rest of ln 2 (Cody–Waite range reduction). */
const LN2_LOW = 1.9082149292705877e-10;

/** Terms of the Taylor series for e^r with |r| ≤ ln 2 / 2; enough for double precision. */
const EXP_SERIES_TERMS = 16;

/**
 * e^x using only correctly rounded operations, so every engine returns the same bits.
 *
 * @remarks
 * Writes x = k·ln 2 + r with |r| ≤ ln 2 / 2, sums the Taylor series of e^r in Horner form and scales
 * by 2^k through exact doublings. Accurate to a few units in the last place across the range the
 * generator uses (prices from about $4 to $3,300, so x from about 1.4 to 8.1).
 *
 * @param x - The exponent; |x| below 700.
 * @returns e^x.
 */
export function portableExp(x: number): number {
	const k = Math.round(x / Math.LN2);
	const r = (x - k * LN2_HIGH) - k * LN2_LOW;
	let series = 1;

	for (let term = EXP_SERIES_TERMS; term >= 1; term--) {
		series = 1 + r * series / term;
	}

	let scale = 1;
	const factor = k >= 0 ? 2 : 0.5;

	for (let doubling = 0; doubling < Math.abs(k); doubling++) {
		scale *= factor;
	}

	return series * scale;
}

/** Terms of the series for atanh(s) with |s| ≤ 0.172; enough for double precision. */
const LOG_SERIES_LAST_POWER = 25;

/**
 * ln x using only correctly rounded operations, so every engine returns the same bits.
 *
 * @remarks
 * Scales x into [√½, √2) by exact halving or doubling, then sums ln m = 2·atanh((m − 1)/(m + 1)).
 *
 * @param x - A positive, finite number.
 * @returns ln x.
 */
export function portableLog(x: number): number {
	let mantissa = x;
	let exponent = 0;

	while (mantissa >= Math.SQRT2) {
		mantissa /= 2;
		exponent += 1;
	}
	while (mantissa < Math.SQRT1_2) {
		mantissa *= 2;
		exponent -= 1;
	}

	const ratio = (mantissa - 1) / (mantissa + 1);
	const ratioSquared = ratio * ratio;
	let power = ratio;
	let series = 0;

	for (let odd = 1; odd <= LOG_SERIES_LAST_POWER; odd += 2) {
		series += power / odd;
		power *= ratioSquared;
	}

	return 2 * series + exponent * LN2_HIGH + exponent * LN2_LOW;
}

/** Coefficients of Acklam's rational approximation to the inverse normal CDF (central region). */
const ACKLAM_CENTRAL_NUMERATOR = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239] as const;

/** Denominator coefficients for the central region. */
const ACKLAM_CENTRAL_DENOMINATOR = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572] as const;

/** Numerator coefficients for the tails. */
const ACKLAM_TAIL_NUMERATOR = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783] as const;

/** Denominator coefficients for the tails. */
const ACKLAM_TAIL_DENOMINATOR = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416] as const;

/** Probability below which (and above one minus which) the tail approximation applies. */
const ACKLAM_TAIL_PROBABILITY = 0.02425;

/**
 * Evaluate a polynomial with the given coefficients, highest power first (Horner's scheme).
 *
 * @param coefficients - Coefficients, highest power first.
 * @param x - The argument.
 * @returns The polynomial's value.
 */
function horner(coefficients: readonly number[], x: number): number {
	let accumulated = 0;

	for (const coefficient of coefficients) {
		accumulated = accumulated * x + coefficient;
	}

	return accumulated;
}

/**
 * The standard-normal quantile function (Acklam's approximation, relative error below 1.2 × 10⁻⁹),
 * with the tails' logarithm computed by {@link portableLog}.
 *
 * @param probability - A probability strictly between 0 and 1.
 * @returns z such that P(Z ≤ z) = probability.
 */
export function portableNormalQuantile(probability: number): number {
	if (probability < ACKLAM_TAIL_PROBABILITY || probability > 1 - ACKLAM_TAIL_PROBABILITY) {
		const tail = Math.min(probability, 1 - probability);
		const q = Math.sqrt(-2 * portableLog(tail));
		const z = horner(ACKLAM_TAIL_NUMERATOR, q) / (horner(ACKLAM_TAIL_DENOMINATOR, q) * q + 1);

		return probability < 0.5 ? z : -z;
	}

	const centered = probability - 0.5;
	const squared = centered * centered;

	return horner(ACKLAM_CENTRAL_NUMERATOR, squared) * centered / (horner(ACKLAM_CENTRAL_DENOMINATOR, squared) * squared + 1);
}

/** Half the spacing of the seeded generator's 2⁻³² output grid: keeps a draw off 0 and 1. */
const HALF_GRID_STEP = 1 / 8_589_934_592;

/**
 * A standard-normal draw by inversion: one uniform draw through {@link portableNormalQuantile}.
 *
 * @param rng - Seeded random source.
 * @returns A sample from N(0, 1).
 */
export function portableStandardNormal(rng: SeededRng): number {
	return portableNormalQuantile(rng() + HALF_GRID_STEP);
}

/**
 * Linear interpolation into a quantile table.
 *
 * @param quantiles - `[cumulative probability, value]` pairs with probabilities rising from 0 to 1.
 * @param u - A uniform draw in `[0, 1)`.
 * @returns The interpolated value.
 */
export function interpolateQuantile(quantiles: readonly (readonly [number, number])[], u: number): number {
	for (let index = 1; index < quantiles.length; index++) {
		const [upperProbability, upperValue] = quantiles[index] ?? [1, 0];

		if (u <= upperProbability) {
			const [lowerProbability, lowerValue] = quantiles[index - 1] ?? [0, 0];
			const span = upperProbability - lowerProbability;

			return span > 0 ? lowerValue + (upperValue - lowerValue) * (u - lowerProbability) / span : upperValue;
		}
	}

	return quantiles.at(-1)?.[1] ?? 0;
}

/**
 * Pick from a list by non-negative weights.
 *
 * @param rng - Seeded random source.
 * @param values - Candidates, as many as weights.
 * @param weights - One weight per candidate, with a positive sum.
 * @returns The chosen candidate.
 */
export function pickByWeights<T>(rng: SeededRng, values: readonly T[], weights: readonly number[]): T {
	const total = weights.reduce((sum, weight) => sum + weight, 0);
	let target = rng() * total;
	let index = 0;

	while (index < values.length - 1) {
		target -= weights[index] ?? 0;
		if (target < 0) {
			break;
		}
		index += 1;
	}

	return values[index] as T;
}

/**
 * Round to one decimal place and clamp.
 *
 * @param value - Raw value.
 * @param minimum - Lower bound.
 * @param maximum - Upper bound.
 * @returns The rounded, clamped value.
 */
export function roundToTenthWithin(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, Math.round(value * 10) / 10));
}

/**
 * Apportion `total` items across categories in proportion to their counts, by largest remainder.
 *
 * @remarks
 * Each category gets ⌊count × total ÷ count sum⌋ items, and the items left over go one each to the
 * categories with the largest fractional parts (ties to the earlier category). When `total` is at
 * least the count sum, every category with a positive count gets at least one item.
 *
 * @param counts - Non-negative counts with a positive sum.
 * @param total - Items to apportion, a non-negative integer.
 * @returns Items per category, summing to `total`.
 */
export function apportionByLargestRemainder(counts: Uint32Array | readonly number[], total: number): Uint32Array {
	let countSum = 0;

	for (const count of counts) {
		countSum += count;
	}

	const allocation = new Uint32Array(counts.length);
	const remainders = new Float64Array(counts.length);
	let allocated = 0;

	for (let category = 0; category < counts.length; category++) {
		const quota = (counts[category] ?? 0) * total / countSum;
		const whole = Math.floor(quota);

		allocation[category] = whole;
		remainders[category] = quota - whole;
		allocated += whole;
	}

	const byRemainder = Array.from({ length: counts.length }, (_, category) => category)
		.sort((left, right) => (remainders[right] ?? 0) - (remainders[left] ?? 0) || left - right);

	for (let rank = 0; rank < total - allocated; rank++) {
		const category = byRemainder[rank % byRemainder.length] ?? 0;

		allocation[category] = (allocation[category] ?? 0) + 1;
	}

	return allocation;
}
