---
'@filter-enginez/core': patch
'@filter-enginez/reactive-signals': patch
'@filter-enginez/reactive-rxjs': patch
'@filter-enginez/react-signals': patch
'@filter-enginez/react-rxjs': patch
'@filter-enginez/svelte-signals': patch
'@filter-enginez/vue-signals': patch
'@filter-enginez/angular-rxjs': patch
'@filter-enginez/redux-bridge': patch
'@filter-enginez/url-state-router': patch
'@filter-enginez/worker-bridge': patch
'@filter-enginez/eslint': patch
'@filter-enginez/mock-data': patch
---

Every package declares `"sideEffects": false`, so bundlers drop the parts of a package an app does not import. An app
that imports only `FilterEngineConfigError` from `@filter-enginez/core` bundles under 1 kB of it: the roaring-wasm
WebAssembly, fuse.js and rbush come in only with the engine code that uses them. A bundler setting that marks these
packages side-effect-free by hand, such as a `treeshake.moduleSideEffects` rule, has nothing left to do and can go.

<!-- markdownlint-disable-file MD041 -->
