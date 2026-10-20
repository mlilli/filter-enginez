# Guide — JSON config: declaring filters as data

> **Audience:** consumers who need filters defined somewhere other than their source code — a database row, a tenant
> admin screen, a config file, a saved view. The engine's config format is plain JSON, so "the filter UI is a function
> of the data" is something you can build rather than something you have to fork the engine for.

---

## The shape

A `FilterEngineConfig` is a version stamp, a list of rules keyed by id, and three optional extras:

```jsonc
{
  "version": 1,
  "label": "fiction · published 2000–2025", // optional, for devtools and debugging
  "rules": [
    { "id": "genre", "rule": { "config": { "set": ["fiction"] }, "field": "genre", "type": "InSetRule" } },
    {
      "id": "publication-year",
      "rule": { "config": { "max": 2025, "min": 2000 }, "field": "publicationYear", "type": "RangeRule" },
    },
  ],
}
```

That file is real — it is `packages/examples-server/sample-configs/books.json` in
[`filter-enginez-examples`](https://github.com/mlilli/filter-enginez-examples), and `@filter-enginez/examples-server`
filters a dataset with it from a plain Node process, no browser and no framework involved.

Each `rule` entry is a `SerializedRule`: `{ config, field, type }`.

- **`type`** names a class the registry knows. The 15 built-ins are registered for you; your own rules need
  `ruleRegistry.register` — see [`extending_rules.md`](./extending_rules.md).
- **`field`** is a dotted path (`'author.name'`), an array of paths tried in order, or omitted for "the item itself". It
  cannot be a function: a function extractor serializes to the placeholder `'<function>'` and revives as `undefined`,
  which silently means "the whole item".
- **`config`** is whatever that rule type's config interface says — `{ min, max }` for `RangeRule`, `{ set }` for
  `InSetRule`, and so on. The rule's own docblock is the reference.
- **`inline`**, on the entry beside `id` and `rule`, marks a rule that exists only inside `expression`. See
  [Inline rules](#inline-rules) below.

Options travel inside `config` like everything else. `InSetRule`, `InSetofSetsRule` and `HierarchicalRule` take
`arrayMatch` (`"any"` or `"all"`) for array-valued fields, and `FuzzySearchRule` takes Fuse.js options beside its query:

```json
{
  "id": "pay",
  "rule": { "config": { "arrayMatch": "all", "set": ["card", "cash"] }, "field": "payment", "type": "InSetRule" }
}
```

```json
{
  "id": "search",
  "rule": {
    "config": { "ignoreLocation": true, "keys": ["name", "winery"], "minMatchCharLength": 2, "query": "cabernay" },
    "type": "FuzzySearchRule"
  }
}
```

`CURRENT_CONFIG_VERSION` is `1`.

### Open bounds are `null`

JSON has no `Infinity`, `-Infinity` or `NaN`; `JSON.stringify` writes each of them as `null`. So "no upper limit" is
written like this, whether you write it by hand or it comes out of `exportConfig` and a `JSON.stringify`:

```jsonc
{ "id": "price", "rule": { "config": { "max": null, "min": 60 }, "field": "priceUsd", "type": "RangeRule" } }
```

Each rule with a numeric bound reads `null` as the open bound for that position:

| Rule                    | Key                     | `null` loads as                                                     |
| ----------------------- | ----------------------- | ------------------------------------------------------------------- |
| `RangeRule`             | `min` / `max`           | `-Infinity` / `Infinity`                                            |
| `NumericComparisonRule` | `value`                 | `Infinity` under `<`, `<=`, `==`, `!=`; `-Infinity` under `>`, `>=` |
| `GeoProximityRule`      | `radiusKm`              | `Infinity` (no radius limit)                                        |
| `FuzzySearchRule`       | `threshold`, `distance` | `Infinity` (no limit)                                               |
| `DateRangeRule`         | `start` / `end`         | no bound on that side                                               |

That is what lets an open range survive every JSON path — `exportConfig` → `loadConfig`, a `url-state-router` link, a
saved view, a request body — with the same matches it had before. Two consequences of `null` standing for "open":

- **A bound on the wrong side does not survive JSON.** `{ min: Infinity }` (a range that is empty whatever its `max`)
  and a `NaN` bound are both written as `null`, and load as the open bound for their position.
- **Equality values stay values.** `ValueRule`, `InSetRule` and `InSetofSetsRule` compare their configured values as
  written, so a `null` there means the value `null`, and an infinite equality value cannot be written to JSON at all.

---

## The three functions

```ts
import { exportConfig, type FilterEngine, loadConfig, resolveConfig } from '@filter-enginez/core';

declare const engine: FilterEngine;
declare const rawConfig: Record<string, unknown>; // parsed JSON from wherever you keep it

loadConfig(engine, rawConfig); // apply a config to an engine
const parts = resolveConfig(rawConfig); // build the pieces, apply nothing
const json = exportConfig(engine); // read the engine back out as a config
```

### `loadConfig(engine, rawConfig, options?)`

Deserializes every rule, rebuilds any groups and expression, and applies the lot.

**It clears existing rules first, by default.** The option is `clearExisting`, and it is checked as
`options.clearExisting !== false` — so `undefined` clears. Pass `clearExisting: false` explicitly to layer a config on
top of rules the engine already holds.

`options.registry` substitutes a `RuleRegistry` other than the shared singleton. That is the per-tenant isolation seam:
a registry built for one tenant cannot revive a rule type another tenant registered.

The first parameter is typed structurally (`LoadConfigEngineTarget` — `addGroup`, `addRule`, `clearRules`,
`setExpression`), not as the concrete engine class. A test double or an engine wrapper satisfies it without casting.

### `resolveConfig(rawConfig, options?)`

The same work, stopping one step short: returns `{ expression, groups, rules }` with `rules` as a
`ReadonlyMap<string, FilterRule>`. Reach for it to **validate a config without mutating anything** — a tenant-submitted
config can be resolved in a `try`/`catch` and rejected before any engine sees it.

### `exportConfig(engine, options?)`

The inverse, taking `{ label?, metadata? }`. Omits `groups`, `expression`, `label` and `metadata` entirely when there is
nothing to write, so a minimal engine exports a minimal config.

**It can throw, and the throw comes from a rule, not from the exporter.** `exportConfig` calls `serialize()` on every
registered rule, so one rule that cannot serialize fails the whole export with a `FilterEngineRuleError` — a
`PredicateRule` always will, by design (`RULE_NOT_SERIALIZABLE`), and so will any custom rule that never declared
`ruleTypeName` (`RULE_TYPE_NAME_MISSING`). If an engine must stay exportable, keep predicates out of it.

### Inline rules

A rule that appears **only** inside the expression tree and was never registered by id still exports. It gets a
synthetic id, `__inline_0`, `__inline_1` and so on (one per distinct rule, skipping any id a registered rule holds), and
its entry in `rules` is marked `"inline": true`:

```json
{
  "expression": {
    "children": [
      { "ruleId": "__inline_0", "type": "rule" },
      { "ruleId": "__inline_1", "type": "rule" }
    ],
    "op": "or",
    "type": "composite"
  },
  "rules": [
    {
      "id": "__inline_0",
      "inline": true,
      "rule": { "config": "pinot noir", "field": "varietal", "type": "ValueRule" }
    },
    { "id": "__inline_1", "inline": true, "rule": { "config": "pinot gris", "field": "varietal", "type": "ValueRule" } }
  ],
  "version": 1
}
```

`loadConfig` revives an inline entry so the expression can reference it, and does not register it. The loaded engine
holds the registered rules the exported one held and nothing more, so clearing the expression with `setExpression(null)`
leaves the same rules filtering on both. The `__inline_<n>` id form is reserved: an entry with such an id that the
expression references is read as inline even without the mark.

---

## A config is a filter STATE, not a filter SCHEMA

It is tempting to read a config as "here are the filters this dataset offers" — a schema the UI renders as an empty
panel. It is not. **Every rule in a config is an active rule.** Load it, and the engine applies it.

For most rule types that distinction is harmless, because the config has a neutral value: `InSetRule` with an empty set
returns `true` before it even reads the field, and `RangeRule` with `{ min: -Infinity, max: Infinity }` admits every
item whose field holds a number. For two it is not:

- **`ExistsRule`** declares `config: undefined = undefined`. Its presence _is_ its activation; there is no "off" value
  to write. A config containing an `ExistsRule` boots with that filter on.
- **`RangeRule` over a nullable field** has to pick two numbers. There is no way to say "no bound chosen yet" — and
  `-Infinity`/`Infinity` is not the same thing as "the user hasn't touched this slider", if your UI needs to tell those
  apart.

So if you are driving a filter **panel** from data, keep two artifacts: a description of the available controls and a
`FilterEngineConfig` carrying the current selection. The examples repository's
`examples-shared/src/books/config-driven/` does exactly that — `controlRegistry.tsx` maps each rule `type` to the
control that renders it, and `vocabularies.ts` derives chip options and slider extents from the corpus — while the
config supplies only the state. Conflating the two produces an app that boots with filters applied and no obvious reason
why.

---

## Groups and expressions

`groups` is facet grouping: `{ id, displayName?, filterIds, composition? }`, where `composition` defaults to `'or'` —
the facet-panel convention, since checking two genres in one facet almost always means "either". Groups filter: the
rules a group names combine with its `composition`, and groups AND with each other and with every rule no group names.
Ids a group names but `rules` lacks are skipped. An `expression`, when present, replaces the group composition.

`expression` is a Boolean tree over rule **ids**, so a rule is declared once and referenced wherever it appears:

```jsonc
{
  "expression": {
    "type": "composite",
    "op": "and",
    "children": [
      { "type": "rule", "ruleId": "genre" },
      { "type": "composite", "op": "not", "children": [{ "type": "rule", "ruleId": "out-of-print" }] },
    ],
  },
}
```

`op` is `'and'`, `'or'` or `'not'`. A leaf referencing an id that is not in `rules` throws `FilterEngineConfigError`
with code `CONFIG_UNKNOWN_RULE_ID`, naming the id — a loud failure rather than a filter that quietly matches everything.
A single leaf at the top level is wrapped in `and(...)` for type uniformity.

---

## Why this is safe to accept from a tenant

The format has no code in it. `config` is data, `field` is a path, and `type` is a lookup key in a registry **you**
populated. Nothing is ever `eval`'d, and there is no rule type whose config is a function that survives serialization —
`PredicateRule.serialize()` throwing is what closes that door.

So the trust boundary is the registry, and it is small enough to reason about:

| Hostile input                 | What happens                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| A `type` you never registered | `RuleRegistryError` with code `REGISTRY_UNKNOWN_TYPE`                                                   |
| A `field` path that is absent | Resolves to `undefined`; the rule decides (built-ins fail the item, except at a neutral config)         |
| A malformed `config`          | The rule's own `action` sees it — validate per type if you accept it raw                                |
| A malformed revival payload   | `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG` (`RegexRule`, `BloomMembershipRule`) |
| A bound that is not a number  | `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG`, naming the rule type and the key    |
| An expression citing a bad id | `FilterEngineConfigError` with code `CONFIG_UNKNOWN_RULE_ID`, naming the `ruleId`                       |
| A version from the future     | `FilterEngineConfigError` with code `CONFIG_VERSION_UNSUPPORTED`                                        |

That last column is why `resolveConfig` exists: run an untrusted config through it first, catch, reject. Every row that
throws throws a `FilterEngineError`, so one `instanceof` check separates a bad document from a bug in your own code.

**Beyond the bounds and options, `config` payloads are not validated by the engine.** `config` is typed `unknown` on the
base class and the rule casts it. The rules with numeric bounds (`RangeRule`, `NumericComparisonRule`,
`GeoProximityRule`, `FuzzySearchRule`, `DateRangeRule`) check each bound as they revive it, accepting a number or `null`
and rejecting anything else, so a string or a missing key never compares as `0`. `FuzzySearchRule` also checks its other
Fuse options (a finite number, a boolean, or `"all"` / `"any"` for `tokenMatch`), and `InSetRule`, `InSetofSetsRule` and
`HierarchicalRule` check `arrayMatch` (`"any"` or `"all"`). Nothing else is checked. If configs arrive from outside your
own code, validate them against the rule types you allow — a schema validator at the edge, or a hand-written allowlist.

---

## Versioning

`ConfigMigrator` holds steps keyed by the version they migrate **from**:

```ts
import { ConfigMigrator, defaultMigrator } from '@filter-enginez/core';

defaultMigrator.register(1, (priorConfig) => ({ ...priorConfig, version: 2 }));
```

`migrate(rawConfig)` walks from the config's version to `CURRENT_CONFIG_VERSION`, applying one step per hop, and stamps
the final version itself in case a step forgot. `loadConfig` and `resolveConfig` call it automatically for anything
whose `version` is not already current; `options.migrator` substitutes your own instance.

Two behaviors to know:

- **A config with no `version` is treated as `1`.** At `CURRENT_CONFIG_VERSION = 1` it loads with no migration. Write
  the version anyway: an unstamped document is always read as version 1, whichever version actually wrote it.
- **A missing step throws, and so does a config from the future** — both `FilterEngineConfigError`, with codes
  `CONFIG_MIGRATION_MISSING` and `CONFIG_VERSION_UNSUPPORTED`. A gap in the chain names the hop and the
  `register(v, step)` call that would close it; a `version` higher than the engine supports says to upgrade
  `@filter-enginez/core` rather than guessing. Both are deliberate — a silently skipped migration produces rules that
  look fine and filter wrongly.

---

## Round-tripping

The property worth asserting in your own test suite:

```ts
import { exportConfig, type FilterEngine, type FilterEngineConfig, loadConfig } from '@filter-enginez/core';

declare const expect: (actual: unknown) => { toEqual(expected: unknown): void }; // your test runner's
declare const engine: FilterEngine;
declare const original: FilterEngineConfig;

loadConfig(engine, original);
expect(exportConfig(engine, { label: original.label })).toEqual(original);
```

`label` and `metadata` come back from `exportConfig`'s options rather than from the engine — the engine never stored
them — so pass them back in or compare without them.

Beyond that it holds for the format itself, with two lossy cases — a function `field` (written as `'<function>'`) and a
`PredicateRule` (which cannot be exported at all) — and four normalizations a deep-equality check will notice: a group
that omitted `composition` comes back with `'or'`, a lone-leaf expression comes back wrapped in `and`, an unstamped
document comes back as version 1, and an unmarked `__inline_{n}` entry the expression references comes back marked
`"inline": true`. Write your configs in the normalized form and the check is exact; this is the two-line test that tells
you before a shareable link does.

Run the check on the parsed JSON rather than on the object `exportConfig` returned when your rules hold open bounds:
`JSON.stringify` turns their infinities into `null`, so compare what the engine matches before and after the trip (its
result indices), which `null` keeps, rather than the documents themselves.
