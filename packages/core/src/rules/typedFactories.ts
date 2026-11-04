/**
 * `rulesFor<T>()` — the rule builders, with each `field` checked against the item type `T`.
 *
 * @remarks
 * The builders in `./factories.ts` take a field as a plain string, so a typo in a path is found only
 * when the rule filters nothing. `rulesFor<Transaction>()` returns the same builders typed against
 * `Transaction`: a field is a {@link FieldPath} of it (a key, or a dotted path through nested objects),
 * a list of such paths (tried in order), a function of the item, or `undefined` for the item itself.
 * `value` and `inSet` also type the value against the field's own type, so
 * `rulesFor<Transaction>().value('acountId', id)` does not compile, and neither does a number for a
 * string field. The string form stays as it was for paths built at run time.
 *
 * The builders are the same functions at run time; only their types differ. `FieldPath` descends five
 * levels and stops at values that are not plain objects (arrays, dates, maps, sets, functions), and
 * leaves out keys that contain `.` or `[`, which a dotted path cannot name: for those, and for array
 * indices (`'tags[0]'`), use the plain builders.
 *
 * @example
 *   interface Transaction { readonly accountId: string; readonly amount: number; readonly payee: { readonly name: string } }
 *
 *   const rules = rulesFor<Transaction>();
 *
 *   engine.addRule('account', rules.value('accountId', 'checking'));
 *   engine.addRule('payee', rules.text('payee.name', { mode: 'substring', query: 'café', diacritics: 'ignore' }));
 *   // rules.value('acountId', 'checking')  — does not compile: not a field of Transaction
 *   // rules.value('amount', 'ten')         — does not compile: amount is a number
 *
 * @packageDocumentation
 */

// cspell:ignore acount -- the deliberate typo the examples show rejected
import type { BloomFilter } from '../lib/BloomFilter.js';
import type { ArrayMatchOptions } from './arrayMatch.js';
import type { BloomMembershipRule } from './BloomMembershipRule.js';
import type { BooleanRule } from './BooleanRule.js';
import type { DateRangeConfig, DateRangeRule, DateRangeRuleConfig } from './DateRangeRule.js';
import type { ExistsRule } from './ExistsRule.js';
import type { FuzzySearchRule, FuzzySearchRuleConfig } from './FuzzySearchRule.js';
import type { GeoProximityRule, GeoProximityRuleConfig } from './GeoProximityRule.js';
import type { HierarchicalRule, HierarchicalRuleConfig } from './HierarchicalRule.js';
import type { InSetofSetsRule } from './InSetofSetsRule.js';
import type { InSetRule, InSetRuleConfig } from './InSetRule.js';
import type { NumericComparisonRule, NumericComparisonRuleConfig } from './NumericComparisonRule.js';
import type { PredicateRule } from './PredicateRule.js';
import type { RangeRule, RangeRuleConfig } from './RangeRule.js';
import type { RegexRule, RegexRuleConfig } from './RegexRule.js';
import type { TextSearchRule, TextSearchRuleConfig } from './TextSearchRule.js';
import type { ValueRule } from './ValueRule.js';

import {
	bloomMembership,
	bool,
	dateRange,
	exists,
	fuzzy,
	geo,
	hierarchical,
	inSet,
	inSetofSets,
	numCompare,
	predicate,
	range,
	regex,
	text,
	value,
} from './factories.js';

// #region docs:typed-rule-builders
/** A value `FieldPath` stops at: anything that is not a plain object with keys to name. */
type FieldLeaf =
	| Date
	| ReadonlyMap<unknown, unknown>
	| ReadonlySet<unknown>
	| RegExp
	| bigint
	| boolean
	| number
	| string
	| symbol
	| ((...args: never[]) => unknown)
	| null
	| undefined
	| readonly unknown[];

/** One level shallower than each depth, for {@link FieldPath}'s recursion limit. */
type ShallowerDepth = [never, 0, 1, 2, 3];

/**
 * Every field of `T` a string path can name: each key, and `key.path` for a key whose value is a plain
 * object, five levels deep. Keys containing `.` or `[` are left out, since a dotted path cannot name them.
 *
 * @typeParam T - The item type
 */
export type FieldPath<T, Depth extends number = 4> = [Depth] extends [never]
	? never
	: T extends FieldLeaf
		? never
		: {
			[K in keyof T & string]: K extends `${string}.${string}` | `${string}[${string}`
				? never
				: K | (NonNullable<T[K]> extends FieldLeaf ? never : `${K}.${FieldPath<NonNullable<T[K]>, ShallowerDepth[Depth]>}`);
		}[keyof T & string];

/**
 * The type of the field a {@link FieldPath} names, `undefined` included where a step can be missing.
 *
 * @typeParam T - The item type
 * @typeParam P - The path
 */
export type PathValue<T, P extends string> = T extends unknown
	? P extends `${infer Key}.${infer Rest}`
		? Key extends keyof T ? PathValue<T[Key], Rest> : undefined
		: P extends keyof T ? T[P] : undefined
	: never;

/** What an `inSet` value is compared with: the element of an array field, or the field itself. */
type SetMember<V> = V extends readonly (infer Element)[] ? Element : V;

/**
 * A field, typed against the item: a {@link FieldPath}, paths tried in order, a function of the item,
 * or `undefined` for the item itself.
 *
 * @typeParam T - The item type
 */
export type TypedField<T> = FieldPath<T> | ((item: T) => unknown) | undefined | readonly FieldPath<T>[];

/**
 * The rule builders of `./factories.ts`, with each field typed against `T`, and the values of `value`
 * and `inSet` against the field's type.
 *
 * @typeParam T - The item type
 */
export interface TypedRuleBuilders<T> {
	bloomMembership(field: TypedField<T>, filter: BloomFilter): BloomMembershipRule;
	bool(field: TypedField<T>, val: boolean | undefined): BooleanRule;
	dateRange<C extends DateRangeConfig = DateRangeRuleConfig>(field: TypedField<T>, config: C): DateRangeRule<C>;
	exists(field: TypedField<T>): ExistsRule;
	fuzzy(field: TypedField<T>, config: FuzzySearchRuleConfig): FuzzySearchRule;
	geo(field: TypedField<T>, config: GeoProximityRuleConfig): GeoProximityRule;
	hierarchical(field: TypedField<T>, config: HierarchicalRuleConfig): HierarchicalRule;
	inSet<P extends FieldPath<T>>(
		field: P,
		initialSetOrConfig: InSetRuleConfig<SetMember<PathValue<T, P>>> | readonly SetMember<PathValue<T, P>>[],
	): InSetRule<SetMember<PathValue<T, P>>>;
	inSet<V>(
		field: ((item: T) => unknown) | undefined | readonly FieldPath<T>[],
		initialSetOrConfig: InSetRuleConfig<V> | readonly V[],
	): InSetRule<V>;
	inSetofSets<V>(field: TypedField<T>, initialSets?: readonly (readonly V[])[], options?: ArrayMatchOptions): InSetofSetsRule<V>;
	numCompare(field: TypedField<T>, config: NumericComparisonRuleConfig): NumericComparisonRule;
	predicate(field: TypedField<T>, predicateFn: (item: T, rule: PredicateRule<T>) => boolean): PredicateRule<T>;
	range(field: TypedField<T>, config: RangeRuleConfig): RangeRule;
	regex(field: TypedField<T>, config: RegexRuleConfig): RegexRule;
	text(field: TypedField<T>, config: TextSearchRuleConfig): TextSearchRule;
	value<P extends FieldPath<T>>(field: P, targetValue: PathValue<T, P> | undefined): ValueRule<PathValue<T, P>>;
	value<V>(field: ((item: T) => V) | undefined | readonly FieldPath<T>[], targetValue: V | undefined): ValueRule<V>;
}
// #endregion docs:typed-rule-builders

/** The plain builders, which `rulesFor` hands out under typed signatures. */
const RULE_BUILDERS = {
	bloomMembership,
	bool,
	dateRange,
	exists,
	fuzzy,
	geo,
	hierarchical,
	inSet,
	inSetofSets,
	numCompare,
	predicate,
	range,
	regex,
	text,
	value,
} as const;

/**
 * The rule builders, typed against the item type `T`.
 *
 * @typeParam T - The item type the rules filter
 * @returns The builders of `./factories.ts` — the same functions — with `field` checked against `T`
 */
export function rulesFor<T>(): TypedRuleBuilders<T> {
	// The plain builders accept every field the typed ones do (a typed path is a string, a typed
	// function a function), so the narrower signatures describe the same functions.
	return RULE_BUILDERS as unknown as TypedRuleBuilders<T>;
}
