# @filter-enginez/core

The Filter EngineZ engine — rules, composition, devtools, internal store, action log, four named CS algorithms (Roaring
Bitmaps, R-tree, Bayesian co-occurrence, MinHash + LSH). Isomorphic: runs in browsers, Node, Cloudflare Workers, Deno,
edge runtimes.

## Install

```bash
pnpm add @filter-enginez/core
```

Sub-exports: `@filter-enginez/core/keyboard/browser`, `@filter-enginez/core/similarity`,
`@filter-enginez/core/storage/browser`, `@filter-enginez/core/suggestions`.

`similarity` and `suggestions` are separate entry points deliberately: importing them is opt-in, so not importing them
keeps their bytes out of your build.

## Quick start

```ts
import { createFilterEngine, initializeBitmapAcceleration, InSetRule, RangeRule } from '@filter-enginez/core';
import { type Wine, wines } from '@filter-enginez/mock-data/wine';

// Await this once at startup. The Roaring-Bitmap path is WASM-backed and stays OFF until it
// resolves — silently, so an app whose WASM asset is still in flight keeps working rather than
// throwing. Skipping it costs roughly 40x on a 10k corpus and raises no warning.
await initializeBitmapAcceleration();

const engine = createFilterEngine<Wine>({ sourceData: wines });

engine.addRule('price', new RangeRule('priceUsd', { min: 20, max: 60 }));
engine.addRule('varietal', new InSetRule('varietal', ['Merlot', 'Syrah']));

engine.getResults(); // every wine passing BOTH rules
engine.getResultCount(); // cheaper when you only need the number
```

Rules AND together. To OR the rules of one facet, name them in a group (`engine.addGroup({ id, filterIds })`); for any
other OR / NOT, compose with `and` / `or` / `not` and pass the result to `engine.setExpression(...)`. The bitmap path
serves conjunctions, so an expression or an `'or'` group is evaluated per item instead — the results are the same.

## Errors

Every error the engine raises is a `FilterEngineError` with a readonly, machine-readable `code`. Four subclasses name
the family — `FilterEngineConfigError` (a config document, option object or binding is invalid), `FilterEngineRuleError`
(a rule class or serialized rule is unusable; `RuleRegistryError` extends it), `FilterEngineModeError` (for example
`addRule()` while an expression is set) and `FilterEngineDestroyedError` (any method after `destroy()`). A wrapped
failure is the standard `cause`. The code unions are exported too (`FilterEngineErrorCode` and one per class), so a
`switch` over `error.code` is checked for exhaustiveness.

```ts
import { createFilterEngine, type FilterEngineConfig, FilterEngineError } from '@filter-enginez/core';

declare const sharedConfig: FilterEngineConfig;

const engine = createFilterEngine({ sourceData: [] });

try {
  engine.loadConfig(sharedConfig);
} catch (error) {
  if (!(error instanceof FilterEngineError)) {
    throw error;
  }
  console.warn(`Ignoring a config the engine refused: ${error.code}`, error.cause);
}
```

The full code table, and when each is thrown, is in `docs/architecture.md` §2.5 of the engine repository.

## Documentation

Consumer guides live in the engine repository under `docs/guides/`:

- `extending_rules.md` — writing a custom `FilterRule` that survives serialization
- `json_config.md` — declaring filters as data, and why the format is safe to accept from a tenant
- `acceleration_tuning.md` — what the five `acceleration` toggles are worth, measured
- `worker_offload.md` — running the engine in a Web Worker

Project home, with six live demos: <https://filterenginez.com>. Documentation site: <https://docs.filterenginez.com>.

Apache-2.0. See `LICENSE.md` and `NOTICE.md`, both included in this package.
