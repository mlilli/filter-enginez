# @filter-enginez/reactive-signals

## 0.0.7

### Patch Changes

- 10c2188: A worker-backed engine copies its source data to the main thread in chunks. `createSignalsEngineFromAsync`
  and `createRxJsEngineFromAsync` copied the whole corpus in one message, which the main thread deserialized in one
  task: about 700 ms for 150,000 wines on a 4×-throttled CPU, during which the page could not respond to input. They now
  request 7,500 records at a time, one request after the other, so each chunk is its own task (under 45 ms in the same
  measurement) and the page handles input in between. The records, and their order, are unchanged. The
  `sourceDataChunkSize` option sets the chunk size.

  A `reset` or a time-travel jump no longer copies the corpus again: the adapters ask the worker whether its source data
  has been replaced, and keep the copy they hold when it has not. Replaced source data is copied in chunks.

  `worker-bridge` adds `getSourceDataRange(offset, count)` to the `wrapInWorker` facade, returning a slice of the source
  data with its `total` and a `revision` that changes when the source data is replaced, and `createSourceDataPuller`,
  which the adapters use to assemble the chunks. `getSourceDataRange` is optional on `FilterEngineAsync`, so an engine
  over another transport stays valid; the adapters copy such an engine's source data in one message, as before.

  <!-- markdownlint-disable-file MD041 -->

- Updated dependencies [10c2188]
  - @filter-enginez/worker-bridge@0.0.6

## 0.0.6

### Patch Changes

- 2bff306: `createSignalsEngineFromAsync` and `createRxJsEngineFromAsync` boot from the worker's result indices instead
  of its results. With no rules active the results are the whole corpus, so boot copied the corpus across the worker
  boundary twice; it now copies it once, which roughly halves the main-thread cost of booting a large dataset.

  <!-- markdownlint-disable-file MD041 -->

## 0.0.5

### Patch Changes

- 196a74d: The `NOTICE.md` each package ships names only the licenses of what the packages contain and install. It no
  longer describes the repository's local-only real wine dataset, which ships in no package and is under a license of
  its own; that note stays in the repository's `NOTICE.md`. In `@filter-enginez/mock-data`, the README and the compiled
  code's comments describe the same dataset without naming its license. The runtime-dependency list follows this
  release's dependency changes: `roaring-wasm` as an optional peer dependency of core, and no `zod`,
  `@preact/signals-react`, `@eslint/config-helpers` or `@typescript-eslint/utils`.

  <!-- markdownlint-disable-file MD041 -->

- Updated dependencies [196a74d]
- Updated dependencies [196a74d]
  - @filter-enginez/core@0.2.0
  - @filter-enginez/worker-bridge@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [d4ea599]
- Updated dependencies [d4ea599]
- Updated dependencies [d4ea599]
- Updated dependencies [d4ea599]
  - @filter-enginez/core@0.1.0
  - @filter-enginez/worker-bridge@0.0.4

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
  - @filter-enginez/worker-bridge@0.0.3

## 0.0.2

### Patch Changes

- d05926c: Package descriptions lead with what each package does, and keywords cover the terms people search for:
  faceted search, filtering, facets, and the framework each package binds to. Published versions carry an npm provenance
  attestation, and each package's homepage is <https://filterenginez.com>.

  <!-- markdownlint-disable-file MD041 -->

- Updated dependencies [d05926c]
  - @filter-enginez/core@0.0.2
  - @filter-enginez/worker-bridge@0.0.2
