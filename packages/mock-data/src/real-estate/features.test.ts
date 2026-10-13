/**
 * Invariants for the correlated real-estate feature generator.
 *
 * @remarks
 * These pin the STRUCTURE of the feature distribution, not the exact counts — counts shift with any
 * probability tweak, but the exclusions and implications are load-bearing and must not.
 *
 * They matter because the correlation is invisible from the app: if `featureProbability` regressed
 * to something uniform, every filter would still work, every test elsewhere would still pass, and
 * the only symptom would be that predictive disable quietly stopped disabling anything and the
 * co-occurrence demos lost their signal. That is precisely the kind of silent regression worth a
 * test.
 */

import { describe, expect, it } from 'vitest';

import type { ListingFeature } from './types.js';

import { listings } from './data.js';

/** Metros with no coastline — `waterfront` and `view-water` must be impossible in all of them. */
const INLAND = ['Greater Austin', 'Greater Chicago', 'Greater Denver'];

/** The only two metros with mountains in view. */
const MOUNTAIN = ['Greater Denver', 'Greater Seattle'];

/** Hot-climate metros — slab construction / water table, so no basements. */
const HOT = ['Greater Austin', 'Greater Miami'];

/** Does a listing carry the given feature? */
function has(listing: (typeof listings)[number], feature: ListingFeature): boolean {
	return listing.features.includes(feature);
}

/** Every metro that has at least one listing carrying `feature`. */
function metrosWith(feature: ListingFeature): readonly string[] {
	return Array.from(new Set(listings.filter((l) => has(l, feature)).map((l) => l.metroArea))).sort();
}

describe('real-estate feature correlation', () => {
	it('gives every listing at least one feature', () => {
		// The marketing description interpolates `features.slice(0, 3)`, so an empty set would
		// render "Features . " — the generator floors it rather than letting that through.
		expect(listings.every((l) => l.features.length > 0)).toBe(true);
	});

	it('confines waterfront and water views to coastal metros', () => {
		for (const metro of INLAND) {
			expect(metrosWith('waterfront')).not.toContain(metro);
			expect(metrosWith('view-water')).not.toContain(metro);
		}
	});

	it('confines mountain views to the two metros that have mountains', () => {
		expect(metrosWith('view-mountain')).toEqual(MOUNTAIN);
	});

	it('excludes basements from hot climates', () => {
		// The exclusion most likely to surprise a user, which is what makes it a good demo: it is
		// water table and slab construction, not an arbitrary rule.
		for (const metro of HOT) {
			expect(metrosWith('finished-basement')).not.toContain(metro);
		}
	});

	it('treats waterfront ⇒ view-water as absolute, not probable', () => {
		expect(listings.every((l) => !has(l, 'waterfront') || has(l, 'view-water'))).toBe(true);
	});

	it('treats ev-charger ⇒ garage as absolute', () => {
		expect(listings.every((l) => !has(l, 'ev-charger') || has(l, 'garage'))).toBe(true);
	});

	it('never puts a pool on land or a mobile home', () => {
		const landOrMobile = listings.filter((l) => l.propertyType === 'land' || l.propertyType === 'mobile');

		expect(landOrMobile.length).toBeGreaterThan(0);
		expect(landOrMobile.some((l) => has(l, 'pool'))).toBe(false);
	});

	it('never puts solar on a condo', () => {
		const condos = listings.filter((l) => l.propertyType === 'condo');

		expect(condos.length).toBeGreaterThan(0);
		expect(condos.some((l) => has(l, 'solar'))).toBe(false);
	});

	it('makes pools markedly more common in hot metros than cold ones', () => {
		// The headline correlation. A uniform generator would put these within noise of each other,
		// so this is the assertion that actually fails if the conditioning is lost.
		const rate = (metro: string): number => {
			const rows = listings.filter((l) => l.metroArea === metro);

			return rows.filter((l) => has(l, 'pool')).length / rows.length;
		};

		expect(rate('Greater Austin')).toBeGreaterThan(rate('NYC Metro') * 3);
	});

	it('keeps every feature reachable somewhere in the corpus', () => {
		// Exclusions must narrow, never eliminate — a feature present in no listing at all would be
		// a dead checklist row.
		const present = new Set(listings.flatMap((l) => l.features));

		expect(present.size).toBe(14);
	});
});
