# Filter EngineZ

> A generic, isomorphic, framework-agnostic TypeScript data filter engine — for filtering arbitrarily-complex data on
> arbitrarily-shaped datasets, anywhere JavaScript runs.

| Field       | Value                                                                                 |
| ----------- | ------------------------------------------------------------------------------------- |
| **Author**  | Michael Lilli                                                                         |
| **npm**     | [`@filter-enginez`](https://www.npmjs.com/org/filter-enginez) — 13 packages           |
| **License** | Apache-2.0 — see [`LICENSE.md`](./LICENSE.md) and [`NOTICE.md`](./NOTICE.md)          |
| **Home**    | [filterenginez.com](https://filterenginez.com)                                        |
| **Demos**   | [`mlilli/filter-enginez-examples`](https://github.com/mlilli/filter-enginez-examples) |

## What it is

Filter EngineZ is the engine behind the filter / facet / refinement panel of a data-driven app. You describe filters as
rules — in code or as JSON — and the engine evaluates them over your data, returns what passes, and tells subscribers
when that changes. The core has no framework and no browser dependency, so the same engine runs in a browser, in Node,
or in a Web Worker; small adapter packages lift it into signals or RxJS, and from there into React, Svelte, Vue, and
Angular.

- **Built-in rules** — range, set membership, numeric comparison, date range, text and fuzzy search, regex, geo
  proximity, hierarchy, and more — plus a contract for [writing your own](./docs/guides/extending_rules.md).
- **Boolean composition** — `and` / `or` / `not`, arbitrarily nested, applied with `engine.setExpression(...)`; or keep
  flat rules and group them with `engine.addGroup(...)` for "any of these" facets.
- **Filters as data** — [`loadConfig` / `exportConfig`](./docs/guides/json_config.md) round-trip a whole filter panel
  through validated JSON.
- **Acceleration** — Roaring Bitmaps for rule intersection, an R-tree for geo queries, Bayesian co-occurrence for
  suggested filters, and MinHash + LSH for "find similar items"; see
  [`acceleration_tuning.md`](./docs/guides/acceleration_tuning.md).
- **Exclusion-aware panels** — disable the options that would lead to zero results; see
  [`predictive_disable.md`](./docs/guides/predictive_disable.md).
- **Devtools** — action log, time travel, state diffing, replay, and a Redux DevTools bridge.

## Packages

This repository is a pnpm + Turborepo workspace holding the 13 packages that publish to npm. Each package README is the
page npm shows for it.

| Package                                                                     | What it is                                                                                     |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [`@filter-enginez/core`](./packages/core/README.md)                         | The engine: rules, composition, JSON config, devtools, acceleration. Isomorphic.               |
| [`@filter-enginez/reactive-signals`](./packages/reactive-signals/README.md) | Signals facade over the core `subscribe` API. Isomorphic.                                      |
| [`@filter-enginez/reactive-rxjs`](./packages/reactive-rxjs/README.md)       | RxJS Observable facade over the core `subscribe` API. Isomorphic.                              |
| [`@filter-enginez/react-signals`](./packages/react-signals/README.md)       | React hooks over `reactive-signals`.                                                           |
| [`@filter-enginez/react-rxjs`](./packages/react-rxjs/README.md)             | React hooks over `reactive-rxjs`.                                                              |
| [`@filter-enginez/svelte-signals`](./packages/svelte-signals/README.md)     | Svelte store bindings over `reactive-signals`.                                                 |
| [`@filter-enginez/vue-signals`](./packages/vue-signals/README.md)           | Vue 3 reactivity bindings over `reactive-signals`.                                             |
| [`@filter-enginez/angular-rxjs`](./packages/angular-rxjs/README.md)         | Angular dependency-injection bindings over `reactive-rxjs`.                                    |
| [`@filter-enginez/redux-bridge`](./packages/redux-bridge/README.md)         | Optional one-way Redux mirror (slice + middleware); the engine stays the source of truth.      |
| [`@filter-enginez/url-state-router`](./packages/url-state-router/README.md) | react-router URL serialization for filter state.                                               |
| [`@filter-enginez/worker-bridge`](./packages/worker-bridge/README.md)       | Opt-in Web Worker offload via Comlink.                                                         |
| [`@filter-enginez/eslint`](./packages/eslint/README.md)                     | ESLint plugin (isomorphic-boundary and mirror-mutation rules) plus shared flat-config presets. |
| [`@filter-enginez/mock-data`](./packages/mock-data/README.md)               | Three synthetic datasets (real estate, wine, books) plus MSW handlers.                         |

The private `benchmarks/` workspace (`pnpm bench`) measures the acceleration options and is never published.

## Install

```bash
pnpm add @filter-enginez/core
```

Add the binding for your stack alongside it — for example `@filter-enginez/react-signals` for React or
`@filter-enginez/angular-rxjs` for Angular. Each package README lists its peer dependencies.

## Usage

```ts
import { createFilterEngine, initializeBitmapAcceleration, InSetRule, RangeRule } from '@filter-enginez/core';

interface Wine {
  id: string;
  price: number;
  variety: string;
}

declare const wines: readonly Wine[];

// Await this once at startup. The Roaring-Bitmap path is WASM-backed and stays off until it resolves —
// silently, so skipping it costs speed rather than raising an error.
await initializeBitmapAcceleration();

const engine = createFilterEngine<Wine>({ sourceData: wines });

engine.addRule('price', new RangeRule('price', { min: 20, max: 60 }));
engine.addRule('variety', new InSetRule('variety', ['Merlot', 'Syrah']));

engine.getResults(); // every wine passing BOTH rules
engine.getResultCount(); // cheaper when you only need the number
```

Rules AND together. To OR the rules of one facet, name them in a group (`engine.addGroup({ id, filterIds })`); for any
other OR / NOT, compose with `and` / `or` / `not` and pass the result to `engine.setExpression(...)`.
[`docs/architecture.md`](./docs/architecture.md) has the full API and internals.

## The two repositories

| Repository                                                                     | Holds                                                      | Published |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------- | --------- |
| [`filter-enginez`](https://github.com/mlilli/filter-enginez) (this one)        | The 13 `@filter-enginez/*` packages, guides, architecture  | To npm    |
| [`filter-enginez-examples`](https://github.com/mlilli/filter-enginez-examples) | Six framework demo apps, shared UI packages, design system | Never     |

The examples consume this repository as packed tarballs from a sibling checkout, so clone both side by side:

```text
some-folder/
├── filter-enginez/
└── filter-enginez-examples/
```

After changing an engine package, run `bash scripts/pack-engine-tarballs.sh` here, then `pnpm install` in the examples
so they pick the change up. The examples README covers its side of that loop, including how its CI pins the engine
commit.

Both repositories were developed privately from May 2026; their public history begins with the first commit.

## Development

Node comes from [`.nvmrc`](./.nvmrc) (24.18 or newer) and pnpm from the `packageManager` field in `package.json` (via
`corepack enable`). `pnpm install` also installs the Git hooks: pre-commit runs typecheck, lint-staged, and the tests
for changed files; pre-push runs typecheck and the full coverage run.

```bash
pnpm typecheck        # tsc across every package and the tooling
pnpm lint             # ESLint, zero warnings allowed
pnpm lint:markdown    # markdownlint
pnpm prettier:check   # formatting
pnpm cspell           # spelling (American English)
pnpm test             # Vitest
pnpm test:coverage    # Vitest with the 100% coverage thresholds
pnpm build            # build all packages
pnpm size             # bundle-size budgets (after a build)
pnpm docs:api         # TypeDoc for the core API, into docs/api
```

CI ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)) runs the same gates on every pull request and push to
`main`. Releases go through [Changesets](./.changeset/README.md).

## Mock data and the optional real wine corpus

Everything `@filter-enginez/mock-data` ships is **synthetic**, produced by seeded generators. For local development you
can swap the synthetic wines for the real Kaggle "Wine Reviews" dataset:

```bash
pnpm --filter @filter-enginez/mock-data regen:wine:real --accept-data-license
```

That dataset is licensed **CC BY-NC-SA 4.0** (attribution, non-commercial, share-alike) and its review text belongs to
WineEnthusiast, so it stays on your machine: the output is gitignored, the pack script refuses a tarball that contains
it, and the example apps strip it from production builds. Without the flag the script prints the terms and stops. See
[`NOTICE.md`](./NOTICE.md) and the [`mock-data` README](./packages/mock-data/README.md) for the full terms.

## Documentation

- [`docs/architecture.md`](./docs/architecture.md) — class hierarchies, type signatures, data flow.
- [`docs/guides/`](./docs/guides/) — task-shaped how-tos: [extending rules](./docs/guides/extending_rules.md),
  [JSON config](./docs/guides/json_config.md), [acceleration tuning](./docs/guides/acceleration_tuning.md),
  [worker offload](./docs/guides/worker_offload.md), and [predictive disable](./docs/guides/predictive_disable.md).
- The brand and design system live in the examples repository, under
  [`docs/branding/design-system/`](https://github.com/mlilli/filter-enginez-examples/tree/main/docs/branding/design-system).

## Contributing and security

Issues are welcome. Pull requests are accepted from collaborators only; [`CONTRIBUTING.md`](./CONTRIBUTING.md) explains
the process and the coding standards. Report vulnerabilities privately as described in [`SECURITY.md`](./SECURITY.md),
never in a public issue. Participation is covered by the [code of conduct](./CODE_OF_CONDUCT.md).

## License

[Apache License 2.0](./LICENSE.md). [`NOTICE.md`](./NOTICE.md) carries the third-party attributions, the trademark terms
for the Filter EngineZ name and marks, and the terms of the optional wine dataset.

## Author

**Mike Lilli** — [@mlilli](mailto:mlilli@innov8ia.com)

### A personal note on open source

This is my first open-source contribution on GitHub — though not my first contribution to open source. Over the years
I've contributed to **DynAPI** and **YUI** (Yahoo! User Interface library), both well before GitHub became the de facto
home of open-source collaboration.

The reason it's taken until now — thirty-one years into a career writing software professionally — isn't that I didn't
want to. It's that every project I've built, owned, or had the latitude to release was either proprietary or wasn't, in
my own honest assessment, _worthy_. I hold a high bar for "worth giving away" and an even higher one for "worth
maintaining publicly under my name." Releasing the wrong thing creates noise. Releasing the right thing — and standing
behind it — is harder.

Filter EngineZ is the first project that's cleared my own bar. It's the distillation of patterns I've built and rebuilt
across many filter UIs, the implementation of architectural ideas I've wanted to try at full scope without a customer
deadline truncating them, and a chance to do the algorithm work (Roaring Bitmaps, MinHash + LSH, Bayesian co-occurrence,
R-tree spatial indexing) properly. If you find yourself reaching for it, it's because the bar mattered — to me, and now
hopefully to you.

---

_Filter EngineZ is the modernization of a legacy TypeScript + React + MobX filter engine I originally built for an
automotive online inventory search experience. The new engine is a generalized, framework-agnostic, isomorphic
reimagining of those patterns — inspired-by, not migrated-from._
