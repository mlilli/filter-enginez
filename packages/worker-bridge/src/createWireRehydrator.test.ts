/**
 * The shared wire rehydrator — the contract both async adapters depend on.
 *
 * @remarks
 * **Deliberately not a copy of either consumer's suite.** `reactive-signals` and `reactive-rxjs`
 * each assert the behavior through their own mirrors, which is the right level for them. What only
 * a suite here can see is the part that is about the SHARED module rather than about either
 * adapter: that the adapter name reaches the message, that the per-rule warning dedupes, and that
 * the dedupe is scoped to the instance rather than to the module.
 *
 * That last one is the reason this is a factory at all, and it is the kind of property a
 * consumer-side test structurally cannot fail on — each of them builds exactly one.
 *
 * @packageDocumentation
 */

import { type CompositeRule, type FilterRule, inSet, type RuleId, value } from '@filter-enginez/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWireRehydrator } from './createWireRehydrator.js';

/** A rule in the shape the worker actually sends: serialized, no prototype. */
function wire(rule: FilterRule): FilterRule {
	return rule.serialize() as unknown as FilterRule;
}

/** A wire object whose `type` the registry does not know, so `deserialize` throws. */
function unknownRuleType(): FilterRule {
	return { config: {}, type: '__not-registered__' } as unknown as FilterRule;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('createWireRehydrator — rules', () => {
	it('rebuilds live instances from wire shapes', () => {
		const rehydrator = createWireRehydrator('testAdapter');
		const raw = new Map<RuleId, FilterRule>([
			['price', wire(value('price', 10))],
			['origin', wire(inSet<string>('origin', ['Italy']))],
		]);

		const out = rehydrator.rules(raw);

		// A reconstructed instance carries prototype methods the bare wire object lacks; round-tripping
		// `serialize` is what distinguishes a real instance from a plausible-looking object.
		expect(out.size).toBe(2);
		expect(out.get('price')?.serialize().type).toBe('ValueRule');
		expect(out.get('origin')?.serialize().type).toBe('InSetRule');
	});

	it('skips a rule the registry cannot rebuild and keeps the rest', () => {
		const warn = vi.fn();

		vi.stubGlobal('console', { warn });

		const rehydrator = createWireRehydrator('testAdapter');
		const out = rehydrator.rules(
			new Map<RuleId, FilterRule>([
				['good', wire(value('price', 10))],
				['bad', unknownRuleType()],
			]),
		);

		// A rule map is a COLLECTION, so dropping one member degrades gracefully — which is why rules
		// are skipped where the expression falls back to raw.
		expect(out.has('good')).toBe(true);
		expect(out.has('bad')).toBe(false);
	});

	it('names the ADAPTER in the warning', () => {
		// The property a consumer-side suite cannot fail on: both of them match on the rest of the
		// message, so a hardcoded name would satisfy every test they have. Same reasoning as
		// `createAsyncDevtoolsShim`'s `adapterName`.
		const warn = vi.fn();

		vi.stubGlobal('console', { warn });

		createWireRehydrator('someParticularAdapter').rules(new Map([['bad', unknownRuleType()]]));

		expect(String(warn.mock.calls[0]?.[0])).toContain('someParticularAdapter');
		expect(String(warn.mock.calls[0]?.[0])).toContain("rule 'bad'");
	});

	it('warns ONCE per rule id across repeated refreshes', () => {
		// The whole reason the level can be `warn`. `PredicateRule` is unserializable by design, so
		// without this a config using one warns on every settle — hundreds per session for an
		// expected condition, which is how a log level stops being read.
		const warn = vi.fn();

		vi.stubGlobal('console', { warn });

		const rehydrator = createWireRehydrator('testAdapter');
		const raw = new Map<RuleId, FilterRule>([['bad', unknownRuleType()]]);

		rehydrator.rules(raw);
		rehydrator.rules(raw);
		rehydrator.rules(raw);

		expect(warn).toHaveBeenCalledTimes(1);
	});

	it('dedupes per INSTANCE, not per module', () => {
		// Why this is a factory. A module-level set would silence the warning for every later engine
		// in the same process — including the second one in a test file, which is the shape of a
		// guard that quietly stops guarding.
		const warn = vi.fn();

		vi.stubGlobal('console', { warn });

		const raw = new Map<RuleId, FilterRule>([['bad', unknownRuleType()]]);

		createWireRehydrator('first').rules(raw);
		createWireRehydrator('second').rules(raw);

		expect(warn).toHaveBeenCalledTimes(2);
	});

	it('warns once PER ID, not once overall', () => {
		// A dedupe keyed on "have we warned at all" would report the first bad rule and hide every
		// other one — which is worse than not deduping, because it looks like a single problem.
		const warn = vi.fn();

		vi.stubGlobal('console', { warn });

		createWireRehydrator('testAdapter').rules(
			new Map<RuleId, FilterRule>([
				['bad-one', unknownRuleType()],
				['bad-two', unknownRuleType()],
			]),
		);

		expect(warn).toHaveBeenCalledTimes(2);
	});
});

describe('createWireRehydrator — expression', () => {
	it('passes null through', () => {
		expect(createWireRehydrator('testAdapter').expression(null)).toBeNull();
	});

	it('passes an already-live expression through SILENTLY', () => {
		// **Identity alone does not test the fast path, and mutation is what showed it.** Removing the
		// `typeof raw.serialize === 'function'` check leaves this returning the same object anyway:
		// `ruleRegistry.deserialize` throws on a live instance, and the catch falls back to `raw`. The
		// observable difference is the WARNING — without the fast path, every perfectly good
		// expression logs one, on every settle, for the life of the session.
		//
		// So the assertion that matters is silence. Identity is kept because it is still the contract.
		const warn = vi.fn();

		vi.stubGlobal('console', { warn });

		const live = inSet<string>('origin', ['Italy']) as unknown as CompositeRule;

		expect(createWireRehydrator('testAdapter').expression(live)).toBe(live);
		expect(warn).not.toHaveBeenCalled();
	});

	it('falls back to the RAW value, never to null, when the registry cannot rebuild it', () => {
		// Raw, deliberately — never `null`, which would be the tempting "safe" choice. `null` is the
		// flat-map sentinel: returning it claims no expression is active while the engine is
		// filtering by one, and no consumer can tell that apart from a genuinely empty expression.
		const warn = vi.fn();

		vi.stubGlobal('console', { warn });

		const raw = { config: {}, type: '__not-registered__' } as unknown as CompositeRule;
		const out = createWireRehydrator('testAdapter').expression(raw);

		expect(out).toBe(raw);
		expect(out).not.toBeNull();
		expect(String(warn.mock.calls[0]?.[0])).toContain('expression could not be rehydrated');
		expect(String(warn.mock.calls[0]?.[0])).toContain('testAdapter');
	});

	it('does NOT dedupe the expression warning', () => {
		// Rules dedupe because a rule map is re-read on every settle and an unserializable rule is a
		// standing config fact. An expression failure is a state transition — the same expression
		// failing twice is two separate events worth seeing, and there is no id to key on anyway.
		const warn = vi.fn();

		vi.stubGlobal('console', { warn });

		const rehydrator = createWireRehydrator('testAdapter');
		const raw = { config: {}, type: '__not-registered__' } as unknown as CompositeRule;

		rehydrator.expression(raw);
		rehydrator.expression(raw);

		expect(warn).toHaveBeenCalledTimes(2);
	});
});
