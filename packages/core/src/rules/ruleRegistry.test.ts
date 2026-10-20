/**
 * Tests for `RuleRegistry`, `RuleRegistryError`, and the `ruleRegistry` singleton — the
 * serialization plane that maps type names to rule classes and reconstructs instances.
 *
 * @remarks
 * Covers `register` (happy + duplicate error), `unregister`, `get` (happy + unknown-type error),
 * `has`, the entries iterator, and `deserialize` across all three reconstruction paths:
 *   1. per-class `static deserialize` hook (`RegexRule`, `DateRangeRule`, `RangeRule`), called
 *      with the registered class as `this`
 *   2. generic two-arg construction (`TextSearchRule`, `ValueRule`)
 *   3. single-arg fallback when the two-arg call throws (a consumer rule that spreads its array
 *      argument; the built-ins with such constructors have hooks)
 * plus the `<function>` → `undefined` field normalization and the unknown-type throw.
 *
 * Each test builds its own fresh `RuleRegistry` so the module-level singleton is never mutated;
 * one dedicated test asserts the singleton ships with the built-ins pre-registered.
 */

import { describe, expect, it } from 'vitest';

import type { FieldExtractor, FilterRuleAction, SerializedRule } from '../types.js';

import { FilterEngineError, FilterEngineRuleError } from '../errors/index.js';
import { CompositeRule } from './CompositeRule.js';
import { DateRangeRule } from './DateRangeRule.js';
import { FilterRule } from './FilterRule.js';
import { InSetRule } from './InSetRule.js';
import { RangeRule } from './RangeRule.js';
import { RegexRule } from './RegexRule.js';
import { type RuleClass, ruleRegistry, RuleRegistry, RuleRegistryError } from './ruleRegistry.js';
import { TextSearchRule } from './TextSearchRule.js';
import { ValueRule } from './ValueRule.js';

/**
 * A registrable consumer rule that does NOT collide with the built-in names. It has no
 * `static deserialize` hook, and its constructor takes an ARRAY as its second
 * argument and spreads it, so the serialized `{ values: [...] }` object makes the two-argument
 * construction throw ("not iterable").
 *
 * @remarks
 * This is the shape the registry's single-argument fallback exists for. Every built-in rule with such
 * a constructor (`InSetRule`, `InSetofSetsRule`, …) now has its own hook, so a consumer rule like this
 * one is what reaches the fallback.
 */
class CustomRule extends FilterRule {
	static override readonly ruleTypeName = 'CustomRule';

	config: { readonly values: readonly string[] };

	/** Passes when the field value is one of `config.values`. */
	override action: FilterRuleAction = (item, rule): boolean =>
		(rule as CustomRule).config.values.includes(this.getFieldValue(item) as string);

	/**
	 * @param field - How to pull the value from each item
	 * @param values - The accepted values, spread into the config
	 */
	constructor(field?: FieldExtractor, values: readonly string[] = []) {
		super(field);
		this.config = { values: [...values]};
	}
}

/**
 * A subclass that never declared `ruleTypeName` — the exact mistake the contract exists to catch.
 * TypeScript rejects `register('ForgotTheStaticRule', ForgotTheStaticRule)` outright (its inherited
 * static is `string`, not the literal), so reaching the RUNTIME guard requires a cast, which is
 * precisely the JavaScript-consumer path that guard is for.
 */
class ForgotTheStaticRule extends FilterRule {
	config: undefined = undefined;
}

/**
 * Cast a rule class past `register`'s COMPILE-TIME pairing check so the runtime guard behind it can
 * be exercised.
 *
 * @remarks
 * `ruleTypeName: never` satisfies whatever literal the call site asks for. Per the
 * repo's no-`any` rule this is `as unknown as Target`, not `as any` — and it is deliberately
 * a named helper rather than an inline cast, because every use of it is a claim about the
 * JavaScript-consumer path and that claim should be legible at the call site.
 *
 * @param ruleClass - Any rule class
 * @returns The same class, typed so any `register` name accepts it
 */
function castPastPairingCheck(ruleClass: RuleClass): { readonly ruleTypeName: never } & RuleClass {
	return ruleClass as unknown as { readonly ruleTypeName: never } & RuleClass;
}

describe('RuleRegistryError', () => {
	it('carries a structured code and the RuleRegistryError name', () => {
		const error = new RuleRegistryError('REGISTRY_UNKNOWN_TYPE', 'boom');

		expect(error).toBeInstanceOf(Error);
		// Part of the engine's hierarchy, so a generic `instanceof FilterEngineError` catches it too.
		expect(error).toBeInstanceOf(FilterEngineRuleError);
		expect(error).toBeInstanceOf(FilterEngineError);
		expect(error.name).toBe('RuleRegistryError');
		expect(error.code).toBe('REGISTRY_UNKNOWN_TYPE');
		expect(error.message).toBe('boom');
	});
});

describe('RuleRegistry', () => {
	it('auto-registers the built-in rule catalog on construction', () => {
		const registry = new RuleRegistry();

		expect(registry.has('RangeRule')).toBe(true);
		expect(registry.has('CompositeRule')).toBe(true);
		expect(registry.has('BloomMembershipRule')).toBe(true);
		expect(registry.get('ValueRule')).toBe(ValueRule);
	});

	describe('register', () => {
		it('registers a custom rule class under a new type name', () => {
			const registry = new RuleRegistry();

			registry.register('CustomRule', CustomRule);

			expect(registry.has('CustomRule')).toBe(true);
			expect(registry.get('CustomRule')).toBe(CustomRule);
		});

		it('throws REGISTRY_DUPLICATE when the type name is already registered', () => {
			const registry = new RuleRegistry();

			// A built-in re-registering itself: the pairing check passes (RangeRule.ruleTypeName IS
			// 'RangeRule'), so the duplicate check is what fires — which is the ordering this test
			// means to pin.
			expect(() => registry.register('RangeRule', RangeRule)).toThrowError(RuleRegistryError);

			try {
				registry.register('RangeRule', RangeRule);
				expect.unreachable('expected a duplicate-registration throw');
			} catch (error) {
				expect(error).toBeInstanceOf(RuleRegistryError);
				expect((error as RuleRegistryError).code).toBe('REGISTRY_DUPLICATE');
			}
		});

		it('throws REGISTRY_TYPE_NAME_MISMATCH when the class declares a different name', () => {
			const registry = new RuleRegistry();

			try {
				registry.register('NotTheDeclaredName', castPastPairingCheck(CustomRule));
				expect.unreachable('expected a type-name-mismatch throw');
			} catch (error) {
				expect(error).toBeInstanceOf(RuleRegistryError);
				expect((error as RuleRegistryError).code).toBe('REGISTRY_TYPE_NAME_MISMATCH');
				expect((error as RuleRegistryError).message).toContain('CustomRule');
			}
		});

		it('throws REGISTRY_TYPE_NAME_MISMATCH for a subclass that never declared ruleTypeName', () => {
			const registry = new RuleRegistry();

			try {
				registry.register('ForgotTheStaticRule', castPastPairingCheck(ForgotTheStaticRule));
				expect.unreachable('expected a type-name-mismatch throw');
			} catch (error) {
				expect((error as RuleRegistryError).code).toBe('REGISTRY_TYPE_NAME_MISMATCH');
				// It reports the INHERITED base sentinel, which is the diagnostic that tells a
				// consumer they forgot the static rather than mistyped it.
				expect((error as RuleRegistryError).message).toContain("'FilterRule'");
			}
		});
	});

	describe('unregister', () => {
		it('returns true and removes a registered type', () => {
			const registry = new RuleRegistry();

			expect(registry.unregister('RangeRule')).toBe(true);
			expect(registry.has('RangeRule')).toBe(false);
		});

		it('returns false for a type that was never registered', () => {
			const registry = new RuleRegistry();

			expect(registry.unregister('NeverRegistered')).toBe(false);
		});

		it('allows re-registration after unregister', () => {
			const registry = new RuleRegistry();

			registry.unregister('RangeRule');
			expect(registry.has('RangeRule')).toBe(false);

			registry.register('RangeRule', RangeRule);

			expect(registry.get('RangeRule')).toBe(RangeRule);
		});
	});

	describe('get', () => {
		it('returns the registered rule class', () => {
			const registry = new RuleRegistry();

			expect(registry.get('RegexRule')).toBe(RegexRule);
		});

		it('throws REGISTRY_UNKNOWN_TYPE for an unregistered type', () => {
			const registry = new RuleRegistry();

			try {
				registry.get('NotARule');
				expect.unreachable('expected an unknown-type throw');
			} catch (error) {
				expect(error).toBeInstanceOf(RuleRegistryError);
				expect((error as RuleRegistryError).code).toBe('REGISTRY_UNKNOWN_TYPE');
			}
		});
	});

	describe('has', () => {
		it('reports presence and absence', () => {
			const registry = new RuleRegistry();

			expect(registry.has('ValueRule')).toBe(true);
			expect(registry.has('NotARule')).toBe(false);
		});
	});

	describe('iterator', () => {
		it('iterates over (typeName, ruleClass) entries', () => {
			const registry = new RuleRegistry();
			const entries = [...registry];

			expect(entries).toContainEqual(['RangeRule', RangeRule]);
			expect(entries.every(([name]) => typeof name === 'string')).toBe(true);
		});
	});

	describe('deserialize', () => {
		it('uses a per-class static deserialize hook (RegexRule rebuilds RegExp)', () => {
			const registry = new RuleRegistry();
			const serialized: SerializedRule = {
				config: { flags: 'i', source: '^CV1F' },
				field: 'sku',
				type: 'RegexRule',
			};
			const rule = registry.deserialize(serialized);

			expect(rule).toBeInstanceOf(RegexRule);
			const regexRule = rule as RegexRule;

			expect(regexRule.config.pattern).toBeInstanceOf(RegExp);
			expect(regexRule.config.pattern.source).toBe('^CV1F');
			expect(regexRule.config.pattern.flags).toBe('i');
			// The rebuilt rule actually filters.
			expect(rule.action({ sku: 'cv1f-9' }, rule)).toBe(true);
		});

		it('round-trips a RegexRule through serialize → deserialize', () => {
			const registry = new RuleRegistry();
			const original = new RegexRule('sku', { pattern: /^AB/u });
			const restored = registry.deserialize(original.serialize());

			expect(restored).toBeInstanceOf(RegexRule);
			expect(restored.action({ sku: 'ABC' }, restored)).toBe(true);
			expect(restored.action({ sku: 'XYZ' }, restored)).toBe(false);
		});

		it('uses a per-class static deserialize hook (DateRangeRule rebuilds Dates)', () => {
			const registry = new RuleRegistry();
			const original = new DateRangeRule('createdAt', {
				end: new Date('2025-12-31'),
				start: new Date('2025-01-01'),
			});
			const restored = registry.deserialize(original.serialize());

			expect(restored).toBeInstanceOf(DateRangeRule);
			const dateRule = restored as DateRangeRule;

			expect(dateRule.config.start).toBeInstanceOf(Date);
			expect(dateRule.config.end).toBeInstanceOf(Date);
			expect(restored.action({ createdAt: new Date('2025-06-15') }, restored)).toBe(true);
		});

		it('calls a static deserialize hook with the registered class as `this` (RangeRule)', () => {
			const registry = new RuleRegistry();
			const original = new RangeRule('price', { max: 20, min: 10 });
			const restored = registry.deserialize(original.serialize());

			expect(restored).toBeInstanceOf(RangeRule);
			expect(restored.config).toEqual({ max: 20, min: 10 });
			// `action` is a class-field arrow function — the hook must run the constructor for it to
			// exist.
			expect(restored.action({ price: 15 }, restored)).toBe(true);
			expect(restored.action({ price: 99 }, restored)).toBe(false);
		});

		it('uses the generic two-arg path for JSON-safe configs (TextSearchRule)', () => {
			const registry = new RuleRegistry();
			const restored = registry.deserialize(new TextSearchRule('title', { mode: 'substring', query: 'cab' }).serialize());

			expect(restored).toBeInstanceOf(TextSearchRule);
			expect(restored.config).toEqual({ mode: 'substring', query: 'cab' });
			expect(restored.action({ title: 'cabernet' }, restored)).toBe(true);
			expect(restored.action({ title: 'merlot' }, restored)).toBe(false);
		});

		it('round-trips a ValueRule through the generic path', () => {
			const registry = new RuleRegistry();
			const restored = registry.deserialize(new ValueRule('category', 'wine').serialize());

			expect(restored).toBeInstanceOf(ValueRule);
			expect(restored.config).toBe('wine');
			expect(restored.action({ category: 'wine' }, restored)).toBe(true);
		});

		it('uses the single-arg fallback when the two-arg constructor throws (a consumer rule)', () => {
			const registry = new RuleRegistry();

			registry.register('CustomRule', CustomRule);
			// The constructor spreads its second argument; the serialized `{ values: [...] }` object is
			// not iterable, so the two-argument call throws and the catch branch rebuilds the rule.
			const original = new CustomRule('varietal', ['pinot', 'merlot']);
			const restored = registry.deserialize(original.serialize());

			expect(restored).toBeInstanceOf(CustomRule);
			expect(restored.config).toEqual({ values: ['pinot', 'merlot']});
			expect(restored.action({ varietal: 'merlot' }, restored)).toBe(true);
			expect(restored.action({ varietal: 'syrah' }, restored)).toBe(false);
		});

		it('revives an InSetRule through its own hook', () => {
			const registry = new RuleRegistry();
			const original = new InSetRule<string>('varietal', ['pinot', 'merlot']);
			const restored = registry.deserialize(original.serialize());

			expect(restored).toBeInstanceOf(InSetRule);
			expect(restored.config).toEqual({ set: ['pinot', 'merlot']});
			expect(restored.action({ varietal: 'merlot' }, restored)).toBe(true);
			expect(restored.action({ varietal: 'syrah' }, restored)).toBe(false);
		});

		it('recursively rebuilds a nested CompositeRule tree (round-trip)', () => {
			const registry = new RuleRegistry();
			// (price in [10, 20]) AND (category === 'wine')
			const original = new CompositeRule('and', [
				new RangeRule('price', { max: 20, min: 10 }),
				new ValueRule('category', 'wine'),
			]);
			const restored = registry.deserialize(original.serialize());

			expect(restored).toBeInstanceOf(CompositeRule);
			// Children are revived as real instances with working `action`s, so the tree filters.
			expect(restored.action({ category: 'wine', price: 15 }, restored)).toBe(true);
			expect(restored.action({ category: 'wine', price: 99 }, restored)).toBe(false);
			expect(restored.action({ category: 'beer', price: 15 }, restored)).toBe(false);
		});

		it('normalizes the <function> field placeholder back to undefined', () => {
			const registry = new RuleRegistry();
			const serialized: SerializedRule = {
				config: 'wine',
				field: '<function>',
				type: 'ValueRule',
			};
			const restored = registry.deserialize(serialized);

			expect(restored.field).toBeUndefined();
			// With field undefined, the item itself is the value.
			expect(restored.action('wine', restored)).toBe(true);
		});

		it('throws REGISTRY_UNKNOWN_TYPE for an unregistered rule type', () => {
			const registry = new RuleRegistry();
			const serialized: SerializedRule = { config: {}, field: 'x', type: 'NopeRule' };

			expect(() => registry.deserialize(serialized)).toThrowError(RuleRegistryError);
		});
	});
});

describe('ruleRegistry singleton', () => {
	it('is a RuleRegistry pre-loaded with the built-in catalog', () => {
		expect(ruleRegistry).toBeInstanceOf(RuleRegistry);
		expect(ruleRegistry.has('ValueRule')).toBe(true);
		expect(ruleRegistry.has('CompositeRule')).toBe(true);
	});
});
