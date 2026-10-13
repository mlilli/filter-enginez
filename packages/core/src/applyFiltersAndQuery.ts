/**
 * `runFilterBundleQuery` — the single-pass implementation behind
 * `FilterEngine.applyFiltersAndQuery`.
 *
 * @remarks
 * Lives outside `FilterEngine` to keep that facade small, and is decomposed into named,
 * individually-testable helpers. The algorithm: one pass over the working set evaluates each rule
 * once per item, then derives current-results membership, per-field "filtered-except-self"
 * bounds + histograms, and per-chip-group exclusion counts via an inverted attribution index.
 *
 * See `queryBundle.ts` for the full design rationale of the bundle query/response shapes.
 *
 * @packageDocumentation
 */

import type {
	FilterBundle,
	FilterBundleChipCandidateMeta,
	FilterBundleChipGroupMeta,
	FilterBundleChipGroupQuery,
	FilterBundleFieldMeta,
	FilterBundleFieldQuery,
	FilterBundleQuery,
} from './queryBundle.js';
import type { FilterRule } from './rules/FilterRule.js';
import type { RuleId } from './types.js';

/** An active rule paired with its registry id, in evaluation order. */
interface RuleEntry {
	readonly id: RuleId;
	readonly rule: FilterRule;
}

/** Mutable per-field accumulator filled during the single pass, then packaged at the end. */
interface FieldAccumulator {
	readonly excludeIdx: number;
	max: number;
	min: number;
	readonly query: FilterBundleFieldQuery;
	readonly values: number[];
}

/** Mutable per-chip-group accumulator filled during the single pass. */
interface ChipAccumulator {
	readonly counts: Uint32Array;
	readonly excludeIdx: number;
	/** `leafValue -> candidate indices it attributes to`. */
	readonly invertedIndex: Map<string, number[]>;
	readonly query: FilterBundleChipGroupQuery;
}

/**
 * Find the position of the rule whose id matches `target` within `rules`, or `-1` when the
 * rule isn't currently registered (no exclusion needed).
 */
function findRuleIndex(rules: readonly RuleEntry[], target: RuleId): number {
	for (let r = 0; r < rules.length; r++) {
		const entry = rules[r];

		if (entry !== undefined && entry.id === target) {
			return r;
		}
	}

	return -1;
}

/**
 * Build the inverted attribution index for one chip group. For `'inSet'`, each candidate
 * string maps to its own single index; for `'inSetOfSets'`, each leaf id maps to every
 * candidate whose `leafIds` contain it (a leaf can attribute to multiple candidates).
 */
function buildInvertedIndex(query: FilterBundleChipGroupQuery): Map<string, number[]> {
	const inverted = new Map<string, number[]>();

	// `'containsAll'` indexes identically to `'inSet'` — each candidate is its own key. The two
	// diverge on the READ side (`accumulateChip` walks an array instead of comparing a string) and
	// on whether the group's own rule stays active. See the kind's docblock in `queryBundle.ts`.
	if (query.kind === 'inSet' || query.kind === 'containsAll') {
		for (let c = 0; c < query.candidates.length; c++) {
			const value = query.candidates[c];

			if (value === undefined) {
				continue;
			}
			pushAttribution(inverted, value, c);
		}

		return inverted;
	}

	for (let c = 0; c < query.candidates.length; c++) {
		const node = query.candidates[c];

		if (node === undefined) {
			continue;
		}
		for (const leafId of node.leafIds) {
			pushAttribution(inverted, leafId, c);
		}
	}

	return inverted;
}

/** Append candidate index `c` to the attribution list for `key`, creating the list lazily. */
function pushAttribution(inverted: Map<string, number[]>, key: string, c: number): void {
	let list = inverted.get(key);

	if (list === undefined) {
		list = [];
		inverted.set(key, list);
	}
	list.push(c);
}

/**
 * Whether the item passes every active rule EXCEPT the one at `excludeIdx`, given the
 * per-rule pass/fail vector already computed for this item.
 */
function passesExcept(passVec: Uint8Array, excludeIdx: number): boolean {
	for (let r = 0; r < passVec.length; r++) {
		if (r === excludeIdx) {
			continue;
		}
		if (passVec[r] === 0) {
			return false;
		}
	}

	return true;
}

/** Record one finite field value into a field accumulator, updating its tight min/max. */
function recordFieldValue(field: FieldAccumulator, item: object): void {
	const value = (item as Record<string, unknown>)[field.query.fieldKey];

	if (typeof value === 'number' && Number.isFinite(value)) {
		field.values.push(value);
		if (value < field.min) {
			field.min = value;
		}
		if (value > field.max) {
			field.max = value;
		}
	}
}

/**
 * Increment per-candidate counts for one chip group, attributing the item via the inverted
 * index keyed on its `field` value.
 */
function accumulateChip(chip: ChipAccumulator, item: object): void {
	const itemValue = (item as Record<string, unknown>)[chip.query.field];

	// Conjunctive groups read an ARRAY field and attribute the item once per value it contains,
	// so a listing with ['pool','garage'] counts toward both candidates. Deduplicated because a
	// corpus is free to repeat a value within one array and a double count would overstate the
	// projection.
	if (chip.query.kind === 'containsAll') {
		if (!Array.isArray(itemValue)) {
			return;
		}
		const seen = new Set<string>();

		for (const entry of itemValue) {
			if (typeof entry !== 'string' || seen.has(entry)) {
				continue;
			}
			seen.add(entry);
			creditCandidates(chip, entry);
		}

		return;
	}

	if (typeof itemValue !== 'string') {
		return;
	}
	creditCandidates(chip, itemValue);
}

/** Increment every candidate the given value attributes to, via the inverted index. */
function creditCandidates(chip: ChipAccumulator, value: string): void {
	const attributions = chip.invertedIndex.get(value);

	if (attributions === undefined) {
		return;
	}
	for (const c of attributions) {
		/* v8 ignore next -- defensive: noUncheckedIndexedAccess fallback; chip.counts is a dense Uint32Array */
		chip.counts[c] = (chip.counts[c] ?? 0) + 1;
	}
}

/** Package one field accumulator into its returned `FilterBundleFieldMeta` (with histogram). */
function packageField(field: FieldAccumulator): FilterBundleFieldMeta {
	const { query, values } = field;
	const hadValues = values.length > 0;
	const tightMin = hadValues ? field.min : null;
	const tightMax = hadValues ? field.max : null;

	const bucketCount = query.bucketCount ?? 12;
	const bucketMin = query.baselineMin ?? tightMin ?? 0;
	const bucketMax = query.baselineMax ?? tightMax ?? 1;
	const span = bucketMax - bucketMin;

	const bucketEdges = new Float64Array(bucketCount + 1);
	const counts = new Uint32Array(bucketCount);

	if (span > 0 && bucketCount > 0) {
		const width = span / bucketCount;

		for (let e = 0; e <= bucketCount; e++) {
			bucketEdges[e] = bucketMin + e * width;
		}
		for (const v of values) {
			if (v < bucketMin || v > bucketMax) {
				continue;
			}
			const idx = Math.min(Math.floor((v - bucketMin) / width), bucketCount - 1);

			/* v8 ignore next -- defensive: noUncheckedIndexedAccess fallback; idx is clamped to [0, bucketCount-1] and counts is a dense Uint32Array */
			counts[idx] = (counts[idx] ?? 0) + 1;
		}
	} else if (bucketCount > 0) {
		// Degenerate: zero or negative span. Fill edges with bucketMin so the array has the
		// right shape; counts stay 0.
		for (let e = 0; e <= bucketCount; e++) {
			bucketEdges[e] = bucketMin;
		}
	}

	return {
		bounds: { max: tightMax, min: tightMin },
		fieldKey: query.fieldKey,
		histogram: { bucketEdges, counts },
		ruleId: query.ruleId,
	};
}

/** Package one chip-group accumulator into its returned `FilterBundleChipGroupMeta`. */
function packageChipGroup(chip: ChipAccumulator): FilterBundleChipGroupMeta {
	const { counts, query } = chip;
	const candidatesOut: FilterBundleChipCandidateMeta[] = new Array<FilterBundleChipCandidateMeta>(
		query.candidates.length,
	);

	for (let c = 0; c < query.candidates.length; c++) {
		/* v8 ignore next -- defensive: noUncheckedIndexedAccess fallback; c < candidates.length = counts.length and counts is a dense Uint32Array */
		const projected = counts[c] ?? 0;
		const candidate = query.candidates[c];
		// Both `'inSet'` and `'containsAll'` carry bare strings; only `'inSetOfSets'` wraps them.
		const candidateValue = query.kind === 'inSetOfSets'
			? (candidate as { value: string } | undefined)?.value ?? ''
			: (candidate as string | undefined) ?? '';

		candidatesOut[c] = {
			projectedCount: projected,
			value: candidateValue,
			wouldBeEmpty: projected === 0,
		};
	}

	return { candidates: candidatesOut, ruleId: query.ruleId };
}

/**
 * Run a `FilterBundleQuery` over `workingSet` + the active `ruleEntries`, returning the
 * fully-computed `FilterBundle`. Single pass over the working set; behavior + numeric output
 * are identical to the prior inline implementation.
 */
export function runFilterBundleQuery<T>(
	workingSet: readonly T[],
	ruleEntries: ReadonlyMap<RuleId, FilterRule>,
	query: FilterBundleQuery,
): FilterBundle {
	const allRules: RuleEntry[] = [];

	for (const [id, rule] of ruleEntries) {
		allRules.push({ id, rule });
	}

	const fieldsQuery: readonly FilterBundleFieldQuery[] = query.fields ?? [];
	const chipsQuery: readonly FilterBundleChipGroupQuery[] = query.chipGroups ?? [];

	const fields: FieldAccumulator[] = fieldsQuery.map((fq) => ({
		excludeIdx: findRuleIndex(allRules, fq.ruleId),
		max: Number.NEGATIVE_INFINITY,
		min: Number.POSITIVE_INFINITY,
		query: fq,
		values: [],
	}));

	const chips: ChipAccumulator[] = chipsQuery.map((cq) => ({
		counts: new Uint32Array(cq.candidates.length),
		// THE conjunctive/disjunctive split, in one line. A disjunctive candidate WIDENS its own
		// rule, so that rule is excluded and the candidate is tested alone. A conjunctive one
		// NARROWS it, so the rule stays active (-1 excludes nothing) and the candidate is required
		// on top of whatever is already selected — otherwise every value would be projected in
		// isolation and report reachable when combining it with the live selection matches nothing.
		excludeIdx: cq.kind === 'containsAll' ? -1 : findRuleIndex(allRules, cq.ruleId),
		invertedIndex: buildInvertedIndex(cq),
		query: cq,
	}));

	const resultIndices: number[] = [];
	const passVec = new Uint8Array(allRules.length);

	for (let i = 0; i < workingSet.length; i++) {
		const item = workingSet[i];

		if (item === undefined || item === null) {
			continue;
		}

		// Single pass over rules: record pass(1)/fail(0) per rule.
		let didPassAll = true;

		for (let r = 0; r < allRules.length; r++) {
			const ruleEntry = allRules[r];

			/* v8 ignore next 3 -- defensive: noUncheckedIndexedAccess guard; allRules is dense, indexed by r < length */
			if (ruleEntry === undefined) {
				continue;
			}
			const isPass = ruleEntry.rule.action(item, ruleEntry.rule);

			passVec[r] = isPass ? 1 : 0;
			if (!isPass) {
				didPassAll = false;
			}
		}

		if (didPassAll) {
			resultIndices.push(i);
		}

		const itemObject = item as object;

		for (const field of fields) {
			if (passesExcept(passVec, field.excludeIdx)) {
				recordFieldValue(field, itemObject);
			}
		}

		for (const chip of chips) {
			if (passesExcept(passVec, chip.excludeIdx)) {
				accumulateChip(chip, itemObject);
			}
		}
	}

	return {
		chipGroups: chips.map(packageChipGroup),
		fields: fields.map(packageField),
		resultCount: resultIndices.length,
		resultIndices: Uint32Array.from(resultIndices),
	};
}
