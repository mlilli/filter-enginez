/**
 * Procedural books dataset generator. Produces deterministic, realistic-looking `Book[]`
 * records with valid ISBN-13 checksums, genre/subject taxonomy, and publication-year
 * distribution skewed toward the past decade.
 *
 * @remarks
 * This generator is the only source of book data: there is no real-data path, and no
 * OpenLibrary records are included. It mimics OpenLibrary's shape (real-looking author names,
 * valid ISBNs, OpenLibrary-style IDs and subject tags, plausible page counts) so the example filter
 * UI exercises every rule path the books schema declares.
 *
 * @packageDocumentation
 */

import type { Book, BookFormat, BookGenre } from './types.js';

import {
	mulberry32,
	normalSample,
	pickN,
	pickOne,
	pickWeighted,
	randomInt,
	type SeededRng,
	slugify,
} from '../_generation/random.js';

/**
 * Genre weights — roughly reflects English-language publishing distribution. Fiction +
 * mystery + romance dominate; reference is rare.
 *
 * @internal
 */
const GENRE_WEIGHTS: readonly (readonly [BookGenre, number])[] = [
	['fiction', 18],
	['mystery', 10],
	['romance', 9],
	['fantasy', 8],
	['science-fiction', 7],
	['thriller', 7],
	['biography', 6],
	['history', 6],
	['children', 5],
	['young-adult', 5],
	['business', 4],
	['cookbook', 3],
	['science', 3],
	['philosophy', 2],
	['travel', 2],
	['poetry', 1],
	['reference', 1],
];

/**
 * Format weights — paperback dominates, magazine is rare.
 *
 * @internal
 */
const FORMAT_WEIGHTS: readonly (readonly [BookFormat, number])[] = [
	['paperback', 12],
	['hardcover', 6],
	['ebook', 6],
	['audiobook', 4],
	['magazine', 1],
];

/**
 * Language weights — English dominates; small distribution of other widely-published
 * languages so the language filter has multiple values to render.
 *
 * @internal
 */
const LANGUAGE_WEIGHTS: readonly (readonly [string, number])[] = [
	['en', 70],
	['es', 8],
	['fr', 5],
	['de', 5],
	['it', 3],
	['pt', 3],
	['ja', 2],
	['zh', 2],
	['nl', 1],
	['sv', 1],
];

/**
 * Subjects per genre — used to populate the long-tail `subjects: string[]` field. Each book
 * pulls 2-5 subjects from its genre's pool, simulating the OpenLibrary subject-tag pattern.
 *
 * @internal
 */
const SUBJECTS_BY_GENRE: Readonly<Record<BookGenre, readonly string[]>> = {
	biography: ['memoir', 'autobiography', 'celebrity', 'political-figure', 'historical-figure', 'sports'],
	business: ['entrepreneurship', 'management', 'finance', 'marketing', 'leadership', 'economics', 'startups'],
	children: ['picture-book', 'early-reader', 'middle-grade', 'illustrated', 'bedtime', 'educational'],
	cookbook: ['baking', 'italian', 'french', 'asian', 'vegetarian', 'comfort-food', 'desserts'],
	fantasy: ['epic-fantasy', 'urban-fantasy', 'sword-and-sorcery', 'fairy-tale', 'mythology', 'low-fantasy'],
	fiction: ['literary', 'contemporary', 'family-saga', 'coming-of-age', 'epistolary', 'magical-realism', 'satire'],
	history: ['ancient', 'medieval', 'modern', 'military', 'social', 'cultural', 'oral-history'],
	mystery: ['detective', 'cozy', 'noir', 'police-procedural', 'cold-case', 'amateur-sleuth'],
	philosophy: ['ethics', 'metaphysics', 'epistemology', 'political-philosophy', 'phenomenology', 'logic'],
	poetry: ['lyric', 'narrative', 'epic', 'haiku', 'sonnets', 'free-verse', 'collected-works'],
	reference: ['encyclopedia', 'dictionary', 'atlas', 'almanac', 'handbook', 'manual'],
	romance: ['contemporary-romance', 'historical-romance', 'romantic-suspense', 'paranormal-romance', 'enemies-to-lovers'],
	science: ['physics', 'biology', 'chemistry', 'astronomy', 'neuroscience', 'ecology', 'mathematics'],
	'science-fiction': ['space-opera', 'cyberpunk', 'hard-sf', 'dystopian', 'first-contact', 'time-travel', 'biopunk'],
	thriller: ['psychological', 'legal', 'medical', 'political', 'espionage', 'techno-thriller'],
	travel: ['europe', 'asia', 'north-america', 'budget', 'luxury', 'guidebooks', 'travelogue'],
	'young-adult': ['contemporary-ya', 'fantasy-ya', 'romance-ya', 'dystopian-ya', 'lgbtq', 'coming-of-age'],
};

/**
 * Author first / last name pools — gives ~30 × 30 = 900 unique authors, plenty for 1k books.
 *
 * @internal
 */
const AUTHOR_FIRST_NAMES: readonly string[] = [
	'Alexandra',
	'Benjamin',
	'Catherine',
	'Daniel',
	'Eleanor',
	'Frederick',
	'Gabrielle',
	'Henry',
	'Isabel',
	'Jonathan',
	'Katherine',
	'Lawrence',
	'Margaret',
	'Nicholas',
	'Olivia',
	'Patrick',
	'Quentin',
	'Rebecca',
	'Sebastian',
	'Theodora',
	'Ulysses',
	'Veronica',
	'William',
	'Xiomara',
	'Yvonne',
	'Zachary',
	'Amara',
	'Beatrix',
	'Cyrus',
	'Damaris',
];

/** @internal */
const AUTHOR_LAST_NAMES: readonly string[] = [
	'Ashworth',
	'Blackwell',
	'Cromwell',
	'Donovan',
	'Easton',
	'Fairchild',
	'Goldsmith',
	'Hartley',
	'Inglewood',
	'Jardine',
	'Kingsford',
	'Linfield',
	'Merriweather',
	'Northrup',
	'Oxbridge',
	'Penhaligon',
	'Quincey',
	'Ravenscroft',
	'Sinclair',
	'Thornfield',
	'Underhill',
	'Vandermere',
	'Whitlock',
	'Yardley',
	'Zinkov',
	'Abernathy',
	'Brookhaven',
	'Caldwell',
	'Driscoll',
	'Etheridge',
];

/**
 * Publisher pool — fictional but plausible publisher names.
 *
 * @internal
 */
const PUBLISHERS: readonly string[] = [
	'Northbound Press',
	'Lumen Books',
	'Quill & Compass',
	'Riverstone Editions',
	'Ardent House',
	'Halcyon Press',
	'Meridian Books',
	'Argosy Publishing',
	'Birchwood Press',
	'Solstice Editions',
	'Threshold Books',
	'Whitethorn House',
];

/**
 * Compute the valid ISBN-13 check digit for a 12-digit prefix per the ISBN-13 algorithm:
 * sum of digits with alternating ×1/×3 weights, complement modulo 10. Used by the
 * `RegexRule` for ISBN-13 format validation in the books filter-config.
 *
 * @internal
 */
function isbn13CheckDigit(prefix12: string): string {
	let sum = 0;

	for (let i = 0; i < 12; i++) {
		const char = prefix12[i] ?? '0';
		const digit = Number.parseInt(char, 10);

		sum += i % 2 === 0 ? digit : digit * 3;
	}
	const remainder = sum % 10;

	return String((10 - remainder) % 10);
}

/**
 * Generate a plausible book title from genre-appropriate templates. Combining a noun pool +
 * adjective pool + genre-specific connector gives us thousands of unique permutations.
 *
 * @internal
 */
const TITLE_NOUNS: readonly string[] = [
	'Light',
	'Shadow',
	'Echo',
	'Garden',
	'River',
	'House',
	'Letter',
	'Map',
	'Daughter',
	'Stranger',
	'Promise',
	'Inheritance',
	'Storm',
	'Bridge',
	'Mirror',
	'Compass',
	'Quiet',
	'Bone',
	'Threshold',
	'Lantern',
	'Chronicle',
	'Reckoning',
];

/** @internal */
const TITLE_ADJECTIVES: readonly string[] = [
	'Bright',
	'Last',
	'First',
	'Hidden',
	'Silver',
	'Forgotten',
	'Distant',
	'Sudden',
	'Ancient',
	'Quiet',
	'Burning',
	'Restless',
	'Empty',
	'Iron',
	'Glass',
	'Wild',
];

/**
 * Generate one book record.
 *
 * @internal
 */
function generateBook(rng: SeededRng, index: number, tier: 'default' | 'full'): Book {
	const genre = pickWeighted(rng, GENRE_WEIGHTS);
	const format = pickWeighted(rng, FORMAT_WEIGHTS);
	const language = pickWeighted(rng, LANGUAGE_WEIGHTS);

	// Title: "{Adjective} {Noun}" with occasional "of/and" connectors
	const titleAdj = pickOne(rng, TITLE_ADJECTIVES);
	const titleNoun = pickOne(rng, TITLE_NOUNS);
	const title = rng() > 0.6
		? `The ${titleAdj} ${titleNoun}`
		: `${titleAdj} ${titleNoun}`;
	const subtitle = rng() > 0.7 ? `A ${genre.replace(/-/g, ' ')} novel` : '';

	// Authors — 60% single-author, 30% two, 10% three
	const authorCount = rng() > 0.9 ? 3 : rng() > 0.6 ? 2 : 1;
	const authors: string[] = [];

	for (let i = 0; i < authorCount; i++) {
		authors.push(`${pickOne(rng, AUTHOR_FIRST_NAMES)} ${pickOne(rng, AUTHOR_LAST_NAMES)}`);
	}

	// Publication year skewed toward past decade — normal sample around 2018
	const publicationYear = Math.round(normalSample(rng, 2018, 7, 1950, 2025));

	// Page count varies by genre: poetry / children short, history / fantasy long
	let pageMean = 320;

	if (genre === 'poetry' || genre === 'children') {
		pageMean = 90;
	}
	if (genre === 'history' || genre === 'fantasy' || genre === 'biography') {
		pageMean = 420;
	}
	const pageCount = Math.round(normalSample(rng, pageMean, 90, 20, 1200));

	const popularityScore = randomInt(rng, 100, 250_000);
	// 80% have ratings, 20% don't (newly-published books, niche titles)
	const averageRating: number | null = rng() > 0.2
		? Math.round(normalSample(rng, 3.9, 0.5, 1.0, 5.0) * 10) / 10
		: null;

	const isInPrint = publicationYear > 2000 || rng() > 0.3;
	const hasAudiobook = (format === 'audiobook') || rng() > 0.6;

	const publisher = pickOne(rng, PUBLISHERS);

	// ISBN-13: 978 prefix + 9 random digits + check digit. Always valid per the algorithm.
	let isbn12 = '978';

	for (let i = 0; i < 9; i++) {
		isbn12 += String(Math.floor(rng() * 10));
	}
	const isbn13 = isbn12 + isbn13CheckDigit(isbn12);

	// OpenLibrary id format: OL + integer + W (works) or M (editions) — we synthesize M-style
	const openLibraryId = `OL${randomInt(rng, 100_000, 99_999_999)}M`;

	const subjectsPool = SUBJECTS_BY_GENRE[genre];
	const subjects = pickN(rng, subjectsPool, randomInt(rng, 2, 5));

	const description = `${title} ${subtitle ? `(${subtitle})` : ''} — `
		+ `a ${genre.replace(/-/g, ' ')} ${pageCount > 400 ? 'tome' : pageCount > 200 ? 'novel' : 'volume'} `
		+ `by ${authors.join(' and ')}, published in ${publicationYear} by ${publisher}. `
		+ `Subjects include ${subjects.slice(0, 3).join(', ')}.`;

	const id = `${slugify(title)}-${index}`;
	const referenceDate = new Date('2026-05-01T00:00:00Z').getTime();
	const lastUpdated = new Date(referenceDate - randomInt(rng, 0, 365) * 86400_000).toISOString();

	// Cover image — 90% have one, 10% don't (so the ExistsRule has something to filter on)
	const coverImage = rng() > 0.1
		? `https://placehold.co/240x360/0b1220/22d3ee?text=${encodeURIComponent(title.slice(0, 20))}`
		: '';

	return {
		authors,
		averageRating,
		coverImage,
		description,
		format,
		genre,
		hasAudiobook,
		id,
		isbn13,
		isInPrint,
		language,
		lastUpdated,
		openLibraryId,
		pageCount,
		popularityScore,
		publicationYear,
		publisher,
		subjects,
		subtitle,
		tier,
		title,
	};
}

/**
 * Generate `count` book records deterministically from `seed`.
 *
 * @param count - Number of records. Default tier = 10,000; full tier = 100,000.
 * @param seed - 32-bit unsigned integer seed. Default `0xB00C5EE5` for the canonical sample.
 * @param tier - The tier marker.
 * @returns A readonly array of `Book` records
 */
export function generateBooks(
	count: number,
	seed = 0xB00C5EE5,
	tier: 'default' | 'full' = 'default',
): readonly Book[] {
	const rng = mulberry32(seed);
	const books: Book[] = [];

	for (let i = 0; i < count; i++) {
		books.push(generateBook(rng, i, tier));
	}

	return books;
}
