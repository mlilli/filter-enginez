/**
 * @remarks
 * A config round trip keeps the engine's BEHAVIOR, for every rule type the registry revives: an
 * engine holding a rule and an engine loaded from that engine's `exportConfig` match exactly the
 * same items.
 *
 * ## Why behavior, not shape
 *
 * `JSON.stringify` writes `Infinity`, `-Infinity` and `NaN` as `null`. A document that went through
 * JSON therefore differs from the one that was exported, and a shape comparison either fails for a
 * harmless reason or is loosened until it passes for a harmful one. What a URL, a saved view or a
 * request body must keep is which items pass, so that is what this suite compares: the result
 * indices of the original engine against those of an engine loaded from the round-tripped config.
 * An open `RangeRule` bound that revived as `null` (and so compared as `0`) matched nothing here.
 *
 * ## What it walks
 *
 * - **Every registered type.** The first case reads the type names out of `ruleRegistry` and fails
 *   for any type without cases in {@link CASES_BY_TYPE} (or a listed reason it cannot serialize),
 *   so a new rule type with a numeric bound cannot join the registry without joining this table.
 * - **Edge values per type**: open bounds (`±Infinity`), zero and negative zero, `min > max`,
 *   absent and `null` data values, and options at their limits.
 * - **Two channels**: JSON (`exportConfig` → `JSON.stringify` → `JSON.parse` → `loadConfig`), which
 *   is what URL state, devtools persistence over `localStorage` and an HTTP body use; and
 *   `structuredClone`, which is what the worker bridge uses.
 * - **Two evaluation paths**: the per-item predicates, and the bitmap layer forced on (with the text
 *   index), whose spatial and trigram paths read the same revived configs.
 *
 * Out of scope, by design: a bound on the wrong side (`min: Infinity`, a range that is empty
 * whatever its `max`) and a `NaN` bound. JSON writes both as `null`, which revives as the open bound
 * for its position; `json_config.md` documents that.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import type { FilterEngine } from '../FilterEngine.js';
import type { AccelerationOptions } from '../FilterEngineOptions.js';
import type { FilterRule } from '../rules/FilterRule.js';

import { createFilterEngine } from '../createFilterEngine.js';
import { initializeBitmapAcceleration } from '../internals/roaringInit.js';
import { BloomFilter } from '../lib/BloomFilter.js';
import { BloomMembershipRule } from '../rules/BloomMembershipRule.js';
import { BooleanRule } from '../rules/BooleanRule.js';
import { CompositeRule } from '../rules/CompositeRule.js';
import { DateRangeRule } from '../rules/DateRangeRule.js';
import { ExistsRule } from '../rules/ExistsRule.js';
import { FuzzySearchRule } from '../rules/FuzzySearchRule.js';
import { GeoProximityRule } from '../rules/GeoProximityRule.js';
import { HierarchicalRule } from '../rules/HierarchicalRule.js';
import { InSetofSetsRule } from '../rules/InSetofSetsRule.js';
import { InSetRule } from '../rules/InSetRule.js';
import { type NumericComparisonOp, NumericComparisonRule } from '../rules/NumericComparisonRule.js';
import { PredicateRule } from '../rules/PredicateRule.js';
import { RangeRule } from '../rules/RangeRule.js';
import { RegexRule } from '../rules/RegexRule.js';
import { ruleRegistry } from '../rules/ruleRegistry.js';
import { TextSearchRule } from '../rules/TextSearchRule.js';
import { ValueRule } from '../rules/ValueRule.js';
import { type FilterEngineConfig } from './FilterEngineConfig.js';

/** One item of the fixture: every field a case reads, with some absent or `null`. */
interface Listing {
	readonly coords?: { readonly lat: number; readonly lng: number };
	readonly inStock?: boolean;
	readonly price?: number | null;
	readonly region?: string;
	readonly sku: string;
	readonly title?: string;
	readonly listedAt?: string;
}

/** Items spanning negative, zero, fractional, large, `null` and absent values. */
const LISTINGS: readonly Listing[] = [
	{ coords: { lat: 37.7749, lng: -122.4194 }, inStock: true, listedAt: '2024-01-15T00:00:00.000Z', price: -50, region: 'ca', sku: 'a1', title: 'cabernet sauvignon' },
	{ coords: { lat: 37.8044, lng: -122.2712 }, inStock: false, listedAt: '2024-06-01T00:00:00.000Z', price: -0, region: 'or', sku: 'a2', title: 'pinot noir' },
	{ coords: { lat: 40.7128, lng: -74.006 }, inStock: true, listedAt: '2025-03-10T00:00:00.000Z', price: 0, region: 'bordeaux', sku: 'b1', title: 'merlot blend, cabernay style' },
	{ coords: { lat: 48.8566, lng: 2.3522 }, listedAt: '2025-12-31T23:59:59.000Z', price: 0.5, region: 'fr', sku: 'b2', title: 'zinfandel' },
	{ coords: { lat: -33.8688, lng: 151.2093 }, inStock: true, price: 60, region: 'us', sku: 'c1', title: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx cabernet' },
	{ inStock: false, listedAt: '2023-07-04T00:00:00.000Z', price: 100, region: 'ca', sku: 'c2', title: 'syrah' },
	{ coords: { lat: 35.6762, lng: 139.6503 }, price: 1_000_000, sku: 'd1' },
	{ coords: { lat: 37.7749, lng: -122.4194 }, price: null, region: 'fr', sku: 'd2', title: 'cabernet franc' },
	{ sku: 'e1', title: 'riesling' },
];

/** The region tree `HierarchicalRule` cases select from. */
const REGION_TREE = {
	children: [
		{ children: [{ id: 'ca' }, { id: 'or' }], id: 'us' },
		{ children: [{ id: 'bordeaux' }], id: 'fr' },
	],
	id: 'world',
};

/** San Francisco, the center of the `GeoProximityRule` cases. */
const SAN_FRANCISCO = { lat: 37.7749, lng: -122.4194 };

/** One rule to round-trip, labeled for the test name. */
interface RoundTripCase {
	readonly label: string;
	readonly rule: () => FilterRule;
}

/**
 * Build a Bloom filter holding `values`, for the `BloomMembershipRule` cases.
 *
 * @param values - The members to add
 * @returns The filled filter
 */
function bloomOf(values: readonly string[]): BloomFilter {
	const filter = BloomFilter.forCapacity(16, 0.01);

	for (const member of values) {
		filter.add(member);
	}

	return filter;
}

/**
 * The `NumericComparisonRule` cases: every operator against each infinity (the open one and the
 * empty one, which differ only for `<`, `<=`, `>`, `>=`), and against finite edges.
 *
 * @returns One case per operator and value
 */
function numericComparisonCases(): readonly RoundTripCase[] {
	// Each operator with the infinity that leaves it open. `==` and `!=` compare every finite value
	// the same way against either infinity, so they take both.
	const valuesByOp: readonly (readonly [NumericComparisonOp, readonly number[]])[] = [
		['!=', [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]],
		['<', [Number.POSITIVE_INFINITY]],
		['<=', [Number.POSITIVE_INFINITY]],
		['==', [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]],
		['>', [Number.NEGATIVE_INFINITY]],
		['>=', [Number.NEGATIVE_INFINITY]],
	];
	const cases: RoundTripCase[] = [];

	for (const [op, openValues] of valuesByOp) {
		for (const value of [...openValues, 0, -0, 60]) {
			cases.push({ label: `${op} ${String(value)}`, rule: () => new NumericComparisonRule('price', { op, value }) });
		}
	}

	return cases;
}

/** The cases, keyed by the registered type name they serialize as. */
const CASES_BY_TYPE: ReadonlyMap<string, readonly RoundTripCase[]> = new Map<string, readonly RoundTripCase[]>([
	['BloomMembershipRule', [
		{ label: 'two members', rule: () => new BloomMembershipRule('sku', bloomOf(['a1', 'c2'])) },
		{ label: 'no members', rule: () => new BloomMembershipRule('sku', bloomOf([])) },
	]],
	['BooleanRule', [
		{ label: 'true', rule: () => new BooleanRule('inStock', true) },
		{ label: 'false', rule: () => new BooleanRule('inStock', false) },
		{ label: 'undefined (no-op)', rule: () => new BooleanRule('inStock', undefined) },
	]],
	['CompositeRule', [
		{
			label: 'and(open range, open comparison)',
			rule: () => new CompositeRule('and', [
				new RangeRule('price', { max: Number.POSITIVE_INFINITY, min: 0 }),
				new NumericComparisonRule('price', { op: '<', value: Number.POSITIVE_INFINITY }),
			]),
		},
		{
			label: 'or(open-high range, open-low range)',
			rule: () => new CompositeRule('or', [
				new RangeRule('price', { max: Number.POSITIVE_INFINITY, min: 60 }),
				new RangeRule('price', { max: -1, min: Number.NEGATIVE_INFINITY }),
			]),
		},
		{
			label: 'not(open range)',
			rule: () => new CompositeRule('not', [new RangeRule('price', { max: Number.POSITIVE_INFINITY, min: 60 })]),
		},
	]],
	['DateRangeRule', [
		{ label: 'open end', rule: () => new DateRangeRule('listedAt', { start: new Date('2024-06-01T00:00:00.000Z') }) },
		{ label: 'open start', rule: () => new DateRangeRule('listedAt', { end: new Date('2024-06-01T00:00:00.000Z') }) },
		{ label: 'both open', rule: () => new DateRangeRule('listedAt', {}) },
		{
			label: 'closed',
			rule: () => new DateRangeRule('listedAt', {
				end: new Date('2025-12-31T23:59:59.000Z'),
				start: new Date('2024-01-15T00:00:00.000Z'),
			}),
		},
		{ label: 'preset all-time', rule: () => new DateRangeRule('listedAt', { preset: 'all-time' }) },
	]],
	['ExistsRule', [{ label: 'price present', rule: () => new ExistsRule('price') }]],
	['FuzzySearchRule', [
		{ label: 'unlimited distance', rule: () => new FuzzySearchRule('title', { distance: Number.POSITIVE_INFINITY, query: 'cabernay' }) },
		{ label: 'unlimited threshold', rule: () => new FuzzySearchRule('title', { query: 'cabernay', threshold: Number.POSITIVE_INFINITY }) },
		{ label: 'exact threshold', rule: () => new FuzzySearchRule('title', { query: 'cabernet', threshold: 0 }) },
		{
			label: 'tight threshold, unlimited distance',
			rule: () => new FuzzySearchRule('title', { distance: Number.POSITIVE_INFINITY, query: 'cabernet sauvignon', threshold: 0.1 }),
		},
		{
			label: 'multi-key, unlimited distance',
			rule: () => new FuzzySearchRule(undefined, { distance: Number.POSITIVE_INFINITY, keys: ['title'], query: 'cabernay' }),
		},
	]],
	['GeoProximityRule', [
		{ label: 'unlimited radius', rule: () => new GeoProximityRule('coords', { center: SAN_FRANCISCO, radiusKm: Number.POSITIVE_INFINITY }) },
		{ label: 'zero radius', rule: () => new GeoProximityRule('coords', { center: SAN_FRANCISCO, radiusKm: 0 }) },
		{ label: '25 km', rule: () => new GeoProximityRule('coords', { center: SAN_FRANCISCO, radiusKm: 25 }) },
		{ label: 'half the planet', rule: () => new GeoProximityRule('coords', { center: SAN_FRANCISCO, radiusKm: 20_000 }) },
	]],
	['HierarchicalRule', [
		{ label: 'one subtree', rule: () => new HierarchicalRule('region', { selected: ['us'], tree: REGION_TREE }) },
		{ label: 'nothing selected', rule: () => new HierarchicalRule('region', { selected: [], tree: REGION_TREE }) },
	]],
	['InSetofSetsRule', [
		{ label: 'numeric subsets', rule: () => new InSetofSetsRule<number>('price', [[0, 60], [100]]) },
		{ label: 'a null member', rule: () => new InSetofSetsRule<number | null>('price', [[null]]) },
	]],
	['InSetRule', [
		{ label: 'numeric members', rule: () => new InSetRule<number>('price', [0, 60, 100]) },
		{ label: 'a null member', rule: () => new InSetRule<number | null>('price', [null]) },
		{ label: 'empty (no-op)', rule: () => new InSetRule<number>('price', []) },
	]],
	['NumericComparisonRule', numericComparisonCases()],
	['RangeRule', [
		{ label: 'open-high', rule: () => new RangeRule('price', { max: Number.POSITIVE_INFINITY, min: 60 }) },
		{ label: 'open-low', rule: () => new RangeRule('price', { max: 60, min: Number.NEGATIVE_INFINITY }) },
		{ label: 'open both ends', rule: () => new RangeRule('price', { max: Number.POSITIVE_INFINITY, min: Number.NEGATIVE_INFINITY }) },
		{ label: 'open-high from a negative min', rule: () => new RangeRule('price', { max: Number.POSITIVE_INFINITY, min: -10 }) },
		{ label: 'open-low to a negative max', rule: () => new RangeRule('price', { max: -1, min: Number.NEGATIVE_INFINITY }) },
		{ label: 'zero width at zero', rule: () => new RangeRule('price', { max: 0, min: -0 }) },
		{ label: 'min > max', rule: () => new RangeRule('price', { max: 10, min: 100 }) },
		{ label: 'fractional', rule: () => new RangeRule('price', { max: 0.75, min: 0.25 }) },
	]],
	['RegexRule', [{ label: 'anchored, case-insensitive', rule: () => new RegexRule('title', { pattern: /^CAB/iu }) }]],
	['TextSearchRule', [
		{ label: 'substring', rule: () => new TextSearchRule('title', { mode: 'substring', query: 'cab' }) },
		{ label: 'empty query', rule: () => new TextSearchRule('title', { mode: 'exact', query: '' }) },
	]],
	['ValueRule', [
		{ label: 'zero', rule: () => new ValueRule<number>('price', 0) },
		{ label: 'null', rule: () => new ValueRule<null>('price', null) },
		{ label: 'a string', rule: () => new ValueRule<string>('region', 'ca') },
	]],
]);

/** Registered types that cannot be exported at all, with the reason. */
const UNSERIALIZABLE_TYPES: ReadonlyMap<string, string> = new Map([
	['PredicateRule', 'its config is a function; serialize() throws RULE_NOT_SERIALIZABLE'],
]);

/** A transport a config crosses: JSON (URL state, storage, HTTP) or structured clone (workers). */
interface Channel {
	readonly name: string;
	readonly transfer: (config: FilterEngineConfig) => FilterEngineConfig;
}

const CHANNELS: readonly Channel[] = [
	{ name: 'JSON', transfer: (config) => JSON.parse(JSON.stringify(config)) as FilterEngineConfig },
	{ name: 'structuredClone', transfer: (config) => structuredClone(config) },
];

/** The evaluation paths a revived config runs on. */
const ACCELERATIONS: readonly { readonly name: string; readonly options: AccelerationOptions }[] = [
	{ name: 'predicates', options: { bitmap: 'off' }},
	{ name: 'bitmaps', options: { bitmap: 'on', textIndex: 'on' }},
];

/**
 * The indices of the listings an engine passes once `apply` has set its rules up.
 *
 * @param acceleration - The engine's acceleration options
 * @param apply - Adds rules or an expression to the fresh engine
 * @returns The passing indices, ascending
 */
function matchSet(acceleration: AccelerationOptions, apply: (engine: FilterEngine<Listing>) => void): number[] {
	const engine = createFilterEngine<Listing>({ acceleration, sourceData: LISTINGS });

	apply(engine);

	return [...engine.getResultIndices()];
}

beforeAll(async () => {
	await initializeBitmapAcceleration();
});

describe('config round trip keeps behavior', () => {
	it('has cases for every type the registry revives', () => {
		const registeredTypes = [...ruleRegistry].map(([typeName]) => typeName);

		expect(registeredTypes.length).toBeGreaterThanOrEqual(16);
		for (const typeName of registeredTypes) {
			const cases = CASES_BY_TYPE.get(typeName);

			expect(
				(cases?.length ?? 0) > 0 || UNSERIALIZABLE_TYPES.has(typeName),
				`${typeName} is registered but has no round-trip cases. Add cases to CASES_BY_TYPE in `
				+ `configRoundTripBehavior.test.ts, with its edge values (open bounds, zero, null data).`,
			).toBe(true);
		}
	});

	it('files every case under the type it serializes as', () => {
		for (const [typeName, cases] of CASES_BY_TYPE) {
			for (const { rule } of cases) {
				expect(rule().serialize().type).toBe(typeName);
			}
		}
	});

	it('lists only registered types as unserializable, and they cannot export', () => {
		for (const typeName of UNSERIALIZABLE_TYPES.keys()) {
			expect(ruleRegistry.has(typeName)).toBe(true);
		}
		expect(() => new PredicateRule<Listing>('price', () => true).serialize()).toThrowError(/cannot be serialized/u);
	});

	for (const [typeName, cases] of CASES_BY_TYPE) {
		for (const { label, rule } of cases) {
			for (const channel of CHANNELS) {
				for (const acceleration of ACCELERATIONS) {
					it(`${typeName} ${label} — ${channel.name}, ${acceleration.name}`, () => {
						let exported: FilterEngineConfig | undefined;
						const original = matchSet(acceleration.options, (engine) => {
							engine.addRule('rule', rule());
							exported = engine.exportConfig();
						});
						const restored = matchSet(acceleration.options, (engine) => {
							engine.loadConfig(channel.transfer(exported as FilterEngineConfig));
						});

						expect(restored).toEqual(original);
					});
				}
			}
		}
	}

	for (const channel of CHANNELS) {
		it(`keeps an expression over open bounds — ${channel.name}`, () => {
			const expression = (): CompositeRule => new CompositeRule('or', [
				new RangeRule('price', { max: Number.POSITIVE_INFINITY, min: 60 }),
				new CompositeRule('and', [
					new NumericComparisonRule('price', { op: '>', value: Number.NEGATIVE_INFINITY }),
					new GeoProximityRule('coords', { center: SAN_FRANCISCO, radiusKm: Number.POSITIVE_INFINITY }),
				]),
			]);
			let exported: FilterEngineConfig | undefined;
			const original = matchSet({ bitmap: 'off' }, (engine) => {
				engine.setExpression(expression());
				exported = engine.exportConfig();
			});
			const restored = matchSet({ bitmap: 'off' }, (engine) => {
				engine.loadConfig(channel.transfer(exported as FilterEngineConfig));
			});

			expect(original.length).toBeGreaterThan(0);
			expect(restored).toEqual(original);
		});
	}

	it('reads a shared link\'s `max: null` as the open bound it was written for', () => {
		const original = matchSet({ bitmap: 'off' }, (engine) => {
			engine.addRule('price', new RangeRule('price', { max: Number.POSITIVE_INFINITY, min: 60 }));
		});
		// Exactly what `JSON.stringify` wrote for `{ min: 60, max: Infinity }` into every `?f=` link.
		const shared: FilterEngineConfig = {
			rules: [{ id: 'price', rule: { config: { max: null, min: 60 }, field: 'price', type: 'RangeRule' }}],
			version: 1,
		};
		const restored = matchSet({ bitmap: 'off' }, (engine) => {
			engine.loadConfig(shared);
		});

		expect(original).toEqual([4, 5, 6]);
		expect(restored).toEqual(original);
	});
});
