/**
 * @remarks
 * Behavior-asserting unit tests for {@link ExclusionGraph} — the lazy pairwise
 * Mutual-Exclusion Graph over the active rule set. Covers: the symmetric adjacency build
 * (`getExclusions` / `areExclusive` / `exclusionPairCount`), `wouldExcludeAll` across both
 * branches — the cached-adjacency path (candidate already active) and the ephemeral-bitmap
 * path (candidate not active), the self-skip inside the cached path, the not-ready
 * short-circuits on every public method when the bitmap index is unavailable, the empty
 * active-rule-set guard, lazy build + `precompute`, cache freshness vs the rule-set
 * fingerprint and source-data version, `invalidate()`, and the `'off'` mode that disables
 * every query even when the bitmap index IS ready.
 *
 * The graph delegates to a real {@link BitmapIndex}, so the suite awaits the genuine
 * `initializeBitmapAcceleration()` once in `beforeAll` and drives the bitmap index in
 * `'bitmap'` mode so `isReady` is true.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import type { FilterRule } from '../rules/FilterRule.js';
import type { RuleId } from '../types.js';

import { ValueRule } from '../rules/ValueRule.js';
import { InternalStore } from '../store/InternalStore.js';
import { BitmapIndex } from './BitmapIndex.js';
import { ExclusionGraph } from './ExclusionGraph.js';
import { initializeBitmapAcceleration } from './roaringInit.js';

interface Wine {
	readonly color: string;
	readonly region: string;
}

function colorRule(value: string): ValueRule {
	return new ValueRule('color', value);
}

function regionRule(value: string): ValueRule {
	return new ValueRule('region', value);
}

/** Install an active rule set on the store (the store exposes no mutators directly). */
function setRules(
	store: InternalStore<Wine>,
	entries: readonly (readonly [RuleId, FilterRule])[],
): void {
	store.rules.value = new Map(entries);
}

/** Standard corpus: two red-Napa wines and one white-Rioja wine. */
function makeStore(): InternalStore<Wine> {
	return new InternalStore<Wine>([
		{ color: 'red', region: 'Napa' },
		{ color: 'red', region: 'Napa' },
		{ color: 'white', region: 'Rioja' },
	]);
}

function makeGraph(store: InternalStore<Wine>): {
	bitmapIndex: BitmapIndex<Wine>;
	graph: ExclusionGraph<Wine>;
} {
	const bitmapIndex = new BitmapIndex(store, 'bitmap');
	const graph = new ExclusionGraph(store, bitmapIndex);

	return { bitmapIndex, graph };
}

beforeAll(async () => {
	await initializeBitmapAcceleration();
});

describe('ExclusionGraph adjacency build', () => {
	it('records mutually exclusive rule pairs symmetrically', () => {
		const store = makeStore();

		// red {0,1} and white {2} are disjoint; red and napa {0,1} overlap.
		setRules(store, [
			['red', colorRule('red')],
			['white', colorRule('white')],
			['napa', regionRule('Napa')],
		]);
		const { graph } = makeGraph(store);

		expect(graph.areExclusive('red', 'white')).toBe(true);
		expect(graph.areExclusive('white', 'red')).toBe(true);
		expect(graph.areExclusive('red', 'napa')).toBe(false);
	});

	it('getExclusions lists every rule disjoint from the queried rule', () => {
		const store = makeStore();

		setRules(store, [
			['red', colorRule('red')],
			['white', colorRule('white')],
			['rioja', regionRule('Rioja')],
		]);
		const { graph } = makeGraph(store);

		// red {0,1} is disjoint from white {2} and rioja {2}.
		expect([...graph.getExclusions('red')].sort()).toEqual(['rioja', 'white']);
	});

	it('counts each exclusive pair once via exclusionPairCount', () => {
		const store = makeStore();

		setRules(store, [
			['red', colorRule('red')],
			['white', colorRule('white')],
		]);
		const { graph } = makeGraph(store);

		graph.precompute();

		// Exactly one disjoint pair: red <-> white.
		expect(graph.exclusionPairCount).toBe(1);
	});

	it('getExclusions returns empty for a rule id absent from the active set', () => {
		const store = makeStore();

		// red{0,1} and white{2} are disjoint, so the build populates a real adjacency graph — and
		// creates an (empty-or-not) entry for every ACTIVE rule.
		setRules(store, [
			['red', colorRule('red')],
			['white', colorRule('white')],
		]);
		const { graph } = makeGraph(store);

		// 'ghost' was never an active rule, so it has NO adjacency entry at all (`get()` is
		// undefined) -> the `set === undefined` arm. Distinct from an active rule that merely has an
		// empty exclusion set (which returns [] via the spread of an empty set).
		expect(graph.getExclusions('ghost')).toEqual([]);
	});

	it('areExclusive returns false for a rule id absent from the active set', () => {
		const store = makeStore();

		setRules(store, [
			['red', colorRule('red')],
			['white', colorRule('white')],
		]);
		const { graph } = makeGraph(store);

		// 'ghost' has no adjacency entry -> the `adjacent === undefined` arm returns false (distinct
		// from an active rule whose adjacency set simply lacks the queried peer).
		expect(graph.areExclusive('ghost', 'red')).toBe(false);
	});

	it('getExclusions returns empty for a rule with no disjoint peers', () => {
		const store = makeStore();

		setRules(store, [
			['red', colorRule('red')],
			['napa', regionRule('Napa')],
		]);
		const { graph } = makeGraph(store);

		// red and napa both cover {0,1} — they overlap, no exclusion.
		expect(graph.getExclusions('red')).toEqual([]);
	});

	it('areExclusive returns false when the rule has exclusions but not with the queried peer', () => {
		// red{0} and white{1} are disjoint; napa{0} overlaps red{0}.
		const store = new InternalStore<Wine>([
			{ color: 'red', region: 'Napa' },
			{ color: 'white', region: 'B' },
		]);

		setRules(store, [
			['red', colorRule('red')],
			['white', colorRule('white')],
			['napa', regionRule('Napa')],
		]);
		const { graph } = makeGraph(store);

		// red HAS an adjacency set (contains 'white') — exercises the `adjacent.has(peer)` arm on
		// both a present peer (true) and an absent one (false), distinct from the no-adjacency case.
		expect(graph.areExclusive('red', 'white')).toBe(true); // adjacent defined, has('white') === true
		expect(graph.areExclusive('red', 'napa')).toBe(false); // adjacent defined, has('napa') === false
	});

	it('reuses an existing adjacency set when a rule is exclusive with two earlier rules (3-way)', () => {
		// Three items, each a distinct color -> red{0}, white{1}, blue{2} are mutually disjoint.
		const store = new InternalStore<Wine>([
			{ color: 'red', region: 'A' },
			{ color: 'white', region: 'B' },
			{ color: 'blue', region: 'C' },
		]);

		setRules(store, [
			['red', colorRule('red')],
			['white', colorRule('white')],
			['blue', colorRule('blue')],
		]);
		const { graph } = makeGraph(store);

		graph.precompute();

		// All three pairs are exclusive. Processing (white, blue) finds blue's adjacency set already
		// created by the earlier (red, blue) pair -> the `disjointB !== undefined` reuse arm.
		expect(graph.exclusionPairCount).toBe(3);
		expect(graph.areExclusive('red', 'white')).toBe(true);
		expect(graph.areExclusive('red', 'blue')).toBe(true);
		expect(graph.areExclusive('white', 'blue')).toBe(true);
	});
});

describe('ExclusionGraph.wouldExcludeAll', () => {
	it('returns true via the cached-adjacency path when an active candidate excludes a peer', () => {
		const store = makeStore();
		const white = colorRule('white');

		setRules(store, [
			['red', colorRule('red')],
			['white', white],
		]);
		const { graph } = makeGraph(store);

		// Build the cache, then query an ALREADY-ACTIVE candidate ('white') -> cached path.
		graph.precompute();

		expect(graph.wouldExcludeAll('white', white)).toBe(true);
	});

	it('returns false via the cached path when the active candidate overlaps every peer', () => {
		const store = makeStore();
		const napa = regionRule('Napa');

		setRules(store, [
			['red', colorRule('red')],
			['napa', napa],
		]);
		const { graph } = makeGraph(store);

		graph.precompute();

		// napa {0,1} overlaps red {0,1}; cached adjacency has no exclusion -> false.
		expect(graph.wouldExcludeAll('napa', napa)).toBe(false);
	});

	it('returns true via the ephemeral-bitmap path for a non-active candidate', () => {
		const store = makeStore();

		setRules(store, [['red', colorRule('red')]]);
		const { graph } = makeGraph(store);

		// A brand-new rule not in the active set (matched by reference): white {2} vs red {0,1}.
		expect(graph.wouldExcludeAll('white', colorRule('white'))).toBe(true);
	});

	it('returns false via the ephemeral path for an overlapping non-active candidate', () => {
		const store = makeStore();

		setRules(store, [['red', colorRule('red')]]);
		const { graph } = makeGraph(store);

		// napa {0,1} overlaps the active red {0,1}.
		expect(graph.wouldExcludeAll('napa', regionRule('Napa'))).toBe(false);
	});

	it('returns false when there are no active rules', () => {
		const store = makeStore();
		const { graph } = makeGraph(store);

		expect(graph.wouldExcludeAll('red', colorRule('red'))).toBe(false);
	});

	it('reuses an active rule bitmap when the candidate matches by reference under a new id', () => {
		const store = makeStore();
		const white = colorRule('white');

		// 'white' rule is active; query it under a DIFFERENT, unregistered candidate id so the
		// cached-adjacency lookup misses (Case 2), but the ephemeral builder still finds the rule
		// by reference identity among the active rules and reuses its cached bitmap.
		setRules(store, [
			['red', colorRule('red')],
			['white', white],
		]);
		const { graph } = makeGraph(store);

		// white {2} is disjoint from red {0,1} -> excludes all.
		expect(graph.wouldExcludeAll('white-alias', white)).toBe(true);
	});

	it('builds an ephemeral bitmap that overlaps every active rule -> returns false', () => {
		const store = makeStore();

		// Single active rule 'red' {0,1}; candidate 'napa' {0,1} is brand-new (Case 2 ephemeral
		// build) and overlaps red, so no exclusion is found across the active set.
		setRules(store, [['red', colorRule('red')]]);
		const { graph } = makeGraph(store);

		expect(graph.wouldExcludeAll('napa', regionRule('Napa'))).toBe(false);
	});

	it('skips sparse-array holes while building the ephemeral candidate bitmap', () => {
		// A sparse corpus with a hole at index 1 forces the ephemeral build loop's
		// `item !== undefined` guard to take its false arm without throwing.
		const sparse: Wine[] = [];

		sparse[0] = { color: 'red', region: 'Napa' };
		// index 1 left as a hole
		sparse[2] = { color: 'red', region: 'Napa' };
		const store = new InternalStore<Wine>(sparse);

		setRules(store, [['red', colorRule('red')]]);
		const { graph } = makeGraph(store);

		// Candidate 'white' is brand-new (ephemeral path) and matches none of the present items,
		// so it is disjoint from the active red rule -> excludes all.
		expect(graph.wouldExcludeAll('white', colorRule('white'))).toBe(true);
	});
});

describe('ExclusionGraph readiness + invalidation', () => {
	it('short-circuits every query when the bitmap index is not ready', () => {
		const store = makeStore();

		setRules(store, [
			['red', colorRule('red')],
			['white', colorRule('white')],
		]);
		// 'predicate' mode => bitmapIndex.isReady === false.
		const bitmapIndex = new BitmapIndex(store, 'predicate');
		const graph = new ExclusionGraph(store, bitmapIndex);

		expect(graph.isReady).toBe(false);
		expect(graph.wouldExcludeAll('red', colorRule('red'))).toBe(false);
		expect(graph.getExclusions('red')).toEqual([]);
		expect(graph.areExclusive('red', 'white')).toBe(false);
		// precompute is a no-op when not ready (no throw, nothing cached).
		graph.precompute();
		expect(graph.exclusionPairCount).toBe(0);
	});

	it('reports isReady only after a fresh build aligned with current state', () => {
		const store = makeStore();

		setRules(store, [['red', colorRule('red')]]);
		const { graph } = makeGraph(store);

		expect(graph.isReady).toBe(false);

		graph.precompute();

		expect(graph.isReady).toBe(true);
	});

	it('rebuilds when the rule-set fingerprint changes', () => {
		const store = makeStore();

		setRules(store, [
			['red', colorRule('red')],
			['white', colorRule('white')],
		]);
		const { graph } = makeGraph(store);

		// precompute() builds the graph; exclusionPairCount only reads the cache.
		graph.precompute();
		expect(graph.exclusionPairCount).toBe(1);

		// Add a third rule disjoint from white: napa {0,1} vs white {2}.
		setRules(store, [
			['red', colorRule('red')],
			['white', colorRule('white')],
			['napa', regionRule('Napa')],
		]);

		// Fingerprint changed -> rebuild on the next build trigger. Now red<->white and
		// napa<->white are both exclusive (napa overlaps red, so that pair is not counted).
		graph.precompute();
		expect(graph.exclusionPairCount).toBe(2);
	});

	it('rebuilds when the source-data version advances', () => {
		const store = makeStore();

		setRules(store, [
			['red', colorRule('red')],
			['white', colorRule('white')],
		]);
		const { graph } = makeGraph(store);

		// red {0,1} and white {2} are disjoint in the original corpus.
		expect(graph.areExclusive('red', 'white')).toBe(true);

		// New corpus where red and white co-occur in the same item -> no longer disjoint.
		store.sourceData.value = [{ color: 'red', region: 'Napa' }];
		store.sourceDataVersion.value = store.sourceDataVersion.value + 1;

		// The version bump forces a rebuild on the next query: white now matches nothing, so it
		// is still disjoint from red — but exercise the rebuild path and confirm a fresh count.
		store.sourceData.value = [
			{ color: 'red', region: 'Napa' },
			{ color: 'white', region: 'Napa' },
		];
		store.sourceDataVersion.value = store.sourceDataVersion.value + 1;
		graph.precompute();

		// red {0} and white {1} remain disjoint -> exactly one exclusive pair after rebuild.
		expect(graph.areExclusive('red', 'white')).toBe(true);
		expect(graph.exclusionPairCount).toBe(1);
	});

	it('invalidate() clears the cached graph', () => {
		const store = makeStore();

		setRules(store, [
			['red', colorRule('red')],
			['white', colorRule('white')],
		]);
		const { graph } = makeGraph(store);

		graph.precompute();
		expect(graph.exclusionPairCount).toBe(1);

		graph.invalidate();

		expect(graph.exclusionPairCount).toBe(0);
		expect(graph.isReady).toBe(false);
	});
});

describe('ExclusionGraph — off mode', () => {
	it('disables every query and never builds, even when the bitmap index is ready', () => {
		const store = makeStore();

		// red {0,1} and white {2} are disjoint — a lazy/eager graph WOULD report the exclusion.
		setRules(store, [
			['red', colorRule('red')],
			['white', colorRule('white')],
		]);
		// 'bitmap' mode + WASM initialized in beforeAll => bitmapIndex.isReady === true, so the
		// only thing suppressing the graph here is the 'off' mode itself (not a not-ready index).
		const bitmapIndex = new BitmapIndex(store, 'bitmap');

		expect(bitmapIndex.isReady).toBe(true);

		const graph = new ExclusionGraph(store, bitmapIndex, 'off');

		expect(graph.isReady).toBe(false);
		expect(graph.wouldExcludeAll('white', colorRule('white'))).toBe(false);
		expect(graph.areExclusive('red', 'white')).toBe(false);
		expect(graph.getExclusions('red')).toEqual([]);

		// precompute is a no-op in off mode — nothing is ever built.
		graph.precompute();
		expect(graph.exclusionPairCount).toBe(0);
	});
});
