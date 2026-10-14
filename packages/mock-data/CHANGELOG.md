# @filter-enginez/mock-data

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
