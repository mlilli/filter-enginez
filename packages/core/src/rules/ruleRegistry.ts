/**
 * `RuleRegistry` — central type-name → rule-class registry.
 *
 * @remarks
 * The Registry pattern (Fowler) — maps rule-type names (strings) to rule classes (constructors).
 * Built-in rules auto-register at module load. Consumers register custom subclasses to
 * participate in:
 *
 *   - JSON config loading (`engine.loadConfig(...)`)
 *   - URL-state round-trip (`@filter-enginez/url-state-router`)
 *   - Worker-bridge serialization (`@filter-enginez/worker-bridge`)
 *   - Devtools snapshot persistence (cross-reload time-travel)
 *
 * One infrastructure, four use cases. This is the central serialization plane of the engine.
 *
 * The module-level `ruleRegistry` is a singleton (one of the only singletons in the codebase,
 * per `docs/architecture.md` §18 — justified because it's a *type* registry with no per-instance
 * state, not a *state* singleton).
 *
 * @packageDocumentation
 */

import type { SerializedRule } from '../types.js';

import { defineErrorName, FilterEngineRuleError, type FilterEngineRuleErrorCode } from '../errors/index.js';
import { BloomMembershipRule } from './BloomMembershipRule.js';
import { BooleanRule } from './BooleanRule.js';
import { CompositeRule, type CompositionOp } from './CompositeRule.js';
import { DateRangeRule } from './DateRangeRule.js';
import { ExistsRule } from './ExistsRule.js';
import { type FilterRule } from './FilterRule.js';
import { FuzzySearchRule } from './FuzzySearchRule.js';
import { GeoProximityRule } from './GeoProximityRule.js';
import { HierarchicalRule } from './HierarchicalRule.js';
import { InSetofSetsRule } from './InSetofSetsRule.js';
import { InSetRule } from './InSetRule.js';
import { NumericComparisonRule } from './NumericComparisonRule.js';
import { PredicateRule } from './PredicateRule.js';
import { RangeRule } from './RangeRule.js';
import { RegexRule } from './RegexRule.js';
import { TextSearchRule } from './TextSearchRule.js';
import { ValueRule } from './ValueRule.js';

/**
 * The shape of a rule class — a constructor accepting any arguments and returning a
 * `FilterRule` instance.
 */

export type RuleClass = new (...args: any[]) => FilterRule;

/**
 * The machine-readable failure modes of {@link RuleRegistry} — the `REGISTRY_*` subset of
 * {@link FilterEngineRuleErrorCode}, derived from it so the two can never disagree.
 */
export type RuleRegistryErrorCode = Extract<FilterEngineRuleErrorCode, `REGISTRY_${string}`>;

/**
 * Error thrown when the registry encounters an unknown rule type, a duplicate registration, or a
 * class whose `ruleTypeName` disagrees with the name it is being registered under.
 *
 * @remarks
 * A {@link FilterEngineRuleError}, so `catch (e) { if (e instanceof FilterEngineError) … }` covers
 * registry failures too, while existing `instanceof RuleRegistryError` checks and `code`
 * comparisons keep working unchanged.
 */
export class RuleRegistryError extends FilterEngineRuleError {
	declare readonly code: RuleRegistryErrorCode;

	static {
		defineErrorName(this, 'RuleRegistryError');
	}

	/**
	 * @param code - One of {@link RuleRegistryErrorCode}
	 * @param message - Human-readable explanation, including how to fix it
	 * @param options - Standard `Error` options; pass `{ cause }` when wrapping another failure
	 */
	// eslint-disable-next-line @typescript-eslint/no-useless-constructor -- narrows `code` at construction; the base accepts every rule code
	constructor(code: RuleRegistryErrorCode, message: string, options?: ErrorOptions) {
		super(code, message, options);
	}
}

// #region docs:register
/**
 * Registry mapping type names to rule classes.
 */
export class RuleRegistry {
	private readonly _entries = new Map<string, RuleClass>();

	constructor() {
		this._registerBuiltins();
	}

	/**
	 * Register a custom rule class under a type name.
	 *
	 * @remarks
	 * **`typeName` and `ruleClass.ruleTypeName` must agree, and the signature enforces it.** The
	 * generic parameter binds the two: a class declaring `static override readonly ruleTypeName =
	 * 'ContainsAllRule'` has the literal type `'ContainsAllRule'`, so registering it under any
	 * other name is a **compile-time** error, and a subclass that forgot to declare the static
	 * inherits the base's `string` — which is not assignable to the literal, so that is a
	 * compile-time error too.
	 *
	 * **`NoInfer` is load-bearing, not decoration.** Without it TypeScript infers `RuleTypeName`
	 * from BOTH arguments, so a class that never declared the static contributes its inherited
	 * `string`, the parameter resolves to `string`, and every name argument satisfies it — the
	 * check silently accepts exactly the case it exists to reject. Pinning inference to `typeName`
	 * makes the class side a pure assignability check against the literal.
	 *
	 * The runtime check below covers what the type system cannot reach: JavaScript consumers, and
	 * TypeScript consumers who cast. It exists because the failure it guards is otherwise silent
	 * until a production build — see `./ruleTypeName.ts`.
	 *
	 * @param typeName - The wire name; must equal `ruleClass.ruleTypeName`
	 * @param ruleClass - The rule class to revive under that name
	 * @throws `RuleRegistryError` with code `REGISTRY_DUPLICATE` if already registered
	 * @throws `RuleRegistryError` with code `REGISTRY_TYPE_NAME_MISMATCH` if the class's declared
	 *   `ruleTypeName` is not `typeName`
	 */
	register<RuleTypeName extends string>(
		typeName: RuleTypeName,
		ruleClass: { readonly ruleTypeName: NoInfer<RuleTypeName> } & RuleClass,
	): void {
		if (this._entries.has(typeName)) {
			throw new RuleRegistryError(
				'REGISTRY_DUPLICATE',
				`Rule type '${typeName}' is already registered. Use a different type name or call unregister() first.`,
			);
		}
		if (ruleClass.ruleTypeName !== typeName) {
			throw new RuleRegistryError(
				'REGISTRY_TYPE_NAME_MISMATCH',
				`Rule class declares ruleTypeName '${String(ruleClass.ruleTypeName)}' but is being registered as `
				+ `'${typeName}'. These must match: serialize() writes the class's ruleTypeName, and deserialize() `
				+ `looks up the registry key, so a mismatch means rules serialize into a form nothing can revive.`,
			);
		}
		this._entries.set(typeName, ruleClass);
	}
	// #endregion docs:register

	/**
	 * Remove a registered rule class.
	 *
	 * @returns `true` if the type was registered (and is now removed), `false` if it wasn't
	 */
	unregister(typeName: string): boolean {
		return this._entries.delete(typeName);
	}

	/**
	 * Look up a rule class by type name.
	 *
	 * @throws `RuleRegistryError` with code `REGISTRY_UNKNOWN_TYPE` if not registered
	 */
	get(typeName: string): RuleClass {
		const ruleClass = this._entries.get(typeName);

		if (!ruleClass) {
			throw new RuleRegistryError(
				'REGISTRY_UNKNOWN_TYPE',
				`Unknown rule type: '${typeName}'. Did you forget to register it? See @filter-enginez/core's ruleRegistry.register().`,
			);
		}

		return ruleClass;
	}

	/** Check whether a type name is registered. */
	has(typeName: string): boolean {
		return this._entries.has(typeName);
	}

	/** Iterate over registered (typeName, ruleClass) entries. */
	[Symbol.iterator](): IterableIterator<[string, RuleClass]> {
		return this._entries.entries();
	}

	// #region docs:deserialize
	/**
	 * Reconstruct a rule instance from its serialized form.
	 *
	 * **Three paths, checked in this order:**
	 *
	 *   1. **`CompositeRule`** — rebuilt by `_deserializeComposite`, which deserializes each
	 *      nested child through the registry first (the generic path would leave a composite's
	 *      `config.rules` as plain objects with no `action`).
	 *   2. **Per-class `static deserialize(json)` hook** — when present on the rule class, it's
	 *      called and the result returned. Used by rules with non-JSON-safe config values:
	 *      `RegexRule` (rebuild `RegExp` from `{ source, flags }`), `DateRangeRule` (rebuild
	 *      `Date` instances from ISO strings). Custom subclasses can opt into this same hook
	 *      pattern by adding their own static `deserialize` method.
	 *   3. **Generic path** — fallback for rules whose config is already JSON-safe (most of the
	 *      built-in catalog). Constructs the instance via `new ruleClass(field, config)` so
	 *      class-field initializers (most importantly `action`) actually run, then overwrites
	 *      `config` with the serialized payload to handle constructors that transform their
	 *      input (e.g., `InSetRule` wraps `initialSet` in `{ set: [...initialSet] }`). A
	 *      try/catch around the two-arg call covers rules whose second-arg shape is
	 *      structurally incompatible with the serialized config (`InSetRule`'s `initialSet`
	 *      expects an iterable, not an object); for those we fall back to single-arg
	 *      construction and rely entirely on the post-construct config assignment.
	 *
	 * **Why the generic path constructs rather than using `Object.create`.**
	 * `Object.create(ruleClass.prototype)` would give the correct prototype chain but no
	 * instance fields — and `action` is declared as a class-field arrow function
	 * (`override action: FilterRuleAction = (item, rule) => {...}`), not a prototype method, so
	 * the instance would have `action === undefined`. Invoking the constructor runs the field
	 * initializers; the overwriting `config` assignment handles constructors that transform
	 * their input.
	 *
	 * @throws `RuleRegistryError` if the type is not registered
	 */
	deserialize(json: SerializedRule): FilterRule {
		const ruleClass = this.get(json.type);

		// Composite rules carry their children as nested `SerializedRule` objects (see
		// `CompositeRule.serialize`), not live instances. Rebuild each child through the registry
		// before constructing the parent — the generic path below only reconstructs the top-level
		// rule and would leave a composite's `config.rules` as plain objects with no `action`.
		if (ruleClass === CompositeRule) {
			return this._deserializeComposite(json);
		}

		// Per-class custom hook — checked via duck-typing for a `static deserialize` method.
		const customDeserialize = (ruleClass as unknown as {
			deserialize?: (json: SerializedRule) => FilterRule;
		}).deserialize;

		if (typeof customDeserialize === 'function') {
			return customDeserialize(json);
		}

		const field = json.field === '<function>' ? undefined : (json.field);
		const RuleClassCtor = ruleClass;

		let instance: FilterRule;

		try {
			// Common path — every built-in rule whose constructor accepts (field, config)
			// directly: RangeRule, BooleanRule, TextSearchRule, FuzzySearchRule,
			// NumericComparisonRule, HierarchicalRule, GeoProximityRule, etc.

			instance = new RuleClassCtor(field, json.config);
		} catch {
			// Fallback — rules whose second constructor arg is structurally incompatible with
			// the serialized config (notably `InSetRule(field, initialSet: readonly V[])`,
			// which spreads its second arg as an iterable — passing `{ set: [...] }` throws
			// "object is not iterable"). Single-arg construction + post-construct config
			// assignment is correct for these.

			instance = new RuleClassCtor(field);
		}
		// Always overwrite config with the serialized payload — covers both the
		// constructor-transformed cases (InSetRule wrapping the array) AND any mismatch between
		// "what the constructor accepts" vs "what serialize() writes back out." Without this
		// assignment, the engine would see the constructor's default config, not the
		// consumer's intent.
		(instance as { config: unknown }).config = json.config;

		return instance;
	}
	// #endregion docs:deserialize

	/**
	 * Reconstruct a `CompositeRule` by recursively deserializing its child rules — the mirror of
	 * `CompositeRule.serialize`'s recursive descent, so an arbitrarily-nested Boolean expression
	 * round-trips through a `structuredClone` boundary with every leaf revived as a real instance
	 * (functioning `action`s and all).
	 *
	 * @internal
	 */
	private _deserializeComposite(json: SerializedRule): CompositeRule {
		const config = json.config as {
			readonly op: CompositionOp;
			readonly rules: readonly SerializedRule[];
		};
		const rules = config.rules.map((child) => this.deserialize(child));

		return new CompositeRule(config.op, rules);
	}

	/**
	 * Register all built-in rule classes.
	 *
	 * @internal
	 */
	private _registerBuiltins(): void {
		this.register('ValueRule', ValueRule);
		this.register('BooleanRule', BooleanRule);
		this.register('RangeRule', RangeRule);
		this.register('NumericComparisonRule', NumericComparisonRule);
		this.register('InSetRule', InSetRule);
		this.register('InSetofSetsRule', InSetofSetsRule);
		this.register('BloomMembershipRule', BloomMembershipRule);
		this.register('TextSearchRule', TextSearchRule);
		this.register('FuzzySearchRule', FuzzySearchRule);
		this.register('RegexRule', RegexRule);
		this.register('DateRangeRule', DateRangeRule);
		this.register('HierarchicalRule', HierarchicalRule);
		this.register('GeoProximityRule', GeoProximityRule);
		this.register('ExistsRule', ExistsRule);
		this.register('PredicateRule', PredicateRule);
		this.register('CompositeRule', CompositeRule);
	}
}

/**
 * The shared module-level registry singleton. Use this in application code.
 *
 * @example
 *   import { ruleRegistry } from '@filter-enginez/core';
 *   import { MinTagMatchRule } from './custom-rules';
 *
 *   ruleRegistry.register('MinTagMatchRule', MinTagMatchRule);
 */
export const ruleRegistry = new RuleRegistry();
