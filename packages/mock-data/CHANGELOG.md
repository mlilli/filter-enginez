# @filter-enginez/mock-data

## 0.2.2

### Patch Changes

- Updated dependencies [d4ea599]
- Updated dependencies [d4ea599]
- Updated dependencies [d4ea599]
- Updated dependencies [d4ea599]
  - @filter-enginez/core@0.1.0

## 0.2.1

### Patch Changes

- c582292: Every package declares `"sideEffects": false`, so bundlers drop the parts of a package an app does not
  import. An app that imports only `FilterEngineConfigError` from `@filter-enginez/core` bundles under 1 kB of it: the
  roaring-wasm WebAssembly, fuse.js and rbush come in only with the engine code that uses them. A bundler setting that
  marks these packages side-effect-free by hand, such as a `treeshake.moduleSideEffects` rule, has nothing left to do
  and can go.

  <!-- markdownlint-disable-file MD041 -->

- Updated dependencies [c582292]
- Updated dependencies [c582292]
  - @filter-enginez/core@0.0.3

## 0.2.0

### Minor Changes

- 99abe5c: Every real-estate `Listing` carries `coords: { lat, lng }`, the same point as `coordinates: { lat, lon }` in
  the shape `GeoProximityRule` and the engine's R-tree spatial index read, typed by the new exported `ListingGeoCoords`.
  `new GeoProximityRule('coords', { center, radiusKm })` names its field by string, so a radius filter survives
  `exportConfig` → JSON → `loadConfig`, a shared URL, a worker and a server with the same matches, and the R-tree
  accelerates it. A function extractor that renames `lon` to `lng` serializes as `'<function>'` and matches nothing once
  loaded.

  `coordinates` is unchanged, and `coords` is copied from it rather than generated, so every other field of every
  listing keeps its value. The `geo-proximity` rule in `realEstateFilterConfig` reads `coords` with a `{ lat, lng }`
  center, and matches the listings within 25 km of San Francisco.

  <!-- markdownlint-disable-file MD041 -->

## 0.1.0

### Minor Changes

- f09b5b1: The wine full tier is 150,000 synthetic wines, generated on demand in Node or in a browser Web Worker. The
  worker-safe `@filter-enginez/mock-data/wine/generator` sub-export provides `generateWines(count)`,
  `generateWineRange(start, end)` for chunked generation with progress, `WINE_GENERATOR_SEED`, and the tier sizes,
  including the new `FULL_WINE_TIER_SIZE` (150,000, also `FULL_TIER_SIZES.wine`). `loadFullWines()` always resolves: to
  the local real corpus where one has been imported, otherwise to the synthetic full tier.

  The wine generator reproduces the measured shares of the Kaggle "Wine Reviews" dataset without containing any of its
  records: all 1,619 origin leaves, 701 varietals and the pairings between them, the score histogram, prices by score
  with country and varietal leans, vintage ages, missing regions and designations, and tasting-word frequencies per
  varietal. The default tier is the first 10,000 records of the full tier, and a seed gives identical records in every
  JavaScript engine. Every generated value is new, in the dataset's own vocabulary (`US`, `Northern Spain`,
  `Red Blend`), so code that matches specific generated wines, names or origin ids needs to look them up again.

  <!-- markdownlint-disable-file MD041 -->

## 0.0.3

### Patch Changes

- 1430f42: `@filter-enginez/mock-data` loads in bundled server runtimes that leave `import.meta.url` undefined, such as
  Cloudflare Workers, and serves the synthetic datasets there.

  <!-- markdownlint-disable-file MD041 -->

## 0.0.2

### Patch Changes

- d05926c: Package descriptions lead with what each package does, and keywords cover the terms people search for:
  faceted search, filtering, facets, and the framework each package binds to. Published versions carry an npm provenance
  attestation, and each package's homepage is <https://filterenginez.com>.

  <!-- markdownlint-disable-file MD041 -->

- Updated dependencies [d05926c]
  - @filter-enginez/core@0.0.2
