# @filter-enginez/mock-data

Three mock datasets at ~10,000 records each, plus MSW handlers that serve both the example apps in development and the
test suites. Isomorphic.

| Dataset     | Default tier | Full tier (opt-in)                   |
| ----------- | ------------ | ------------------------------------ |
| Real estate | ~10,000      | ~50,000                              |
| Wine        | 10,000       | 150,000, generated on demand in ~1 s |
| Books       | ~10,000      | ~100,000                             |

Every record this package ships is **synthetic**, produced by seeded procedural generators shaped by public reference
distributions. No third-party data is included. Generation scripts live in `scripts/`. Run `pnpm regen` to validate the
default tier and `pnpm regen --full` to write the real-estate and books full tiers (gitignored). The wine full tier
needs no file: it is generated where it is used, including inside a browser Web Worker.

## Wine

The wine generator samples **aggregate statistics** measured from the Kaggle "Wine Reviews" dataset (129,907 reviews),
never its records: no review text, wine title, winery name or taster name is included. What it reproduces:

- **Origin and varietal, jointly.** All 1,619 country → province → region → subregion leaves, all 701 varietals and the
  9,663 pairings between them, at their measured shares: Napa Valley is mostly Cabernet Sauvignon, Barolo is Nebbiolo,
  Champagne is sparkling. At full-tier size every leaf, varietal and pairing appears, the rarest at least once.
- **Scores and prices.** The measured 80–100 point histogram and price-by-score curve, with each country's and
  varietal's lean (Austrian wines score higher, Chilean wines cost less) and the long tail of expensive bottles.
- **Vintages.** The measured age profile per color, anchored so the youngest vintage is 2024; non-vintage wines (most
  Champagne and Port) carry 2025.
- **Tasting notes.** Each wine's descriptors are chosen at the frequency measured for its varietal, so a text search for
  "cassis" finds Cabernet and "petrol" finds Riesling about as often as in the real reviews. Higher-scoring wines get
  longer notes.
- **Alcohol, body and sweetness**, which the dataset does not record, follow hand-curated domain tables. Red and rosé
  wines are never `sweet` or `dessert`.
- **Wineries and designations** are invented, in each country's language.

Generation is deterministic, and record `i` depends only on the seed and `i`. The default tier is therefore exactly the
first 10,000 records of the full tier, and any range can be generated on its own. Only correctly rounded arithmetic is
used on the way from seed to record, so Node and every browser engine produce identical records.

The full tier serializes to about 130 MB of JSON, so generate it where the engine lives rather than shipping it. The
`./wine/generator` sub-export has no loaders, no MSW and no top-level `await`, which makes it safe to import in a Web
Worker:

```ts
import { FULL_WINE_TIER_SIZE, generateWineRange, type Wine } from '@filter-enginez/mock-data/wine/generator';

declare function reportProgress(loaded: number, total: number): void; // e.g. a postMessage to the page

const CHUNK = 10_000;
const wines: Wine[] = [];

for (let start = 0; start < FULL_WINE_TIER_SIZE; start += CHUNK) {
  wines.push(...generateWineRange(start, Math.min(start + CHUNK, FULL_WINE_TIER_SIZE), undefined, 'full'));
  reportProgress(wines.length, FULL_WINE_TIER_SIZE);
}
```

`generateWines(FULL_WINE_TIER_SIZE, undefined, 'full')` does the same in one call. In Node, `loadFullWines()` from
`./wine` returns the full tier too, preferring the local real corpus when one has been imported.

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
`@filter-enginez/mock-data/wine/generator` (worker-safe, generator only), `@filter-enginez/mock-data/books`,
`@filter-enginez/mock-data/handlers`.

## Documentation

Consumer guides live in the engine repository under `docs/guides/`:

- `extending_rules.md` — writing a custom `FilterRule` that survives serialization
- `json_config.md` — declaring filters as data, and why the format is safe to accept from a tenant
- `acceleration_tuning.md` — what the five `acceleration` toggles are worth, measured
- `worker_offload.md` — running the engine in a Web Worker

Project home: <https://filterenginez.com>

Apache-2.0. See `LICENSE.md` and `NOTICE.md`, both included in this package.
