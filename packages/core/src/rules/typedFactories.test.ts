/**
 * Tests for `rulesFor<T>()` — the rule builders with each field typed against the item.
 *
 * @remarks
 * At run time the typed builders are the plain ones, so a rule built through them is the same class
 * and filters the same items. The type checks are the point: each `@ts-expect-error` below is a line
 * that must NOT compile (a mistyped field, a value of the wrong type, a path through an array or into
 * a key containing a dot), and `pnpm typecheck` fails if any of them starts compiling. `expectTypeOf`
 * pins what `FieldPath` and `PathValue` resolve to.
 */

// cspell:ignore acount adress -- the deliberate typos the type checks reject
import { describe, expect, expectTypeOf, it } from 'vitest';

import { createFilterEngine } from '../createFilterEngine.js';
import { DateRangeRule } from './DateRangeRule.js';
import { InSetRule } from './InSetRule.js';
import { TextSearchRule } from './TextSearchRule.js';
import { type FieldPath, type PathValue, rulesFor } from './typedFactories.js';
import { ValueRule } from './ValueRule.js';

interface Transaction {
	readonly accountId: string;
	readonly amount: number;
	readonly cleared: boolean;
	readonly memo?: string;
	readonly 'odd.key': number;
	readonly payee: { readonly address: { readonly city: string; }; readonly name: string; };
	readonly postedOn: string;
	readonly tags: readonly string[];
}

const TRANSACTIONS: readonly Transaction[] = [
	{
		accountId: 'checking',
		amount: 42,
		cleared: true,
		'odd.key': 1,
		payee: { address: { city: 'Denver' }, name: 'Café Zoë' },
		postedOn: '2026-11-02',
		tags: ['coffee', 'food'],
	},
	{
		accountId: 'savings',
		amount: 1200,
		cleared: false,
		memo: 'rent',
		'odd.key': 2,
		payee: { address: { city: 'Auckland' }, name: 'Landlord' },
		postedOn: '2026-10-01',
		tags: ['housing'],
	},
];

const rules = rulesFor<Transaction>();

/** The amounts of the transactions one rule passes. */
function amountsPassing(rule: Parameters<ReturnType<typeof createFilterEngine<Transaction>>['addRule']>[1]): number[] {
	const engine = createFilterEngine<Transaction>({ sourceData: TRANSACTIONS });

	engine.addRule('r', rule);

	return engine.getResults().map((transaction) => transaction.amount);
}

describe('rulesFor', () => {
	it('builds the same rules as the plain builders', () => {
		expect(rules.value('accountId', 'checking')).toBeInstanceOf(ValueRule);
		expect(rules.inSet('tags', ['food'])).toBeInstanceOf(InSetRule);
		expect(rules.text('payee.name', { mode: 'substring', query: 'cafe' })).toBeInstanceOf(TextSearchRule);
		expect(rules.dateRange('postedOn', { mode: 'day', start: '2026-11-01' })).toBeInstanceOf(DateRangeRule);
	});

	it('filters by a typed key, a nested path, a list of paths and a function', () => {
		expect(amountsPassing(rules.value('accountId', 'savings'))).toEqual([1200]);
		expect(amountsPassing(rules.value('payee.address.city', 'Denver'))).toEqual([42]);
		expect(amountsPassing(rules.text('payee.name', { diacritics: 'ignore', mode: 'allWords', query: 'cafe zoe' }))).toEqual([42]);
		expect(amountsPassing(rules.inSet('tags', ['housing']))).toEqual([1200]);
		expect(amountsPassing(rules.value(['memo', 'accountId'], 'rent'))).toEqual([1200]);
		expect(amountsPassing(rules.value((item) => item.amount > 100, true))).toEqual([1200]);
		expect(amountsPassing(rules.range('amount', { max: 100, min: 0 }))).toEqual([42]);
		expect(amountsPassing(rules.bool('cleared', true))).toEqual([42]);
		expect(amountsPassing(rules.exists('memo'))).toEqual([1200]);
		expect(amountsPassing(rules.predicate(undefined, (item) => item.tags.length > 1))).toEqual([42]);
		expect(amountsPassing(rules.dateRange('postedOn', { mode: 'day', preset: 'this-month', today: '2026-11-04' }))).toEqual([42]);
	});

	it('rejects at compile time what the item type does not have', () => {
		// @ts-expect-error -- a mistyped field
		rules.value('acountId', 'checking');
		// @ts-expect-error -- a number for a string field
		rules.value('accountId', 42);
		// @ts-expect-error -- a mistyped nested path
		rules.value('payee.adress.city', 'Denver');
		// @ts-expect-error -- a set of numbers for a field of strings
		rules.inSet('tags', [1, 2]);
		// @ts-expect-error -- a path into an array, which FieldPath does not name (use the plain builders)
		rules.text('tags.0', { mode: 'exact', query: 'coffee' });
		// @ts-expect-error -- a key containing a dot, which a dotted path cannot name
		rules.value('odd.key', 1);
		// @ts-expect-error -- a mistyped path in a list of paths
		rules.exists(['memo', 'mem']);
		expect(true).toBe(true);
	});

	it('resolves the paths and their value types', () => {
		expectTypeOf<FieldPath<Transaction>>().toEqualTypeOf<
			| 'accountId'
			| 'amount'
			| 'cleared'
			| 'memo'
			| 'payee.address.city'
			| 'payee.address'
			| 'payee.name'
			| 'payee'
			| 'postedOn'
			| 'tags'
		>();
		expectTypeOf<PathValue<Transaction, 'payee.address.city'>>().toEqualTypeOf<string>();
		expectTypeOf<PathValue<Transaction, 'memo'>>().toEqualTypeOf<string | undefined>();
		expectTypeOf<PathValue<Transaction, 'tags'>>().toEqualTypeOf<readonly string[]>();
	});

	it('stops five levels deep', () => {
		interface Deep { readonly a: { readonly b: { readonly c: { readonly d: { readonly e: { readonly f: number; }; }; }; }; }; }

		expectTypeOf<'a.b.c.d.e'>().toExtend<FieldPath<Deep>>();
		expectTypeOf<Extract<FieldPath<Deep>, 'a.b.c.d.e.f'>>().toBeNever();
	});
});
