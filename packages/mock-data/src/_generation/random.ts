/**
 * Deterministic seeded PRNG + sampling helpers used by the procedural data generators.
 *
 * @remarks
 * The whole point of using a seeded generator (vs `Math.random`) is **reproducibility**:
 * two runs with the same seed produce byte-identical datasets, which keeps snapshot tests
 * stable and makes "the wine at index 42" a stable reference across docs / examples / bug
 * reports. We use the **Mulberry32** algorithm — a 32-bit state PRNG with excellent
 * statistical properties for non-crypto use, ~6 LOC of code, and no external dependency.
 * See [Mulberry32 in the wild](https://github.com/bryc/code/blob/master/jshash/PRNGs.md#mulberry32).
 *
 * **Why not use a real PRNG library.** `seedrandom`, `chance`, `faker` etc. are great but add
 * 50-200KB to the package and most of their surface we don't use. Mulberry32 plus the few
 * sampling helpers below cover every distribution we need for the three datasets, in roughly
 * 80 LOC, with zero install-time cost.
 *
 * **Why this lives under `_generation/`.** The leading underscore + `_generation/` directory
 * signals that this is **build-time-only** code — consumers of `@filter-enginez/mock-data`
 * should never reach for these helpers. They're imported only by `data.ts` files at module
 * load (during generation) and never re-exported through any barrel.
 *
 * @packageDocumentation
 */

/**
 * Mulberry32 — a fast, statistically-decent PRNG with 32-bit state. Returns a function that
 * yields the next pseudo-random `[0, 1)` value on each call. Two calls with the same seed
 * always produce the same sequence.
 *
 * @param seed - 32-bit unsigned integer seed. Use a memorable constant per dataset (e.g.,
 *   `0xWINE_5EED`-like values) so the dataset is reproducible across machines.
 * @returns A `() => number` that yields uniform `[0, 1)` random values
 *
 * @example
 *   const rng = mulberry32(0xC4B3A4E7);
 *   for (let i = 0; i < 5; i++) console.log(rng()); // same five numbers every run
 */
export function mulberry32(seed: number): () => number {
	// `state` is intentionally mutable across calls — the closure captures it.
	let state = seed >>> 0; // Coerce to uint32 in case caller passed a negative or float seed.

	return function next(): number {
		state = (state + 0x6D2B79F5) >>> 0;
		let t = state;

		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * A seeded random-number source — the function returned by `mulberry32`. Aliased as a type so
 * the sampling helpers below can name their parameter cleanly.
 */
export type SeededRng = () => number;

/**
 * Random integer in `[min, max]` inclusive. Uses the supplied seeded RNG so callers can
 * compose deterministic sequences.
 */
export function randomInt(rng: SeededRng, min: number, max: number): number {
	return Math.floor(rng() * (max - min + 1)) + min;
}

/**
 * Random float in `[min, max)`.
 */
export function randomFloat(rng: SeededRng, min: number, max: number): number {
	return rng() * (max - min) + min;
}

/**
 * Pick one element from an array uniformly at random. Throws on empty arrays — that's almost
 * always a generator bug rather than a runtime condition worth handling gracefully.
 */
export function pickOne<T>(rng: SeededRng, items: readonly T[]): T {
	if (items.length === 0) {
		throw new Error('pickOne: cannot pick from an empty array.');
	}
	const chosen = items[Math.floor(rng() * items.length)];

	if (chosen === undefined) {
		throw new Error('pickOne: computed index fell outside the array bounds.');
	}

	return chosen;
}

/**
 * Pick `count` distinct elements from an array via Fisher-Yates partial shuffle. Caps `count`
 * at `items.length` (silently — picking 100 elements from a 50-element array just returns the
 * full shuffled 50 rather than throwing).
 */
export function pickN<T>(rng: SeededRng, items: readonly T[], count: number): readonly T[] {
	const n = Math.min(count, items.length);
	const copy = items.slice();

	// Partial Fisher-Yates — only shuffle the first `n` slots.
	for (let i = 0; i < n; i++) {
		const j = i + Math.floor(rng() * (copy.length - i));
		const atI = copy[i];
		const atJ = copy[j];

		// Both indices are provably in-bounds (`i < n <= length`, `j < length`), so the
		// elements are present; the guard exists only to satisfy noUncheckedIndexedAccess.
		if (atI === undefined || atJ === undefined) {
			continue;
		}
		copy[i] = atJ;
		copy[j] = atI;
	}

	return copy.slice(0, n);
}

/**
 * Weighted choice — pick one element where each item has a per-item probability weight.
 *
 * @param rng - Seeded RNG
 * @param weightedItems - Array of `[item, weight]` tuples. Weights need not sum to 1; we
 *   normalize internally. Negative weights are clamped to 0 (treated as "never pick this").
 * @returns One item, chosen with probability proportional to its weight
 *
 * @example
 *   pickWeighted(rng, [['red', 0.55], ['white', 0.35], ['rosé', 0.10]]);
 */
export function pickWeighted<T>(
	rng: SeededRng,
	weightedItems: readonly (readonly [T, number])[],
): T {
	const firstEntry = weightedItems[0];

	if (firstEntry === undefined) {
		throw new Error('pickWeighted: cannot pick from empty list.');
	}
	let totalWeight = 0;

	for (const [, weight] of weightedItems) {
		totalWeight += Math.max(0, weight);
	}
	if (totalWeight === 0) {
		// All weights were zero or negative — degrade gracefully to uniform first element.
		return firstEntry[0];
	}
	let target = rng() * totalWeight;

	for (const [item, weight] of weightedItems) {
		target -= Math.max(0, weight);
		if (target <= 0) {
			return item;
		}
	}

	// Numerical-edge fallback — return the last item if rounding pushed us past.
	const lastEntry = weightedItems[weightedItems.length - 1];

	/* v8 ignore next -- defensive: weightedItems is non-empty (firstEntry guard above), so its last element is always defined */
	return (lastEntry ?? firstEntry)[0];
}

/**
 * Approximate normal-distribution sample via the Box-Muller transform, clamped to `[min, max]`.
 * Useful for "price typically clusters around $X" generation where pure uniform sampling looks
 * wrong (no clustering = no real-world feel).
 *
 * @param rng - Seeded RNG
 * @param mean - Center of the distribution
 * @param stdDev - Standard deviation — ~68% of samples fall within ±1σ, ~95% within ±2σ
 * @param min - Hard floor (samples below are clamped, NOT re-rolled — clamping is faster and
 *   the visible artifact is just slight bunching at the limit, which is fine for mock data)
 * @param max - Hard ceiling, same clamping behavior
 */
export function normalSample(
	rng: SeededRng,
	mean: number,
	stdDev: number,
	min: number,
	max: number,
): number {
	// Box-Muller transform — convert two uniform samples to one normal sample.
	const u1 = Math.max(rng(), Number.EPSILON); // avoid log(0)
	const u2 = rng();
	const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
	const value = mean + z * stdDev;

	return Math.min(max, Math.max(min, value));
}

/**
 * Slug-ify a string for use in record ids — lowercase, accent-stripped, non-alphanum collapsed
 * to a single dash, leading/trailing dashes trimmed. Used by every dataset's id construction
 * so ids stay URL-friendly and human-readable.
 *
 * @example
 *   slugify("Hello World — Test"); // "hello-world-test"
 *   slugify("café 2024!");          // "cafe-2024"
 */
export function slugify(input: string): string {
	return input
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '') // strip combining diacritical marks
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}
