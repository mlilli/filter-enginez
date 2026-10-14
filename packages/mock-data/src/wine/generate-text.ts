/**
 * Tasting notes and descriptions for the synthetic wine generator (`./generate.ts`).
 *
 * @remarks
 * Two steps per wine:
 *
 *   1. **Choose descriptors.** Every word in the descriptor vocabulary is included independently,
 *      with the probability measured for reviews of the wine's varietal (or, for a varietal without
 *      its own profile, its color). So "cassis" turns up in about one Cabernet Sauvignon in five and
 *      almost never in a Riesling, and across the tier each descriptor appears about as often as it
 *      does in real reviews. Higher-scoring wines get proportionally more descriptors, as real
 *      reviews of them run longer.
 *   2. **Write the note.** The chosen descriptors are set into short sentences (nose, palate,
 *      structure, finish), around an opening line on the wine's place and style, a quality remark
 *      that follows the score and, for some wines, a drinking window. The sentence frames are this package's own and deliberately avoid every
 *      vocabulary word, so the only descriptors in a description are the chosen ones.
 *
 * `tastingNotes` lists the chosen descriptors in the order the description uses them, at most six:
 * the same definition the local real-corpus import applies to real reviews.
 *
 * @packageDocumentation
 */

import type { WineBody, WineColor } from './types.js';

import { pickOne, randomInt, type SeededRng } from '../_generation/random.js';
import {
	DESCRIPTION_WORDS_BY_POINTS,
	DESCRIPTOR_PER_MILLE_BY_COLOR,
	DESCRIPTOR_PER_MILLE_BY_VARIETAL,
	DESCRIPTOR_VOCABULARY,
	MIN_POINTS,
	POINTS_HISTOGRAM,
} from './generate-profile.js';

/** Most descriptors a wine's `tastingNotes` lists. */
export const MAX_TASTING_NOTES = 6;

/** Highest inclusion probability any descriptor reaches after the score scaling. */
const MAX_DESCRIPTOR_PROBABILITY = 0.95;

/** Category of `tannins` and `acidity`, which go into the structure sentence rather than a flavor list. */
const STRUCTURE_CATEGORY = 'structure';

/**
 * Mean review length over all reviews (each score weighted by how many reviews have it): the
 * denominator of {@link verbosityFor}, so that verbosity averages 1 across the tier.
 */
const MEAN_DESCRIPTION_WORDS = DESCRIPTION_WORDS_BY_POINTS.reduce((sum, words, index) => sum + words * (POINTS_HISTOGRAM[index] ?? 0), 0)
	/ POINTS_HISTOGRAM.reduce((sum, reviews) => sum + reviews, 0);

/**
 * How much longer than average a review at this score runs: about 0.65 at 80 points, 1.7 at 100.
 *
 * @param points - The wine's score.
 * @returns The ratio of the score's mean review length to the overall mean.
 */
function verbosityFor(points: number): number {
	return (DESCRIPTION_WORDS_BY_POINTS[points - MIN_POINTS] ?? MEAN_DESCRIPTION_WORDS) / MEAN_DESCRIPTION_WORDS;
}

/**
 * Parse a space-separated per-mille string into inclusion probabilities.
 *
 * @param perMille - One per-mille value per vocabulary entry.
 * @returns Probabilities in `[0, 1]`, in vocabulary order.
 */
function parseProbabilities(perMille: string): Float64Array {
	const values = perMille.split(' ');
	const probabilities = new Float64Array(DESCRIPTOR_VOCABULARY.length);

	for (let index = 0; index < probabilities.length; index++) {
		probabilities[index] = Number(values[index] ?? '0') / 1000;
	}

	return probabilities;
}

/** Parsed probability profiles, built on first use: one per color, one per profiled varietal. */
let profileCache: {
	readonly byColor: ReadonlyMap<WineColor, Float64Array>;
	readonly byVarietal: ReadonlyMap<string, Float64Array>;
} | null = null;

/**
 * The descriptor probability profile for a wine.
 *
 * @param varietal - The wine's varietal; profiled varietals use their own measured frequencies.
 * @param color - Its color, whose profile covers every other varietal.
 * @returns Inclusion probabilities, in vocabulary order.
 */
function profileFor(varietal: string, color: WineColor): Float64Array {
	profileCache ??= {
		byColor: new Map(Object.entries(DESCRIPTOR_PER_MILLE_BY_COLOR).map(([key, perMille]) => [key as WineColor, parseProbabilities(perMille)])),
		byVarietal: new Map(DESCRIPTOR_PER_MILLE_BY_VARIETAL.map(([name, perMille]) => [name, parseProbabilities(perMille)])),
	};

	const own = profileCache.byVarietal.get(varietal);

	if (own !== undefined) {
		return own;
	}

	const fallback = profileCache.byColor.get(color);

	/* v8 ignore next 3 -- every WineColor has a profile; the guard satisfies noUncheckedIndexedAccess */
	if (fallback === undefined) {
		throw new Error(`No descriptor profile for color ${color}.`);
	}

	return fallback;
}

/**
 * Choose the descriptors a wine's note mentions.
 *
 * @param rng - Seeded random source of the record being generated.
 * @param varietal - The wine's varietal.
 * @param color - The wine's color.
 * @param points - The wine's score; higher scores scale every probability up.
 * @returns Vocabulary indices, ascending.
 */
export function chooseDescriptors(rng: SeededRng, varietal: string, color: WineColor, points: number): number[] {
	const probabilities = profileFor(varietal, color);
	const scale = verbosityFor(points);
	const chosen: number[] = [];

	for (let index = 0; index < probabilities.length; index++) {
		if (rng() < Math.min(MAX_DESCRIPTOR_PROBABILITY, (probabilities[index] ?? 0) * scale)) {
			chosen.push(index);
		}
	}

	return chosen;
}

/** Inputs to {@link writeTastingText}. */
export interface TastingTextInput {
	readonly body: WineBody;
	readonly color: WineColor;
	/** Vocabulary indices from {@link chooseDescriptors}. */
	readonly descriptorIndices: readonly number[];
	readonly isNonVintage: boolean;
	/** The place an opening sentence may name: the wine's region, or its province. */
	readonly place: string;
	readonly points: number;
	readonly varietal: string;
	readonly vintage: number;
}

/** A written note: the prose and the descriptors it lists. */
export interface TastingText {
	readonly description: string;
	readonly tastingNotes: readonly string[];
}

/** How each body level reads in prose. */
const BODY_PHRASES: Readonly<Record<WineBody, string>> = {
	full: 'full-bodied',
	light: 'light-bodied',
	medium: 'medium-bodied',
	'medium-full': 'medium- to full-bodied',
	'medium-light': 'light- to medium-bodied',
};

/** Adjectives for the palate's texture. None is a vocabulary word. */
const PALATE_ADJECTIVES: readonly string[] = ['juicy', 'round', 'focused', 'generous', 'dense', 'supple', 'plush', 'lean', 'concentrated', 'silky', 'textured', 'polished'];

/** Adjectives for tannins. */
const TANNIN_ADJECTIVES: readonly string[] = ['Firm', 'Supple', 'Fine-grained', 'Dusty', 'Polished', 'Ripe', 'Grippy', 'Velvety', 'Chewy', 'Soft', 'Silky', 'Taut'];

/** Adjectives for acidity. */
const ACIDITY_ADJECTIVES: readonly string[] = ['bright', 'fresh', 'crisp', 'lively', 'zesty', 'racy', 'brisk', 'vibrant', 'balanced', 'mouthwatering'];

/** Adjectives for the finish. */
const FINISH_ADJECTIVES: readonly string[] = ['long', 'lingering', 'persistent', 'clean', 'lively', 'short', 'warm', 'dry', 'lasting', 'medium-length'];

/** Quality remarks by score band, lowest band first; each band starts at its `minimumPoints`. */
const QUALITY_REMARKS: readonly (readonly [minimumPoints: number, remarks: readonly string[]])[] = [
	[80, ['A simple, everyday wine.', 'Light and straightforward.', 'It feels a little thin.', 'Somewhat rustic, but drinkable.', 'A bit dilute.']],
	[84, ['An easygoing, pleasant wine.', 'Uncomplicated and ready to drink.', 'A solid value.', 'Fair balance overall.', 'Simple but satisfying.']],
	[87, ['Well made and balanced.', 'Attractive and approachable.', 'A very good, food-friendly bottle.', 'Nicely balanced throughout.', 'Delicious now.']],
	[90, ['Concentrated and elegant.', 'A polished, layered wine.', 'Impressive depth and balance.', 'Complex and structured.', 'Refined and expressive.']],
	[94, ['A profound, beautifully balanced wine.', 'Stunning concentration and length.', 'Superb, with great aging potential.', 'A wine of real distinction.']],
];

/**
 * Join words as an English list: "a", "a and b", "a, b and c".
 *
 * @param words - At least one word.
 * @returns The joined list.
 */
function englishList(words: readonly string[]): string {
	if (words.length <= 1) {
		return words.join('');
	}

	return `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`;
}

/**
 * Upper-case the first character.
 *
 * @param text - Any text.
 * @returns The text with its first character capitalized.
 */
function capitalize(text: string): string {
	return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** Style phrases for the opening sentence. None is a vocabulary word. */
const STYLE_PHRASES: readonly string[] = ['a ripe, generous style', 'a restrained, elegant style', 'a juicy, approachable style', 'a structured, age-worthy style', 'a bold, forward style', 'a fresh, easygoing style', 'a classic, balanced style', 'a modern, polished style'];

/** Texture adjectives for the sentence that stands in for structure when neither tannins nor acidity is named. */
const TEXTURE_ADJECTIVES: readonly string[] = ['smooth', 'soft', 'round', 'tight', 'broad', 'firm', 'light', 'rich', 'ample', 'brisk'];

/**
 * The opening sentence: where the wine comes from and its style.
 *
 * @param rng - Seeded random source.
 * @param input - The wine.
 * @returns One sentence.
 */
function openingSentence(rng: SeededRng, input: TastingTextInput): string {
	const style = pickOne(rng, STYLE_PHRASES);

	switch (randomInt(rng, 0, 3)) {
		case 0: { return `From ${input.place}, this ${input.varietal} is made in ${style}.`; }
		case 1: { return `Sourced from vineyards in ${input.place}, it shows ${style}.`; }
		case 2: {
			return input.isNonVintage
				? `This nonvintage ${input.varietal} from ${input.place} is made in ${style}.`
				: `The ${input.vintage} vintage gives this ${input.varietal} from ${input.place} ${style}.`;
		}
		default: { return `This bottling from ${input.place} offers ${input.varietal} in ${style}.`; }
	}
}

/**
 * The texture sentence, written instead of a structure sentence when neither tannins nor acidity
 * was chosen.
 *
 * @param rng - Seeded random source.
 * @returns One sentence.
 */
function textureSentence(rng: SeededRng): string {
	const first = pickOne(rng, TEXTURE_ADJECTIVES);
	const second = pickOne(rng, TEXTURE_ADJECTIVES.filter((adjective) => adjective !== first));

	return randomInt(rng, 0, 1) === 0 ? `The texture is ${first} and ${second}.` : `It feels ${first} and ${second} in the mouth.`;
}

/**
 * The nose sentence.
 *
 * @param rng - Seeded random source.
 * @param terms - Descriptors for the nose; at least one.
 * @param varietal - The wine's varietal, which one frame names.
 * @returns One sentence.
 */
function noseSentence(rng: SeededRng, terms: readonly string[], varietal: string): string {
	const list = englishList(terms);

	switch (randomInt(rng, 0, 5)) {
		case 0: { return `Aromas of ${list} lead the way.`; }
		case 1: { return `The nose offers ${list}.`; }
		case 2: { return `Scents of ${list} rise from the glass.`; }
		case 3: { return `This ${varietal} opens with ${list}.`; }
		case 4: { return `${capitalize(list)} ${terms.length === 1 ? 'comes' : 'come'} first on the nose.`; }
		default: { return `It opens with hints of ${list}.`; }
	}
}

/**
 * The palate sentence.
 *
 * @param rng - Seeded random source.
 * @param terms - Descriptors for the palate; may be empty.
 * @param body - The wine's body.
 * @returns One sentence.
 */
function palateSentence(rng: SeededRng, terms: readonly string[], body: WineBody): string {
	const bodyPhrase = BODY_PHRASES[body];
	const adjective = pickOne(rng, PALATE_ADJECTIVES);

	if (terms.length === 0) {
		return `The palate is ${bodyPhrase} and ${adjective}.`;
	}

	const list = englishList(terms);

	switch (randomInt(rng, 0, 3)) {
		case 0: { return `The ${bodyPhrase} palate delivers ${list}.`; }
		case 1: { return `${capitalize(bodyPhrase)} and ${adjective}, it offers flavors of ${list}.`; }
		case 2: { return `Flavors of ${list} follow on a ${adjective}, ${bodyPhrase} palate.`; }
		default: { return `In the mouth, ${list} ${terms.length === 1 ? 'carries' : 'carry'} through a ${adjective} texture.`; }
	}
}

/**
 * The structure sentence, naming tannins, acidity or both.
 *
 * @param rng - Seeded random source.
 * @param hasTannins - Whether `tannins` was chosen.
 * @param hasAcidity - Whether `acidity` was chosen.
 * @returns One sentence.
 */
function structureSentence(rng: SeededRng, hasTannins: boolean, hasAcidity: boolean): string {
	const tannin = pickOne(rng, TANNIN_ADJECTIVES);
	const acid = pickOne(rng, ACIDITY_ADJECTIVES);

	if (hasTannins && hasAcidity) {
		return `${tannin} tannins and ${acid} acidity ${pickOne(rng, ['give it shape', 'provide the frame', 'keep it in balance'])}.`;
	}
	if (hasTannins) {
		return `${tannin} tannins ${pickOne(rng, ['frame the fruit', 'support the finish', 'need time to soften', 'carry the wine'])}.`;
	}

	return `${capitalize(acid)} acidity ${pickOne(rng, ['keeps it lively', 'lifts the finish', 'brings freshness', 'cuts through the fruit'])}.`;
}

/**
 * The finish sentence.
 *
 * @param rng - Seeded random source.
 * @param terms - Descriptors for the finish; may be empty.
 * @returns One sentence.
 */
function finishSentence(rng: SeededRng, terms: readonly string[]): string {
	const adjective = pickOne(rng, FINISH_ADJECTIVES);

	if (terms.length === 0) {
		return `The finish is ${adjective}.`;
	}

	const list = englishList(terms);

	return randomInt(rng, 0, 1) === 0 ? `The finish is ${adjective}, with ${list}.` : `It finishes ${adjective} on notes of ${list}.`;
}

/**
 * A quality remark for the wine's score band.
 *
 * @param rng - Seeded random source.
 * @param points - The wine's score.
 * @returns One sentence.
 */
function qualityRemark(rng: SeededRng, points: number): string {
	let remarks: readonly string[] = [];

	for (const [minimumPoints, bandRemarks] of QUALITY_REMARKS) {
		if (points >= minimumPoints) {
			remarks = bandRemarks;
		}
	}

	return pickOne(rng, remarks);
}

/**
 * A drinking-window sentence.
 *
 * @param rng - Seeded random source.
 * @param input - The wine; non-vintage and low-scoring wines are simply for drinking now.
 * @returns One sentence.
 */
function drinkSentence(rng: SeededRng, input: TastingTextInput): string {
	if (input.isNonVintage || input.points < 88) {
		return 'Drink now.';
	}

	const until = input.vintage + randomInt(rng, 6, 12 + Math.max(0, input.points - 90) * 2);

	return randomInt(rng, 0, 2) === 0 ? `Best from ${input.vintage + randomInt(rng, 4, 8)}.` : `Drink now through ${until}.`;
}

/*
 * Base shares of the optional sentences, for a wine of average verbosity. Each is scaled by the
 * square of the wine's verbosity, so a 95-point note runs about twice as long as an 82-point one,
 * as in real reviews.
 */

/** Base share of notes that open with where the wine comes from and its style. */
const OPENING_SENTENCE_SHARE = 0.8;

/** Base share of notes without tannins or acidity named that describe the texture instead. */
const TEXTURE_SENTENCE_SHARE = 0.45;

/** Base share of notes with a quality remark. */
const QUALITY_REMARK_SHARE = 0.7;

/** Base share of notes with a drinking window. */
const DRINK_WINDOW_SHARE = 0.35;

/** Base share of notes that describe the finish even when no descriptor was left for it. */
const PLAIN_FINISH_SHARE = 0.5;

/** Base share of notes with a sentence on cellaring. */
const CELLARING_SENTENCE_SHARE = 0.18;

/** Sentences on cellaring. None is a vocabulary word. */
const CELLARING_SENTENCES: readonly string[] = [
	'It has the structure to age for a decade or more.',
	'Give it a few years in the cellar to come together.',
	'Decant it if you open a bottle soon.',
	'It will reward patient cellaring.',
	'There is enough concentration here to improve with time.',
	'Approachable now, it should also hold well for several years.',
];

/**
 * Write a wine's description and `tastingNotes` from its chosen descriptors.
 *
 * @param rng - Seeded random source of the record being generated.
 * @param input - The wine and its descriptors.
 * @returns The description, and the descriptors it lists in order of mention (at most six).
 */
export function writeTastingText(rng: SeededRng, input: TastingTextInput): TastingText {
	const flavors: string[] = [];
	let hasTannins = false;
	let hasAcidity = false;

	for (const index of input.descriptorIndices) {
		const [descriptor, category] = DESCRIPTOR_VOCABULARY[index] ?? ['', STRUCTURE_CATEGORY];

		if (category !== STRUCTURE_CATEGORY) {
			flavors.push(descriptor);
		} else if (descriptor === 'tannins') {
			hasTannins = true;
		} else {
			hasAcidity = true;
		}
	}

	// Shuffle so the vocabulary's order (fruit first) does not decide what goes on the nose.
	for (let position = flavors.length - 1; position > 0; position--) {
		const swapWith = randomInt(rng, 0, position);
		const atPosition = flavors[position] ?? '';

		flavors[position] = flavors[swapWith] ?? '';
		flavors[swapWith] = atPosition;
	}

	const noseCount = Math.min(4, Math.ceil(flavors.length / 2));
	const nose = flavors.slice(0, noseCount);
	const palate = flavors.slice(noseCount, noseCount + 4);
	const finish = flavors.slice(noseCount + 4);
	const sentences: string[] = [];
	const mentioned: string[] = [...nose, ...palate];
	const verbosity = verbosityFor(input.points);
	const lengthFactor = verbosity * verbosity;
	const includes = (baseShare: number): boolean => rng() < baseShare * lengthFactor;

	if (includes(OPENING_SENTENCE_SHARE)) {
		sentences.push(openingSentence(rng, input));
	}
	if (nose.length > 0) {
		sentences.push(noseSentence(rng, nose, input.varietal));
	}
	sentences.push(palateSentence(rng, palate, input.body));
	if (hasTannins || hasAcidity) {
		sentences.push(structureSentence(rng, hasTannins, hasAcidity));
		if (hasTannins) {
			mentioned.push('tannins');
		}
		if (hasAcidity) {
			mentioned.push('acidity');
		}
	} else if (includes(TEXTURE_SENTENCE_SHARE)) {
		sentences.push(textureSentence(rng));
	}
	if (includes(QUALITY_REMARK_SHARE)) {
		sentences.push(qualityRemark(rng, input.points));
	}
	if (finish.length > 0 || includes(PLAIN_FINISH_SHARE)) {
		sentences.push(finishSentence(rng, finish));
		mentioned.push(...finish);
	}
	if (includes(CELLARING_SENTENCE_SHARE)) {
		sentences.push(pickOne(rng, CELLARING_SENTENCES));
	}
	if (includes(DRINK_WINDOW_SHARE)) {
		sentences.push(drinkSentence(rng, input));
	}

	return { description: sentences.join(' '), tastingNotes: mentioned.slice(0, MAX_TASTING_NOTES) };
}
