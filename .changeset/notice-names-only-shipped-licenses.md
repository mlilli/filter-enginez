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

The `NOTICE.md` each package ships names only the licenses of what the packages contain and install. It no longer
describes the repository's local-only real wine dataset, which ships in no package and is under a license of its own;
that note stays in the repository's `NOTICE.md`. In `@filter-enginez/mock-data`, the README and the compiled code's
comments describe the same dataset without naming its license. The runtime-dependency list follows this release's
dependency changes: `roaring-wasm` as an optional peer dependency of core, and no `zod`, `@preact/signals-react`,
`@eslint/config-helpers` or `@typescript-eslint/utils`.

<!-- markdownlint-disable-file MD041 -->
