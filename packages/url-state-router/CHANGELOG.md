# @filter-enginez/url-state-router

## 0.0.4

### Patch Changes

- Updated dependencies [d4ea599]
- Updated dependencies [d4ea599]
- Updated dependencies [d4ea599]
- Updated dependencies [d4ea599]
  - @filter-enginez/core@0.1.0

## 0.0.3

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

## 0.0.2

### Patch Changes

- d05926c: Package descriptions lead with what each package does, and keywords cover the terms people search for:
  faceted search, filtering, facets, and the framework each package binds to. Published versions carry an npm provenance
  attestation, and each package's homepage is <https://filterenginez.com>.

  <!-- markdownlint-disable-file MD041 -->

- Updated dependencies [d05926c]
  - @filter-enginez/core@0.0.2
