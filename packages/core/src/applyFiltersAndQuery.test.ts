/**
 * @remarks
 * Exhaustive behavior tests for `runFilterBundleQuery` — the single-pass algorithm behind
 * `FilterEngine.applyFiltersAndQuery`, plus every internal helper exercised through it
 * (findRuleIndex, buildInvertedIndex, pushAttribution, passesExcept, recordFieldValue,
 * accumulateChip, packageField, packageChipGroup).
 *
 * Coverage map:
 *   - empty query → results only (no fields / chipGroups).
 *   - results: items passing ALL active rules; null/undefined items skipped.
 *   - fields: excludeIdx present (rule excluded from the pass) vs -1 (rule not registered);
 *     empty filtered-except-self subset → bounds {min:null,max:null}; baselineMin/Max provided
 *     vs derived from tight bounds; bucketCount default 12 vs custom; span>0 bucketing AND
 *     degenerate span<=0 path; values outside [bucketMin,bucketMax] skipped; the Math.min
 *     floor-clamp on the final bucket edge; non-number / non-finite field values skipped.
 *   - chipGroups: `inSet` (string candidates) + `inSetOfSets` ({value, leafIds}); a leaf
 *     attributing to multiple candidates; projectedCount + wouldBeEmpty (count 0); non-string
 *     itemValue skip; attribution-miss skip; undefined candidate skip in the inverted index +
 *     the packaged output's '' fallback.
 *   - array-valued fields under the disjunctive kinds: one count per item per candidate, however
 *     many elements attribute to it; a rule with `arrayMatch: 'all'` projected conjunctively, and
 *     the configs that are not (`'any'`, absent, a non-object or `null` config, no rule).
 */

import { describe, expect, it } from 'vitest';

import type { FilterRule } from './rules/FilterRule.js';
import type { RuleId } from './types.js';

import { runFilterBundleQuery } from './applyFiltersAndQuery.js';
import { inSet, inSetofSets, range, value } from './rules/factories.js';
import { HierarchicalRule } from './rules/HierarchicalRule.js';

interface Item {
	readonly color: string;
	readonly price: number;
}

/** Build a rule map preserving insertion order, keyed by id. */
function ruleMap(...entries: readonly [RuleId, FilterRule][]): ReadonlyMap<RuleId, FilterRule> {
	return new Map<RuleId, FilterRule>(entries);
}

describe('runFilterBundleQuery — results', () => {
	it('returns results only for an empty query', () => {
		const ws: readonly Item[] = [
			{ color: 'red', price: 10 },
			{ color: 'blue', price: 20 },
		];
		const bundle = runFilterBundleQuery(ws, ruleMap(['c', value('color', 'red')]), {});

		expect([...bundle.resultIndices]).toEqual([0]);
		expect(bundle.resultCount).toBe(1);
		expect(bundle.fields).toEqual([]);
		expect(bundle.chipGroups).toEqual([]);
	});

	it('keeps only items passing every active rule', () => {
		const ws: readonly Item[] = [
			{ color: 'red', price: 10 },
			{ color: 'red', price: 99 },
			{ color: 'blue', price: 10 },
		];
		const rules = ruleMap(['c', value('color', 'red')], ['p', range('price', { max: 50, min: 0 })]);
		const bundle = runFilterBundleQuery(ws, rules, {});

		expect([...bundle.resultIndices]).toEqual([0]);
	});

	it('skips null and undefined items', () => {
		const ws = [
			{ color: 'red', price: 10 },
			null,
			undefined,
			{ color: 'red', price: 20 },
		] as readonly (Item | null | undefined)[];
		const bundle = runFilterBundleQuery(ws, ruleMap(), {});

		expect([...bundle.resultIndices]).toEqual([0, 3]);
		expect(bundle.resultCount).toBe(2);
	});
});

describe('runFilterBundleQuery — fields', () => {
	const ws: readonly Item[] = [
		{ color: 'red', price: 10 },
		{ color: 'red', price: 30 },
		{ color: 'blue', price: 50 },
		{ color: 'blue', price: 70 },
	];

	it('derives filtered-except-self bounds when the field rule is excluded', () => {
		// The price rule is excluded, so its own narrowing doesn't shrink the bounds: only the
		// color rule constrains, leaving the two red items (prices 10, 30).
		const rules = ruleMap(
			['color', value('color', 'red')],
			['price', range('price', { max: 15, min: 0 })],
		);
		const bundle = runFilterBundleQuery(ws, rules, {
			fields: [{ fieldKey: 'price', ruleId: 'price' }],
		});
		const meta = bundle.fields[0];

		expect(meta?.bounds).toEqual({ max: 30, min: 10 });
		// Results still honor the price rule (only price 10 passes everything).
		expect([...bundle.resultIndices]).toEqual([0]);
	});

	it('applies every rule when the field ruleId is not registered (excludeIdx -1)', () => {
		const rules = ruleMap(['color', value('color', 'red')]);
		const bundle = runFilterBundleQuery(ws, rules, {
			fields: [{ fieldKey: 'price', ruleId: 'not-registered' }],
		});

		// excludeIdx === -1: the color rule still applies, so only red prices contribute.
		expect(bundle.fields[0]?.bounds).toEqual({ max: 30, min: 10 });
	});

	it('returns null bounds when the filtered-except-self subset is empty', () => {
		const rules = ruleMap(['color', value('color', 'green')]);
		const bundle = runFilterBundleQuery(ws, rules, {
			fields: [{ fieldKey: 'price', ruleId: 'price' }],
		});
		const meta = bundle.fields[0];

		expect(meta?.bounds).toEqual({ max: null, min: null });
		// Degenerate-shape histogram: counts all zero, edges all the default bucketMin (0).
		expect([...(meta?.histogram.counts ?? [])].every((n) => n === 0)).toBe(true);
	});

	it('buckets across the derived tight bounds with the default 12 buckets', () => {
		const bundle = runFilterBundleQuery(ws, ruleMap(), {
			fields: [{ fieldKey: 'price', ruleId: 'price' }],
		});
		const meta = bundle.fields[0];

		expect(meta?.histogram.counts).toHaveLength(12);
		expect(meta?.histogram.bucketEdges).toHaveLength(13);
		// Tight bounds 10..70, sum of counts equals the number of contributing items.
		const total = [...(meta?.histogram.counts ?? [])].reduce((a, b) => a + b, 0);

		expect(total).toBe(4);
	});

	it('buckets across an explicit baseline range with a custom bucketCount', () => {
		const bundle = runFilterBundleQuery(ws, ruleMap(), {
			fields: [
				{ baselineMax: 100, baselineMin: 0, bucketCount: 10, fieldKey: 'price', ruleId: 'price' },
			],
		});
		const meta = bundle.fields[0];

		expect(meta?.histogram.counts).toHaveLength(10);
		// bucketMin 0, width 10: price 10 -> bucket 1, 30 -> 3, 50 -> 5, 70 -> 7.
		expect([...(meta?.histogram.counts ?? [])]).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0, 0]);
		// bounds are still the tight filtered bounds, not the baseline.
		expect(meta?.bounds).toEqual({ max: 70, min: 10 });
	});

	it('clamps a value sitting exactly on the top edge into the final bucket (Math.min)', () => {
		// price 100 == bucketMax; floor((100-0)/10) === 10 but bucketCount-1 === 9.
		const single: readonly Item[] = [{ color: 'red', price: 100 }];
		const bundle = runFilterBundleQuery(single, ruleMap(), {
			fields: [
				{ baselineMax: 100, baselineMin: 0, bucketCount: 10, fieldKey: 'price', ruleId: 'price' },
			],
		});
		const counts = [...(bundle.fields[0]?.histogram.counts ?? [])];

		expect(counts[9]).toBe(1);
		expect(counts).toHaveLength(10);
	});

	it('skips values outside the baseline [bucketMin, bucketMax] window', () => {
		const bundle = runFilterBundleQuery(ws, ruleMap(), {
			fields: [
				{ baselineMax: 40, baselineMin: 20, bucketCount: 2, fieldKey: 'price', ruleId: 'price' },
			],
		});
		const counts = [...(bundle.fields[0]?.histogram.counts ?? [])];

		// Only price 30 falls inside [20, 40]; 10/50/70 are skipped.
		expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
	});

	it('handles the degenerate span<=0 path (all values identical)', () => {
		const flat: readonly Item[] = [
			{ color: 'red', price: 42 },
			{ color: 'red', price: 42 },
		];
		const bundle = runFilterBundleQuery(flat, ruleMap(), {
			fields: [{ fieldKey: 'price', ruleId: 'price' }],
		});
		const meta = bundle.fields[0];

		expect(meta?.bounds).toEqual({ max: 42, min: 42 });
		// span === 0 → edges all bucketMin (42), counts stay zero.
		expect([...(meta?.histogram.counts ?? [])].every((n) => n === 0)).toBe(true);
		expect([...(meta?.histogram.bucketEdges ?? [])].every((e) => e === 42)).toBe(true);
	});

	it('produces an empty histogram when bucketCount is zero', () => {
		// Values present (span 60 > 0) but bucketCount 0: neither the main nor the degenerate
		// branch runs (both are gated on bucketCount > 0), so counts is empty and only the single
		// edge slot exists.
		const bundle = runFilterBundleQuery(ws, ruleMap(), {
			fields: [{ bucketCount: 0, fieldKey: 'price', ruleId: 'price' }],
		});
		const meta = bundle.fields[0];

		expect(meta?.histogram.counts).toHaveLength(0);
		expect(meta?.histogram.bucketEdges).toHaveLength(1); // Float64Array(bucketCount + 1)
	});

	it('skips non-number / non-finite field values', () => {
		const mixed = [
			{ color: 'red', price: 10 },
			{ color: 'red', price: Number.NaN },
			{ color: 'red', price: 'oops' },
			{ color: 'red', price: 20 },
		] as readonly Item[];
		const bundle = runFilterBundleQuery(mixed, ruleMap(), {
			fields: [{ fieldKey: 'price', ruleId: 'price' }],
		});

		// Only the two finite numbers contribute to bounds.
		expect(bundle.fields[0]?.bounds).toEqual({ max: 20, min: 10 });
	});

	it('echoes ruleId and fieldKey back in the field meta', () => {
		const bundle = runFilterBundleQuery(ws, ruleMap(), {
			fields: [{ fieldKey: 'price', ruleId: 'price-range' }],
		});

		expect(bundle.fields[0]?.ruleId).toBe('price-range');
		expect(bundle.fields[0]?.fieldKey).toBe('price');
	});
});

describe('runFilterBundleQuery — chip groups', () => {
	const ws: readonly Item[] = [
		{ color: 'red', price: 10 },
		{ color: 'red', price: 20 },
		{ color: 'blue', price: 30 },
		{ color: 'green', price: 40 },
	];

	it('counts inSet candidates and flags zero-count candidates as wouldBeEmpty', () => {
		const bundle = runFilterBundleQuery(ws, ruleMap(), {
			chipGroups: [
				{
					candidates: ['red', 'blue', 'yellow'],
					field: 'color',
					kind: 'inSet',
					ruleId: 'color',
				},
			],
		});
		const group = bundle.chipGroups[0];

		expect(group?.ruleId).toBe('color');
		expect(group?.candidates[0]).toEqual({ projectedCount: 2, value: 'red', wouldBeEmpty: false });
		expect(group?.candidates[1]).toEqual({ projectedCount: 1, value: 'blue', wouldBeEmpty: false });
		expect(group?.candidates[2]).toEqual({ projectedCount: 0, value: 'yellow', wouldBeEmpty: true });
	});

	it('attributes a leaf to multiple candidates for inSetOfSets', () => {
		// 'red' appears in BOTH the "warm" and the "all" candidate's leafIds.
		const bundle = runFilterBundleQuery(ws, ruleMap(), {
			chipGroups: [
				{
					candidates: [
						{ leafIds: ['red'], value: 'warm' },
						{ leafIds: ['red', 'blue', 'green'], value: 'all' },
					],
					field: 'color',
					kind: 'inSetOfSets',
					ruleId: 'origin',
				},
			],
		});
		const group = bundle.chipGroups[0];

		// 'warm' counts only the two red items; 'all' counts every item.
		expect(group?.candidates[0]).toEqual({ projectedCount: 2, value: 'warm', wouldBeEmpty: false });
		expect(group?.candidates[1]).toEqual({ projectedCount: 4, value: 'all', wouldBeEmpty: false });
	});

	it('respects excludeIdx — the chip rule itself is dropped from the pass', () => {
		// With the color rule active AND excluded, all four items contribute to color counts.
		const rules = ruleMap(['color', value('color', 'red')]);
		const bundle = runFilterBundleQuery(ws, rules, {
			chipGroups: [
				{ candidates: ['red', 'blue'], field: 'color', kind: 'inSet', ruleId: 'color' },
			],
		});
		const group = bundle.chipGroups[0];

		expect(group?.candidates[0]?.projectedCount).toBe(2);
		expect(group?.candidates[1]?.projectedCount).toBe(1);
		// Results still honor the color rule.
		expect(bundle.resultCount).toBe(2);
	});

	it('skips an item for chip accumulation when it fails a non-excluded rule', () => {
		// The chip excludes the color rule, but the price rule is still enforced by passesExcept.
		const items: readonly Item[] = [
			{ color: 'red', price: 10 }, // passes color + price
			{ color: 'blue', price: 99 }, // fails color (excluded) AND price (NOT excluded)
		];
		const rules = ruleMap(['color', value('color', 'red')], ['price', range('price', { max: 50, min: 0 })]);
		const bundle = runFilterBundleQuery(items, rules, {
			chipGroups: [{ candidates: ['red', 'blue'], field: 'color', kind: 'inSet', ruleId: 'color' }],
		});
		const group = bundle.chipGroups[0];

		// Item 1 fails the non-excluded price rule -> passesExcept is false -> it is NOT accumulated
		// (the false arm of the chip's passesExcept guard). Only item 0 contributes.
		expect(group?.candidates[0]).toEqual({ projectedCount: 1, value: 'red', wouldBeEmpty: false });
		expect(group?.candidates[1]).toEqual({ projectedCount: 0, value: 'blue', wouldBeEmpty: true });
	});

	it('skips items whose chip field value is not a string', () => {
		const mixed = [
			{ color: 'red', price: 10 },
			{ color: 123, price: 20 },
			{ color: 'red', price: 30 },
		] as readonly Item[];
		const bundle = runFilterBundleQuery(mixed, ruleMap(), {
			chipGroups: [{ candidates: ['red'], field: 'color', kind: 'inSet', ruleId: 'color' }],
		});

		// The numeric color is skipped; only the two string 'red' items count.
		expect(bundle.chipGroups[0]?.candidates[0]?.projectedCount).toBe(2);
	});

	it('skips items whose value misses the inverted index entirely', () => {
		const bundle = runFilterBundleQuery(ws, ruleMap(), {
			chipGroups: [{ candidates: ['red'], field: 'color', kind: 'inSet', ruleId: 'color' }],
		});

		// blue/green items have no attribution; only the two reds count.
		expect(bundle.chipGroups[0]?.candidates[0]?.projectedCount).toBe(2);
	});

	it('handles an undefined inSet candidate (skipped in index, "" in output)', () => {
		const candidates = ['red', undefined] as unknown as readonly string[];
		const bundle = runFilterBundleQuery(ws, ruleMap(), {
			chipGroups: [{ candidates, field: 'color', kind: 'inSet', ruleId: 'color' }],
		});
		const group = bundle.chipGroups[0];

		expect(group?.candidates[0]).toEqual({ projectedCount: 2, value: 'red', wouldBeEmpty: false });
		// The undefined candidate never gets an attribution; value falls back to ''.
		expect(group?.candidates[1]).toEqual({ projectedCount: 0, value: '', wouldBeEmpty: true });
	});

	it('handles an undefined inSetOfSets candidate (skipped in index, "" in output)', () => {
		const candidates = [
			{ leafIds: ['red'], value: 'warm' },
			undefined,
		] as unknown as readonly { leafIds: readonly string[]; value: string }[];
		const bundle = runFilterBundleQuery(ws, ruleMap(), {
			chipGroups: [{ candidates, field: 'color', kind: 'inSetOfSets', ruleId: 'origin' }],
		});
		const group = bundle.chipGroups[0];

		expect(group?.candidates[0]?.value).toBe('warm');
		expect(group?.candidates[1]).toEqual({ projectedCount: 0, value: '', wouldBeEmpty: true });
	});
});

/**
 * `'containsAll'` — the conjunctive candidate kind.
 *
 * @remarks
 * The behavior that separates it from the disjunctive kinds is that a conjunctive group's own
 * rule stays ACTIVE during projection. Every test here that involves an already-required value
 * is really testing that one decision; drop it and each candidate gets projected in isolation,
 * which reports values as reachable that would empty the results.
 */
describe('runFilterBundleQuery — containsAll chip groups', () => {
	interface Listing {
		readonly features: readonly string[];
		readonly kind: string;
	}

	/** A `ContainsAllRule` stand-in: passes items whose `features` contain every required value. */
	function mustHave(required: readonly string[]): FilterRule {
		return {
			action: (item: unknown) =>
				required.every((r) => (item as Listing).features.includes(r)),
			config: { required },
			field: 'features',
			type: 'containsAll',
		} as unknown as FilterRule;
	}

	const listings: readonly Listing[] = [
		{ features: ['pool', 'garage'], kind: 'house' },
		{ features: ['pool', 'solar'], kind: 'house' },
		{ features: ['garage'], kind: 'condo' },
		{ features: [], kind: 'condo' },
	];

	const group = {
		candidates: ['pool', 'garage', 'solar'],
		field: 'features',
		kind: 'containsAll' as const,
		ruleId: 'must-have',
	};

	/** Candidate value → its packaged meta, for readable assertions. */
	function project(
		rules: ReadonlyMap<RuleId, FilterRule>,
	): Map<string, { projectedCount: number; wouldBeEmpty: boolean; }> {
		const bundle = runFilterBundleQuery(listings, rules, { chipGroups: [group]});

		return new Map(
			(bundle.chipGroups[0]?.candidates ?? []).map((c) => [
				c.value,
				{ projectedCount: c.projectedCount, wouldBeEmpty: c.wouldBeEmpty },
			]),
		);
	}

	it('counts each array member when no rule is registered', () => {
		const byValue = project(ruleMap());

		expect(byValue.get('pool')?.projectedCount).toBe(2);
		expect(byValue.get('garage')?.projectedCount).toBe(2);
		expect(byValue.get('solar')?.projectedCount).toBe(1);
	});

	it('projects ON TOP of what the rule already requires, not in isolation', () => {
		// THE test. With 'pool' required, only the two pool listings remain, so 'garage' projects
		// to the single pool+garage listing — not to the 2 it would score on its own.
		const byValue = project(ruleMap(['must-have', mustHave(['pool'])]));

		expect(byValue.get('garage')?.projectedCount).toBe(1);
		expect(byValue.get('solar')?.projectedCount).toBe(1);
	});

	it('disables a value that cannot combine with the current requirement', () => {
		// 'garage' and 'solar' never co-occur. Projected in isolation both look reachable; the
		// conjunctive projection correctly reports the combination as empty.
		const byValue = project(ruleMap(['must-have', mustHave(['garage'])]));

		expect(byValue.get('solar')).toEqual({ projectedCount: 0, wouldBeEmpty: true });
	});

	it('never reports an already-required value as unreachable', () => {
		// The escape hatch: a checked value is part of the live requirement, so every surviving
		// item contains it and its projection equals the current result count.
		const rules = ruleMap(['must-have', mustHave(['pool'])]);
		const byValue = project(rules);
		const bundle = runFilterBundleQuery(listings, rules, {});

		expect(byValue.get('pool')?.wouldBeEmpty).toBe(false);
		expect(byValue.get('pool')?.projectedCount).toBe(bundle.resultCount);
	});

	it('honors OTHER active rules while projecting', () => {
		const byValue = project(ruleMap(['kind', value('kind', 'condo')]));

		// Only the two condos are in play, and neither has a pool.
		expect(byValue.get('garage')?.projectedCount).toBe(1);
		expect(byValue.get('pool')).toEqual({ projectedCount: 0, wouldBeEmpty: true });
	});

	it('skips items whose field is not an array', () => {
		const malformed = [{ features: 'pool', kind: 'house' }, { features: null, kind: 'house' }];
		const bundle = runFilterBundleQuery(malformed, ruleMap(), { chipGroups: [group]});

		expect(bundle.chipGroups[0]?.candidates.every((c) => c.projectedCount === 0)).toBe(true);
	});

	it('skips non-string array members and counts a repeated value once', () => {
		// A corpus is free to repeat a value; double-counting would overstate the projection.
		const messy = [{ features: ['pool', 'pool', 42, null, 'garage'], kind: 'house' }];
		const bundle = runFilterBundleQuery(messy, ruleMap(), { chipGroups: [group]});
		const byValue = new Map(
			(bundle.chipGroups[0]?.candidates ?? []).map((c) => [c.value, c.projectedCount]),
		);

		expect(byValue.get('pool')).toBe(1);
		expect(byValue.get('garage')).toBe(1);
	});

	it('ignores array members that match no candidate', () => {
		const extra = [{ features: ['pool', 'helipad'], kind: 'house' }];
		const bundle = runFilterBundleQuery(extra, ruleMap(), { chipGroups: [group]});

		expect(bundle.chipGroups[0]?.candidates).toHaveLength(3);
		expect(bundle.chipGroups[0]?.candidates[0]).toEqual({
			projectedCount: 1,
			value: 'pool',
			wouldBeEmpty: false,
		});
	});
});

/**
 * Array-valued fields under the disjunctive kinds (`'inSet'`, `'inSetOfSets'`).
 *
 * @remarks
 * A projected count is a number of ITEMS, so an item counts once toward each candidate some element
 * attributes to. And the projection follows the rule: `arrayMatch: 'any'` widens as candidates are
 * added (the rule is dropped and each candidate tested alone), `arrayMatch: 'all'` narrows (the rule
 * stays active and the candidate is required on top of it).
 */
describe('runFilterBundleQuery — array-valued fields', () => {
	interface Venue {
		readonly kind: string;
		readonly payment: string | readonly unknown[];
		readonly regions?: readonly string[];
	}

	const venues: readonly Venue[] = [
		{ kind: 'cafe', payment: ['card', 'cash'], regions: ['it-pie', 'it-ven']},
		{ kind: 'bar', payment: ['card'], regions: ['fr-bdx']},
		{ kind: 'cafe', payment: ['cash', 'cash', 7, null], regions: ['it-pie', 'fr-bdx']},
		{ kind: 'bar', payment: [], regions: []},
		{ kind: 'cafe', payment: 'cash' },
	];

	const paymentGroup = {
		candidates: ['card', 'cash', 'voucher'],
		field: 'payment',
		kind: 'inSet' as const,
		ruleId: 'payment',
	};

	/**
	 * Project the payment group over the venues.
	 *
	 * @param rules - The active rules
	 * @returns Candidate value → projected count
	 */
	function projectPayment(rules: ReadonlyMap<RuleId, FilterRule>): Map<string, number> {
		const bundle = runFilterBundleQuery(venues, rules, { chipGroups: [paymentGroup]});

		return new Map((bundle.chipGroups[0]?.candidates ?? []).map((c) => [c.value, c.projectedCount]));
	}

	it('counts an item once per candidate its array holds, and still reads a string field', () => {
		// card: venues 0, 1. cash: venues 0, 2 (repeated, counted once) and 4 (a string field).
		expect(projectPayment(ruleMap())).toEqual(new Map([['card', 2], ['cash', 3], ['voucher', 0]]));
	});

	it('projects an arrayMatch "any" rule disjunctively: each candidate alone', () => {
		const rules = ruleMap(['payment', inSet('payment', { arrayMatch: 'any', set: ['card']})]);

		expect(projectPayment(rules)).toEqual(new Map([['card', 2], ['cash', 3], ['voucher', 0]]));
	});

	it('projects an arrayMatch "all" rule conjunctively: on top of what it already requires', () => {
		// Requiring card leaves venues 0 and 1; adding cash leaves venue 0 alone.
		const rules = ruleMap(['payment', inSet('payment', { arrayMatch: 'all', set: ['card']})]);
		const bundle = runFilterBundleQuery(venues, rules, { chipGroups: [paymentGroup]});

		expect(projectPayment(rules)).toEqual(new Map([['card', 2], ['cash', 1], ['voucher', 0]]));
		expect(bundle.chipGroups[0]?.candidates[0]?.projectedCount).toBe(bundle.resultCount);
	});

	it('projects disjunctively for a rule whose config is not an arrayMatch object', () => {
		const withNull = ruleMap(['payment', value('payment', null)]);
		const withString = ruleMap(['payment', value('payment', 'cash')]);

		expect(projectPayment(withNull)).toEqual(projectPayment(ruleMap()));
		expect(projectPayment(withString)).toEqual(projectPayment(ruleMap()));
	});

	it('honors other active rules while projecting', () => {
		expect(projectPayment(ruleMap(['kind', value('kind', 'bar')]))).toEqual(
			new Map([['card', 1], ['cash', 0], ['voucher', 0]]),
		);
	});

	it('credits an inSetOfSets candidate once even when two of its leaves are present', () => {
		const regionGroup = {
			candidates: [
				{ leafIds: ['it-pie', 'it-ven'], value: 'italy' },
				{ leafIds: ['fr-bdx'], value: 'france' },
			],
			field: 'regions',
			kind: 'inSetOfSets' as const,
			ruleId: 'origin',
		};
		const counts = (rules: ReadonlyMap<RuleId, FilterRule>): readonly number[] =>
			(runFilterBundleQuery(venues, rules, { chipGroups: [regionGroup]}).chipGroups[0]?.candidates ?? [])
				.map((c) => c.projectedCount);

		// Venue 0 holds both Italian leaves and counts once toward Italy.
		expect(counts(ruleMap())).toEqual([2, 2]);
		// A rule requiring Italy AND France keeps only venue 2: conjunctive projection.
		expect(counts(ruleMap(['origin', inSetofSets('regions', [['it-pie', 'it-ven'], ['fr-bdx']], { arrayMatch: 'all' })])))
			.toEqual([1, 1]);
		// The same subsets under 'any' are projected per candidate.
		expect(counts(ruleMap(['origin', inSetofSets('regions', [['fr-bdx']])]))).toEqual([2, 2]);
	});

	it('projects a HierarchicalRule with arrayMatch "all" conjunctively', () => {
		const tree = { children: [{ children: [{ id: 'it-pie' }, { id: 'it-ven' }], id: 'it' }, { children: [{ id: 'fr-bdx' }], id: 'fr' }], id: 'world' };
		const regionGroup = {
			candidates: [{ leafIds: ['it-pie', 'it-ven'], value: 'it' }, { leafIds: ['fr-bdx'], value: 'fr' }],
			field: 'regions',
			kind: 'inSetOfSets' as const,
			ruleId: 'origin',
		};
		const rules = ruleMap(['origin', new HierarchicalRule('regions', { arrayMatch: 'all', selected: ['it'], tree })]);
		const bundle = runFilterBundleQuery(venues, rules, { chipGroups: [regionGroup]});

		// Italy is required (venues 0 and 2); France on top of it leaves venue 2.
		expect(bundle.chipGroups[0]?.candidates.map((c) => c.projectedCount)).toEqual([2, 1]);
	});
});
