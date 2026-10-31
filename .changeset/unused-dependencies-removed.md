---
'@filter-enginez/react-signals': patch
'@filter-enginez/angular-rxjs': patch
'@filter-enginez/eslint': patch
---

Each package installs only the dependencies its code imports. `@filter-enginez/react-signals` no longer installs
`@preact/signals-react`, `@filter-enginez/angular-rxjs` no longer installs `@filter-enginez/core` directly (it still
reaches it through `@filter-enginez/reactive-rxjs`; import core in your app as before, from your own dependency on it),
and `@filter-enginez/eslint` no longer installs `@eslint/config-helpers` or `@typescript-eslint/utils`. None of them was
used, so nothing else changes.

<!-- markdownlint-disable-file MD041 -->
