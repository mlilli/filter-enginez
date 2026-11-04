# @filter-enginez/react-signals

## 0.0.7

### Patch Changes

- 772d61b: The React packages accept React 18. `react-signals` and `react-rxjs` declare `react@^18.3.0 || ^19.0.0`, and
  `url-state-router` declares `react@^18.3.0 || ^19.0.0` and `react-router@^7.18.2 || ^8.3.0` (7.18.2 is the first 7.x
  release with every react-router advisory patched). The provider now renders as `<Context.Provider>`, and
  `<FilterEngineUrlSync>` reads the router's contexts with `useContext`, the forms React 18 and 19 both support; nothing
  else changes. Each package's tests also run on React 18.3 and react-router 7.18, and its source is type-checked
  against React 18's typings. An app on `react-router-dom` 7 should install `react-router` at the same version, since
  `url-state-router` imports `react-router` directly.

  <!-- markdownlint-disable-file MD041 -->

- Updated dependencies [47d2884]
- Updated dependencies [68b1a08]
- Updated dependencies [4afe0b5]
  - @filter-enginez/core@0.2.3

## 0.0.6

### Patch Changes

- Updated dependencies [2bff306]
  - @filter-enginez/reactive-signals@0.0.6

## 0.0.5

### Patch Changes

- 196a74d: The `NOTICE.md` each package ships names only the licenses of what the packages contain and install. It no
  longer describes the repository's local-only real wine dataset, which ships in no package and is under a license of
  its own; that note stays in the repository's `NOTICE.md`. In `@filter-enginez/mock-data`, the README and the compiled
  code's comments describe the same dataset without naming its license. The runtime-dependency list follows this
  release's dependency changes: `roaring-wasm` as an optional peer dependency of core, and no `zod`,
  `@preact/signals-react`, `@eslint/config-helpers` or `@typescript-eslint/utils`.

  <!-- markdownlint-disable-file MD041 -->

- 196a74d: Each package installs only the dependencies its code imports. `@filter-enginez/react-signals` no longer
  installs `@preact/signals-react`, `@filter-enginez/angular-rxjs` no longer installs `@filter-enginez/core` directly
  (it still reaches it through `@filter-enginez/reactive-rxjs`; import core in your app as before, from your own
  dependency on it), and `@filter-enginez/eslint` no longer installs `@eslint/config-helpers` or
  `@typescript-eslint/utils`. None of them was used, so nothing else changes.

  <!-- markdownlint-disable-file MD041 -->

- Updated dependencies [196a74d]
- Updated dependencies [196a74d]
  - @filter-enginez/core@0.2.0
  - @filter-enginez/reactive-signals@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [d4ea599]
- Updated dependencies [d4ea599]
- Updated dependencies [d4ea599]
- Updated dependencies [d4ea599]
  - @filter-enginez/core@0.1.0
  - @filter-enginez/reactive-signals@0.0.4

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
  - @filter-enginez/reactive-signals@0.0.3

## 0.0.2

### Patch Changes

- d05926c: Package descriptions lead with what each package does, and keywords cover the terms people search for:
  faceted search, filtering, facets, and the framework each package binds to. Published versions carry an npm provenance
  attestation, and each package's homepage is <https://filterenginez.com>.

  <!-- markdownlint-disable-file MD041 -->

- Updated dependencies [d05926c]
  - @filter-enginez/core@0.0.2
  - @filter-enginez/reactive-signals@0.0.2
