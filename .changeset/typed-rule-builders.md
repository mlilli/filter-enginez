---
'@filter-enginez/core': patch
---

`rulesFor<T>()` returns the rule builders typed against the item type `T`. Each `field` is a `FieldPath<T>` (a key, or a
dotted path through nested objects, five levels deep), a list of them, a function of the item, or `undefined` for the
item itself; `value` and `inSet` also type their values against the field, so
`rulesFor<Transaction>().value('acountId', id)` and a number for a string field both fail to compile. The plain builders
still take any string, for paths built at run time and for array indices. At run time `rulesFor` returns the plain
builders themselves. `FieldPath`, `PathValue`, `TypedField` and `TypedRuleBuilders` are exported. `RuleClass` is now
`new (...args: never[]) => FilterRule` instead of taking `any[]`: every rule class still fits, and a value of that type
is no longer callable without saying what it is passed.

This release ships with `@filter-enginez/react-signals` 0.0.7, `@filter-enginez/react-rxjs` 0.0.7 and
`@filter-enginez/url-state-router` 0.0.9. An app that pins exact versions to get day-mode dates, accent-insensitive
search, the typed builders and React 18 / react-router 7 support pins `@filter-enginez/core` 0.2.3 with those.

<!-- markdownlint-disable-file MD041 -->
<!-- cspell:ignore acount -->
