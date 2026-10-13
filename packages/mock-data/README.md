# @filter-enginez/mock-data

Three mock datasets at ~10,000 records each, plus MSW handlers that serve both the example apps in development and the
test suites. Isomorphic.

| Dataset     | Default tier | Full tier (opt-in) |
| ----------- | ------------ | ------------------ |
| Real estate | ~10,000      | ~50,000            |
| Wine        | ~10,000      | ~130,000           |
| Books       | ~10,000      | ~100,000           |

Every record this package ships is **synthetic**, produced by seeded procedural generators shaped by public reference
distributions. No third-party data is included. Generation scripts live in `scripts/`. Run `pnpm regen` for the default
tier and `pnpm regen --full` for the opt-in full tier (gitignored).

## Real wine data (optional, local only)

When you work in this repository, you can swap the synthetic wines for the real
[Kaggle "Wine Reviews"](https://www.kaggle.com/datasets/zynicide/wine-reviews) dataset (zackthoutt, scraped from
WineEnthusiast). It is licensed **CC BY-NC-SA 4.0**: attribution required, non-commercial use only, and adaptations
under the same license. The review text is WineEnthusiast's. That is why it is never committed, packaged, or deployed:

- `pnpm regen:wine:real --accept-data-license` downloads it to your machine. Without the flag the script prints the
  terms and stops.
- The output (`src/wine/data-real-*.json`) is gitignored, and the published package contains compiled code only.
- The example apps' production builds strip it, so anything deployed runs on synthetic data.

## Install

```bash
pnpm add @filter-enginez/mock-data
```

Peer dependencies: `@filter-enginez/core` (same release), `msw@^2.0.0` — supplied by your app.

Sub-exports: `@filter-enginez/mock-data/real-estate`, `@filter-enginez/mock-data/wine`,
`@filter-enginez/mock-data/books`, `@filter-enginez/mock-data/handlers`.

## Documentation

Consumer guides live in the engine repository under `docs/guides/`:

- `extending_rules.md` — writing a custom `FilterRule` that survives serialization
- `json_config.md` — declaring filters as data, and why the format is safe to accept from a tenant
- `acceleration_tuning.md` — what the five `acceleration` toggles are worth, measured
- `worker_offload.md` — running the engine in a Web Worker

Project home: <https://filter-enginez.com>

Apache-2.0. See `LICENSE.md` and `NOTICE.md`, both included in this package.
