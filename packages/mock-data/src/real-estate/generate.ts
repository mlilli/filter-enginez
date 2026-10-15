/**
 * Procedural real-estate dataset generator. Produces deterministic, realistic-looking
 * `Listing[]` records across eight US metros with per-metro price/sqft/neighborhood
 * distributions.
 *
 * @remarks
 * This generator is the only source of real-estate data: there is no real-data path, and no
 * OpenStreetMap or Zillow records are included. Every listing is drawn from a curated metro
 * table — each metro defines its own bounding box, median price, neighborhoods, and school
 * districts so the resulting `Listing[]` exhibits the same kind of geographic clustering and
 * price stratification real listings show.
 *
 * @packageDocumentation
 */

import type {
	Listing,
	ListingCoordinates,
	ListingFeature,
	ListingGeoCoords,
	ListingStatus,
	PropertyType,
} from './types.js';

import {
	mulberry32,
	normalSample,
	pickOne,
	pickWeighted,
	randomFloat,
	randomInt,
	type SeededRng,
	slugify,
} from '../_generation/random.js';

/**
 * Curated metro table — each entry defines the metro's geographic bounding box (lat/lon
 * range for coordinate generation), median home price (drives the normal-distributed
 * `priceUsd` per listing), and the neighborhood + school-district options that listings in
 * that metro draw from. Median prices approximate 2024 Zillow Home Value Index figures — they
 * are generator parameters only, no Zillow records — so the dataset matches consumer intuitions
 * about regional cost.
 *
 * @internal
 */
const METROS: readonly {
	readonly bbox: { readonly latMax: number; readonly latMin: number; readonly lonMax: number; readonly lonMin: number; };
	readonly cities: readonly string[];
	/** Drives heating/cooling features — `central-ac`, `fireplace`, and the basement exclusion. */
	readonly climate: 'cold' | 'hot' | 'temperate';
	/** Dense urban cores get more `view-city`. */
	readonly isDense: boolean;
	/** Gates `waterfront` and `view-water` — inland metros have neither, ever. */
	readonly isCoastal: boolean;
	/** Gates `view-mountain`. */
	readonly isMountain: boolean;
	readonly medianPrice: number;
	readonly metroArea: string;
	readonly neighborhoods: readonly string[];
	readonly schoolDistricts: readonly string[];
	readonly state: string;
}[] = [
	{
		bbox: { latMax: 37.85, latMin: 37.4, lonMax: -122.15, lonMin: -122.5 },
		cities: ['San Francisco', 'Oakland', 'Berkeley', 'San Mateo'],
		climate: 'temperate',
		isCoastal: true,
		isDense: true,
		isMountain: false,
		medianPrice: 1_400_000,
		metroArea: 'San Francisco Bay Area',
		neighborhoods: ['Mission', 'Noe Valley', 'Pacific Heights', 'SoMa', 'Sunset', 'Rockridge', 'Piedmont', 'Burlingame'],
		schoolDistricts: ['SFUSD', 'Oakland Unified', 'Berkeley Unified', 'San Mateo Union'],
		state: 'CA',
	},
	{
		bbox: { latMax: 42.45, latMin: 42.25, lonMax: -70.95, lonMin: -71.2 },
		cities: ['Boston', 'Cambridge', 'Somerville', 'Brookline'],
		climate: 'cold',
		isCoastal: true,
		isDense: true,
		isMountain: false,
		medianPrice: 850_000,
		metroArea: 'Greater Boston',
		neighborhoods: ['Back Bay', 'Beacon Hill', 'Jamaica Plain', 'Cambridgeport', 'Davis Square', 'Coolidge Corner'],
		schoolDistricts: ['Boston Public', 'Cambridge Public', 'Somerville Public', 'Brookline Public'],
		state: 'MA',
	},
	{
		bbox: { latMax: 40.9, latMin: 40.55, lonMax: -73.7, lonMin: -74.05 },
		cities: ['New York', 'Brooklyn', 'Queens', 'Yonkers'],
		climate: 'cold',
		isCoastal: true,
		isDense: true,
		isMountain: false,
		medianPrice: 1_100_000,
		metroArea: 'NYC Metro',
		neighborhoods: ['Park Slope', 'Williamsburg', 'Upper West Side', 'Astoria', 'Cobble Hill', 'Forest Hills'],
		schoolDistricts: ['NYC Geographic District 15', 'NYC Geographic District 14', 'NYC Geographic District 30'],
		state: 'NY',
	},
	{
		bbox: { latMax: 47.75, latMin: 47.45, lonMax: -122.2, lonMin: -122.4 },
		cities: ['Seattle', 'Bellevue', 'Redmond', 'Kirkland'],
		climate: 'temperate',
		isCoastal: true,
		isDense: false,
		isMountain: true,
		medianPrice: 780_000,
		metroArea: 'Greater Seattle',
		neighborhoods: ['Capitol Hill', 'Ballard', 'Queen Anne', 'Fremont', 'West Seattle', 'Wallingford'],
		schoolDistricts: ['Seattle Public', 'Bellevue School District', 'Lake Washington'],
		state: 'WA',
	},
	{
		bbox: { latMax: 30.45, latMin: 30.2, lonMax: -97.6, lonMin: -97.85 },
		cities: ['Austin', 'Round Rock', 'Cedar Park', 'Pflugerville'],
		climate: 'hot',
		isCoastal: false,
		isDense: false,
		isMountain: false,
		medianPrice: 540_000,
		metroArea: 'Greater Austin',
		neighborhoods: ['South Congress', 'East Austin', 'Hyde Park', 'Mueller', 'Westlake', 'Tarrytown'],
		schoolDistricts: ['Austin ISD', 'Round Rock ISD', 'Leander ISD'],
		state: 'TX',
	},
	{
		bbox: { latMax: 39.85, latMin: 39.6, lonMax: -104.85, lonMin: -105.05 },
		cities: ['Denver', 'Aurora', 'Lakewood', 'Englewood'],
		climate: 'cold',
		isCoastal: false,
		isDense: false,
		isMountain: true,
		medianPrice: 620_000,
		metroArea: 'Greater Denver',
		neighborhoods: ['LoDo', 'Capitol Hill', 'Highland', 'Wash Park', 'Cherry Creek', 'RiNo'],
		schoolDistricts: ['Denver Public', 'Cherry Creek', 'Jeffco Public'],
		state: 'CO',
	},
	{
		bbox: { latMax: 42.05, latMin: 41.8, lonMax: -87.55, lonMin: -87.85 },
		cities: ['Chicago', 'Evanston', 'Oak Park', 'Skokie'],
		climate: 'cold',
		isCoastal: false,
		isDense: true,
		isMountain: false,
		medianPrice: 380_000,
		metroArea: 'Greater Chicago',
		neighborhoods: ['Lincoln Park', 'Wicker Park', 'Logan Square', 'Lakeview', 'Hyde Park', 'Andersonville'],
		schoolDistricts: ['Chicago Public', 'Evanston/Skokie', 'Oak Park River Forest'],
		state: 'IL',
	},
	{
		bbox: { latMax: 25.95, latMin: 25.7, lonMax: -80.15, lonMin: -80.35 },
		cities: ['Miami', 'Miami Beach', 'Coral Gables', 'Hialeah'],
		climate: 'hot',
		isCoastal: true,
		isDense: true,
		isMountain: false,
		medianPrice: 590_000,
		metroArea: 'Greater Miami',
		neighborhoods: ['Brickell', 'Coconut Grove', 'Wynwood', 'Coral Way', 'South Beach', 'Little Havana'],
		schoolDistricts: ['Miami-Dade County Public'],
		state: 'FL',
	},
];

/** Property-type weights — single-family dominates, mobile is rare. @internal */
const PROPERTY_TYPE_WEIGHTS: readonly (readonly [PropertyType, number])[] = [
	['single-family', 12],
	['condo', 6],
	['townhouse', 4],
	['multi-family', 2],
	['land', 1],
	['mobile', 1],
];

/** Listing-status weights — active dominates, sold/off-market are inventory tail. @internal */
const STATUS_WEIGHTS: readonly (readonly [ListingStatus, number])[] = [
	['active', 10],
	['pending', 2],
	['sold', 4],
	['off-market', 1],
];

/** Every feature a listing may carry. @internal */
const FEATURE_POOL: readonly ListingFeature[] = [
	'pool',
	'garage',
	'waterfront',
	'fireplace',
	'central-ac',
	'solar',
	'ev-charger',
	'view-mountain',
	'view-water',
	'view-city',
	'updated-kitchen',
	'finished-basement',
	'open-floor-plan',
	'home-office',
];

/**
 * Per-climate base rates, as lookup tables rather than nested ternaries.
 *
 * @remarks
 * Written this way for readability first — the conditioning reads as data — and because the
 * ternary-chain form pushed `featureProbability` past the repo's complexity cap of 20.
 *
 * @internal
 */
const CLIMATE_RATES = {
	'central-ac': { cold: 0.45, hot: 0.95, temperate: 0.6 },
	fireplace: { cold: 0.55, hot: 0.1, temperate: 0.35 },
	pool: { cold: 0.08, hot: 0.55, temperate: 0.25 },
	solar: { cold: 0.1, hot: 0.22, temperate: 0.22 },
} as const satisfies Record<string, Record<'cold' | 'hot' | 'temperate', number>>;

/** Built from 2000 onward — drives the "modern construction" features. @internal */
function isModern(ctx: FeatureContext): boolean {
	return ctx.yearBuilt >= 2000;
}

/** @internal */
function isCondo(ctx: FeatureContext): boolean {
	return ctx.propertyType === 'condo';
}

/** No dwelling to attach a pool to. @internal */
function isLandOrMobile(ctx: FeatureContext): boolean {
	return ctx.propertyType === 'land' || ctx.propertyType === 'mobile';
}

/**
 * One probability function per feature.
 *
 * @remarks
 * A lookup table rather than a `switch`: the switch form tripped the repo's complexity cap (33
 * against a limit of 20) purely from having fourteen arms, and a table keeps each rule readable in
 * isolation — a reader checking "why is there no basement in Miami" reads one line, not a branch.
 *
 * @internal
 */
const FEATURE_MODEL: Record<ListingFeature, (ctx: FeatureContext) => number> = {
	'central-ac': (c) => CLIMATE_RATES['central-ac'][c.climate] * (isModern(c) ? 1.15 : 0.8),
	// Gated on `garage` by `deriveFeatures` — a charger needs somewhere to put it.
	'ev-charger': (c) => 0.3 * (c.yearBuilt >= 2010 ? 1.7 : 0.35),
	'finished-basement': (c) => (c.climate === 'hot' ? 0 : 0.45 * (isCondo(c) ? 0.1 : 1)),
	fireplace: (c) => CLIMATE_RATES.fireplace[c.climate] * (c.yearBuilt < 1980 ? 1.3 : 0.7),
	garage: (c) => 0.65 * (isCondo(c) ? 0.25 : 1),
	'home-office': (c) => (isModern(c) ? 0.45 : 0.2),
	'open-floor-plan': (c) => (isModern(c) ? 0.55 : 0.2),
	pool: (c) => (isLandOrMobile(c) ? 0 : CLIMATE_RATES.pool[c.climate] * (isCondo(c) ? 0.15 : 1)),
	// Roof rights, so effectively never on a condo.
	solar: (c) => (isCondo(c) ? 0 : CLIMATE_RATES.solar[c.climate] * (isModern(c) ? 1.6 : 0.5)),
	'updated-kitchen': () => 0.4,
	'view-city': (c) => (c.isDense ? 0.3 : 0.1) * (isCondo(c) ? 1.5 : 0.7),
	'view-mountain': (c) => (c.isMountain ? 0.35 : 0),
	// Also forced on by `deriveFeatures` whenever `waterfront` was drawn.
	'view-water': (c) => (c.isCoastal ? 0.25 : 0),
	waterfront: (c) => (c.isCoastal ? 0.1 : 0),
};

/** The metro traits a feature draw is conditioned on. @internal */
interface FeatureContext {
	readonly climate: 'cold' | 'hot' | 'temperate';
	readonly isCoastal: boolean;
	readonly isDense: boolean;
	readonly isMountain: boolean;
	readonly propertyType: PropertyType;
	readonly yearBuilt: number;
}

/**
 * Per-listing probability that a feature is present, conditioned on climate, geography, property
 * type and era.
 *
 * @remarks
 * Drawing features uniformly — `pickN(rng, FEATURE_POOL, 2..6)` — would make every pair
 * statistically independent. Across 10k listings essentially every combination would co-occur
 * somewhere, so nothing a user picks could ever contradict anything else. That is fine for
 * exercising a filter, and useless for demonstrating anything that reasons about co-occurrence:
 * the predictive-disable checklist would not disable a feature until five were stacked, and the
 * suggested-filters (Bayesian) and find-similar (MinHash/LSH) demos would have no signal to find.
 *
 * **Returning 0 is the point, not an edge case.** Four hard exclusions give the UI real
 * contradictions to catch, each one defensible rather than arbitrary:
 *
 *   - `waterfront` / `view-water` — coastal metros only. Denver, Austin and Chicago have none.
 *   - `view-mountain` — Seattle and Denver only.
 *   - `finished-basement` — never in a hot climate. Miami's water table and Texas slab
 *     construction are the real-world reasons; it is also the exclusion most likely to surprise,
 *     which makes it a good demo.
 *   - `pool` — never on `land` (nothing built) or `mobile`.
 *
 * So "waterfront + view-mountain" narrows to Seattle alone, and "waterfront + finished-basement"
 * excludes Miami, leaving the colder coastal metros. Those are the kinds of pair a user can
 * discover the engine already knows about.
 *
 * @param feature - The feature being considered.
 * @param ctx - The listing's metro traits, property type and build year.
 * @returns Probability in `[0, 1]`; exactly `0` means "impossible here".
 */
function featureProbability(feature: ListingFeature, ctx: FeatureContext): number {
	return FEATURE_MODEL[feature](ctx);
}

/**
 * Draw a listing's feature set from {@link featureProbability}, then apply the two implications
 * that are structural rather than probabilistic.
 *
 * @remarks
 * `waterfront` implies `view-water` (you can see what you are on), and `ev-charger` requires
 * `garage`. Encoding these as post-draw rules rather than probabilities keeps them absolute — a
 * waterfront listing without a water view would be a data bug, not an unlikely sample.
 *
 * A listing that draws nothing gets `updated-kitchen`, the one feature with no conditions on it,
 * so the marketing description never renders an empty feature list.
 *
 * @param rng - The seeded generator.
 * @param ctx - The listing's traits.
 * @returns The feature list, in `FEATURE_POOL` order for stable output.
 */
function deriveFeatures(rng: SeededRng, ctx: FeatureContext): readonly ListingFeature[] {
	const chosen = new Set<ListingFeature>();

	for (const feature of FEATURE_POOL) {
		if (rng() < featureProbability(feature, ctx)) {
			chosen.add(feature);
		}
	}

	if (chosen.has('waterfront')) {
		chosen.add('view-water');
	}
	if (!chosen.has('garage')) {
		chosen.delete('ev-charger');
	}
	if (chosen.size === 0) {
		chosen.add('updated-kitchen');
	}

	return FEATURE_POOL.filter((feature) => chosen.has(feature));
}

/** Street-name patterns for synthetic addresses. @internal */
const STREET_PREFIXES: readonly string[] = [
	'Main',
	'Oak',
	'Maple',
	'Cedar',
	'Elm',
	'Pine',
	'Walnut',
	'Cherry',
	'Birch',
	'Spruce',
	'Lake',
	'Park',
	'Hill',
	'Vista',
	'Sunset',
	'Highland',
	'Forest',
	'Riverside',
	'Lincoln',
	'Madison',
];

/** Street-name suffixes — varied to keep addresses from looking too uniform. @internal */
const STREET_SUFFIXES: readonly string[] = [
	'Street', 'Avenue', 'Boulevard', 'Drive', 'Lane', 'Road', 'Way', 'Court', 'Place', 'Terrace',
];

/**
 * Generate a single listing record at the given index. Deterministic given the seed.
 *
 * @internal
 */
function generateListing(rng: SeededRng, index: number, tier: 'default' | 'full'): Listing {
	const metro = pickOne(rng, METROS);
	const city = pickOne(rng, metro.cities);
	const neighborhood = pickOne(rng, metro.neighborhoods);
	const schoolDistrict = pickOne(rng, metro.schoolDistricts);

	// Coordinates within the metro bounding box — gives the geo-proximity filter realistic
	// clustering to work against.
	const coordinates: ListingCoordinates = {
		lat: Math.round(randomFloat(rng, metro.bbox.latMin, metro.bbox.latMax) * 1_000_000) / 1_000_000,
		lon: Math.round(randomFloat(rng, metro.bbox.lonMin, metro.bbox.lonMax) * 1_000_000) / 1_000_000,
	};
	// The same point in the `{ lat, lng }` shape `GeoProximityRule` reads, so a geo rule can name the
	// field by string and survive serialization (see `Listing.coords`). Copied, not drawn: no extra RNG
	// call, so every other field of every listing is unchanged.
	const coords: ListingGeoCoords = { lat: coordinates.lat, lng: coordinates.lon };

	// Price normally distributed around metro median, capped so we don't get negative or
	// $30M-listing outliers (those exist in real life but skew the dataset's UX badly).
	const priceUsd = Math.round(normalSample(rng, metro.medianPrice, metro.medianPrice * 0.4, 75_000, metro.medianPrice * 5));

	// Square footage broadly correlates with price but has wide variance — quick proxy: scale
	// by metro-relative price ratio, then add noise.
	const sqftBase = 1200 + (priceUsd / metro.medianPrice) * 1500;
	const squareFeet = Math.round(normalSample(rng, sqftBase, 600, 400, 8000));

	const bedrooms = randomInt(rng, 1, 6);
	// Bathrooms typically 0.5-1.5 × bedrooms; round to nearest 0.5
	const bathrooms = Math.round(randomFloat(rng, bedrooms * 0.5, bedrooms * 1.2) * 2) / 2;
	const yearBuilt = randomInt(rng, 1900, 2025);
	const lotSizeAcres = Math.round(randomFloat(rng, 0.05, 2.5) * 100) / 100;

	const propertyType = pickWeighted(rng, PROPERTY_TYPE_WEIGHTS);
	const status = pickWeighted(rng, STATUS_WEIGHTS);

	// Conditioned on the metro's climate/geography plus this listing's type and era — see
	// `featureProbability` for why, and for the four hard exclusions it encodes.
	const features = deriveFeatures(rng, {
		climate: metro.climate,
		isCoastal: metro.isCoastal,
		isDense: metro.isDense,
		isMountain: metro.isMountain,
		propertyType,
		yearBuilt,
	});

	// Address: number + prefix + suffix
	const streetNumber = randomInt(rng, 1, 9999);
	const streetPrefix = pickOne(rng, STREET_PREFIXES);
	const streetSuffix = pickOne(rng, STREET_SUFFIXES);
	const addressLine1 = `${streetNumber} ${streetPrefix} ${streetSuffix}`;

	// ZIP: 5-digit synthetic — first digit reflects state zone loosely (CA=9, NY=1, TX=7,
	// MA=0, WA=9, CO=8, IL=6, FL=3). Adequate for filter-UI purposes.
	const zip = String(randomInt(rng, 10000, 99999));

	// MLS id — 8-char alphanumeric uppercase
	const mlsIdChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	let mlsId = '';

	for (let i = 0; i < 8; i++) {
		mlsId += mlsIdChars[Math.floor(rng() * mlsIdChars.length)];
	}

	// Dates — listed within past 90 days (reference 2026-05-01); open-house dates fall on
	// upcoming weekends if listing is active, otherwise none.
	const referenceDate = new Date('2026-05-01T00:00:00Z').getTime();
	const listedDate = new Date(referenceDate - randomInt(rng, 0, 90) * 86400_000).toISOString();
	const openHouseDates = status === 'active' && rng() > 0.5
		? [
			new Date(referenceDate + randomInt(rng, 1, 14) * 86400_000).toISOString(),
			...(rng() > 0.5 ? [new Date(referenceDate + randomInt(rng, 15, 28) * 86400_000).toISOString()] : []),
		]
		: [];

	// Marketing
	const title = `${bedrooms}BR ${propertyType.replace(/-/g, ' ')} in ${neighborhood}`;
	const description = `Bright ${propertyType.replace(/-/g, ' ')} home in the heart of ${neighborhood}, ${city}. `
		+ `Features ${features.slice(0, 3).join(', ')}. `
		+ `Built ${yearBuilt} on a ${lotSizeAcres}-acre lot. ${metro.metroArea} school district: ${schoolDistrict}.`;

	const id = `${slugify(`${city}-${neighborhood}-${streetPrefix}-${streetNumber}`)}-${index}`;
	const lastUpdated = new Date(referenceDate - randomInt(rng, 0, 30) * 86400_000).toISOString();

	return {
		addressLine1,
		bathrooms,
		bedrooms,
		city,
		coordinates,
		coords,
		description,
		features,
		id,
		lastUpdated,
		listedDate,
		// Materialized composite path — see the `locationId` docblock on `Listing` for why this is
		// a stored field rather than something the location filter derives on the fly.
		locationId: `${metro.state}/${metro.metroArea}/${neighborhood}`,
		lotSizeAcres,
		metroArea: metro.metroArea,
		mlsId,
		neighborhood,
		openHouseDates,
		photos: [
			`https://placehold.co/600x400/0b1220/22d3ee?text=${encodeURIComponent(`${bedrooms}BR ${neighborhood}`)}`,
		],
		priceUsd,
		propertyType,
		schoolDistrict,
		squareFeet,
		state: metro.state,
		status,
		tier,
		title,
		yearBuilt,
		zip,
	};
}

/**
 * Generate `count` listing records deterministically from `seed`.
 *
 * @param count - Number of records to generate. Default tier = 10,000; full tier = 50,000.
 * @param seed - 32-bit unsigned integer seed. Default `0x1357BEEF` for the canonical sample.
 * @param tier - The tier marker to stamp onto every record.
 * @returns A readonly array of `Listing` records
 */
export function generateListings(
	count: number,
	seed = 0x1357BEEF,
	tier: 'default' | 'full' = 'default',
): readonly Listing[] {
	const rng = mulberry32(seed);
	const listings: Listing[] = [];

	for (let i = 0; i < count; i++) {
		listings.push(generateListing(rng, i, tier));
	}

	return listings;
}
