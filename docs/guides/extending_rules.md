# Guide — Writing your own filter rule

> **Audience:** consumers of `@filter-enginez/core` whose domain needs a predicate the fifteen built-in rules do not
> express. Framework-agnostic — a rule is a plain class, and the engine never imports React.

---

## What a rule is

A rule is **inert data with a predicate attached.** It holds a `config`, it knows how to pull a value out of an item,
and it answers one question: does this item pass?

That is the whole contract. There is no lifecycle, no registration requirement for imperative use, and no engine
internals to learn — which is why adding a rule needs no changes to the engine.

```ts
import { type FieldExtractor, type FilterEngine, FilterRule, type FilterRuleAction } from '@filter-enginez/core';

declare const engine: FilterEngine<{ readonly tags: readonly string[] }>;

/** At least `minMatches` of `required` must be present. */
export interface MinTagMatchRuleConfig {
  readonly minMatches: number;
  readonly required: readonly string[];
}

export class MinTagMatchRule extends FilterRule {
  config: MinTagMatchRuleConfig;

  override action: FilterRuleAction = (item, rule): boolean => {
    const value = this.getFieldValue(item);

    if (!Array.isArray(value)) {
      return false;
    }
    const { minMatches, required } = (rule as MinTagMatchRule).config;
    const present = value as readonly unknown[];

    return required.filter((tag) => present.includes(tag)).length >= minMatches;
  };

  constructor(field: FieldExtractor, config: MinTagMatchRuleConfig) {
    super(field);
    this.config = config;
  }
}

engine.addRule('skills', new MinTagMatchRule('tags', { minMatches: 1, required: ['ts', 'rust'] }));
```

That rule works immediately. Everything below is about making it **survive a round trip**.

---

## The three members you implement

| Member                                  | Required          | Notes                                                                                             |
| --------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------- |
| `config`                                | yes               | Declared `abstract config: unknown` on the base. Type it however your rule needs                  |
| `action: FilterRuleAction`              | yes               | The predicate. Defaults to `() => true` on the base, so a rule that forgets it matches everything |
| `static override readonly ruleTypeName` | only to serialize | The stable wire name. See below — this one has a sharp edge                                       |

`field` comes from the constructor (`constructor(field?: FieldExtractor)`) and `protected getFieldValue(item)` resolves
it. A `FieldExtractor` is `undefined` (the item itself), a dotted path string, an array of paths tried in order, or a
function — so your rule does not need to know how the value is reached.

### Two conventions worth copying rather than reinventing

**Take `(field, config)` in that order.** `ruleRegistry.deserialize` calls `new YourRule(field, json.config)` on the way
back from the wire. A rule with a different parameter shape can still revive — the registry falls back to
`new YourRule(field)` and then overwrites `config` — but only if the one-argument call does not throw and the
constructor derives nothing from `config`. Several built-ins take their value or set directly (`ValueRule`,
`BooleanRule`, `InSetRule`, `InSetofSetsRule`, `BloomMembershipRule`) and revive through that fallback or their own
`static deserialize`; for a new rule the two-argument form costs nothing and removes the question.

**Read `config` off the `rule` parameter, not off `this`.** `FilterRuleAction` is
`(item: unknown, rule: FilterRule) => boolean`, and every built-in reads `(rule as RangeRule).config` from it. Use
`this` for `getFieldValue(item)` — it is `protected`, so there is no other way to reach it — and the parameter for
config. That is the shape the engine passes rules through, and following it keeps your rule's behavior identical to the
built-ins' under composition.

---

## `ruleTypeName` must be a declared literal, and the reason is not stylistic

To serialize, your class declares:

```ts
import { FilterRule } from '@filter-enginez/core';

export class MinTagMatchRule extends FilterRule {
  static override readonly ruleTypeName = 'MinTagMatchRule';

  // ...plus `config`, `action` and the constructor, exactly as in the first example.
  config: unknown;
}
```

**As a literal. Not annotated `: string`.** If you write `static override readonly ruleTypeName: string = '…'`, the
registration below will not compile.

The reason is minification. A minifier rewrites class identifiers while registry keys stay string literals, so a wire
name read from `this.constructor.name` would come out of a production build as `type: "d"` — a name no registry entry
matches, so shareable links, worker rehydration, JSON config and devtools persistence would fail to restore it, while
every unminified dev build kept working. Your consumers' bundlers do the minifying, so the name must not depend on class
identifiers at all.

So the wire name is **declared**, and the registry enforces that the declaration and the key agree:

```ts
import { FilterRule, ruleRegistry } from '@filter-enginez/core';

// RuleRegistry's signature:
//
//   register<RuleTypeName extends string>(
//     typeName: RuleTypeName,
//     ruleClass: { readonly ruleTypeName: NoInfer<RuleTypeName> } & RuleClass,
//   ): void;

class DeclaredRule extends FilterRule {
  static override readonly ruleTypeName = 'DeclaredRule';
  config = {};
}

class WidenedRule extends FilterRule {
  static override readonly ruleTypeName: string = 'WidenedRule';
  config = {};
}

ruleRegistry.register('DeclaredRule', DeclaredRule); // compiles
// @ts-expect-error -- `string` is not assignable to the literal 'WidenedRule'
ruleRegistry.register('WidenedRule', WidenedRule);
```

**`NoInfer` is the load-bearing part.** Without it TypeScript infers `RuleTypeName` from _both_ arguments, a class that
declared `ruleTypeName: string` contributes `string`, and the check silently accepts the exact case it exists to reject.
With it, the class side is a pure assignability check against the literal you passed.

The base declares `static readonly ruleTypeName: string = 'FilterRule'` — typed `string` on purpose, so that a subclass
which never declared its own inherits a value the check rejects.

---

## Registering

Registration is what lets a serialized rule be **revived** — by JSON config, URL state, the worker bridge and devtools
persistence. `serialize()` itself needs only `ruleTypeName`, and a rule used purely imperatively never needs either.

```ts
import { FilterRule, ruleRegistry } from '@filter-enginez/core';

declare class MinTagMatchRule extends FilterRule {
  static override readonly ruleTypeName = 'MinTagMatchRule';
  config: unknown;
}

ruleRegistry.register('MinTagMatchRule', MinTagMatchRule);
```

One registry serves all four transports, so one call covers all of them.

**Errors it throws** — all `RuleRegistryError`, with a machine-readable `code`:

| Code                          | When                                                                 |
| ----------------------------- | -------------------------------------------------------------------- |
| `REGISTRY_DUPLICATE`          | That type name is already registered                                 |
| `REGISTRY_TYPE_NAME_MISMATCH` | The class's `ruleTypeName` disagrees with the key (runtime backstop) |
| `REGISTRY_UNKNOWN_TYPE`       | `get()` / `deserialize()` asked for a name nobody registered         |

`RuleRegistryError` is a `FilterEngineRuleError`, which is a `FilterEngineError` — the engine's error hierarchy,
described in `architecture.md` §2.5. `instanceof` works at all three levels, `name` is `'RuleRegistryError'`, and `code`
is the thing to branch on.

**Register once, at module scope, next to the class.** If your bundler hot-reloads modules, guard it — the registry
throws on duplicates and an HMR re-evaluation is a second registration:

```ts
import { FilterRule, ruleRegistry } from '@filter-enginez/core';

declare class MinTagMatchRule extends FilterRule {
  static override readonly ruleTypeName = 'MinTagMatchRule';
  config: unknown;
}

if (!ruleRegistry.has('MinTagMatchRule')) {
  ruleRegistry.register('MinTagMatchRule', MinTagMatchRule);
}
```

`unregister(typeName)` returns `true` if something was removed, which is occasionally useful in tests.

---

## Serializing

The inherited `serialize()` emits `{ config, field, type }` and assumes `config` is JSON-safe. Override it when it is
not — a `RegExp`, a `Date`, a `Set`, a typed array (`RegexRule` is the in-tree precedent, with a
`RegexRuleSerializedConfig` distinct from its live config):

```ts
import { type FieldExtractor, FilterRule, type SerializedRule } from '@filter-enginez/core';

interface MyRuleConfig {
  readonly pattern: RegExp;
}

export class MyRule extends FilterRule {
  static override readonly ruleTypeName = 'MyRule';

  config: MyRuleConfig;

  constructor(field: FieldExtractor, config: MyRuleConfig) {
    super(field);
    this.config = config;
  }

  override serialize(): SerializedRule {
    const field = typeof this.field === 'function' ? '<function>' : this.field;

    return { config: { ...this.config, pattern: this.config.pattern.source }, field, type: MyRule.ruleTypeName };
  }

  /** The mirror. Checked for by name, so it must be `static deserialize`. */
  static deserialize(json: SerializedRule): MyRule {
    const raw = json.config as { pattern: string };

    return new MyRule(json.field, { ...raw, pattern: new RegExp(raw.pattern) });
  }
}
```

**Override `serialize()` and you want `static deserialize` too.** The registry checks for it by duck-typing before it
reaches the generic `new YourRule(field, config)` path, so the pair keeps the asymmetric transform in one file.
`RegexRule`, `DateRangeRule` and `BloomMembershipRule` are the three built-ins that do this; copy whichever is closest.
When a payload cannot be rebuilt, throw `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG`, passing the
underlying failure as `{ cause }` — that is what the built-ins do, so callers handle your rule's bad payload exactly
like theirs.

Three behaviors worth knowing:

- **`serialize()` throws if the class never declared `ruleTypeName`** — `FilterEngineRuleError`, code
  `RULE_TYPE_NAME_MISSING`. A wire `type` nothing could revive is refused at the source.
- **`getRuleTypeName(rule)` never throws.** It labels entries in devtools' action log, and a label must never take the
  log down.
- **A _function_ `field` does not round-trip.** `serialize()` writes the placeholder string `'<function>'`, and
  `deserialize` turns that back into `undefined` — which means "the item itself", not "the field you extracted". A rule
  that must survive a round trip takes a path string or an array of paths. Use a function extractor for rules you only
  ever construct imperatively.

**`PredicateRule.serialize()` always throws, by design** — `FilterEngineRuleError`, code `RULE_NOT_SERIALIZABLE`. Its
config is an opaque function, so there is nothing to write. If you reached for `PredicateRule` and then wanted a
shareable URL, the answer is to write a named registered subclass instead — which is exactly what this guide is for.

That property is also the **multi-tenant safety story**: because arbitrary functions cannot serialize, a config
submitted by a user can only name rule types you registered. Nothing is ever `eval`'d. See
[`json_config.md`](./json_config.md).

---

## A worked example in the examples repository

`ContainsAllRule` — "this array contains all of these values" — is implemented, registered and round-tripped through
every transport in `packages/examples-shared/src/real-estate/real-estate-domain/ContainsAllRule.ts`, in
[`filter-enginez-examples`](https://github.com/mlilli/filter-enginez-examples). It is about eighty lines including the
docblock, and it carries the HMR registration guard above.

---

## Checklist

- [ ] `extends FilterRule`, with a typed `config`
- [ ] `constructor(field: FieldExtractor, config: YourRuleConfig)` — that order
- [ ] `override action`, reading config off the `rule` parameter
- [ ] `static override readonly ruleTypeName = 'YourRule'` — **literal**, no `: string`
- [ ] `ruleRegistry.register('YourRule', YourRule)` if it must serialize
- [ ] `override serialize()` **and** `static deserialize()` if `config` is not JSON-safe
- [ ] A path-string `field`, not a function, for anything that must round-trip
- [ ] A round-trip test: `ruleRegistry.deserialize(rule.serialize())` produces an equivalent rule

That last one is cheap and catches the whole class of failure this guide exists for.
