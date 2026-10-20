---
'@filter-enginez/core': patch
---

Loading a config whose expression was built from rules never passed to `addRule` reproduces the exported engine exactly.
Those rules (`__inline_0`, `__inline_1`, …) are written to the config marked `"inline": true` and are used by the
expression only, so clearing the expression after `loadConfig`, a `?f=` link or Back / Forward leaves the same rules
filtering as on the engine that exported it, instead of leaving the expression's leaves behind as active filters. A
config written without the mark loads the same way, because the `__inline_<n>` ids are reserved for these rules. The
same rule used twice in one expression is written once.

<!-- markdownlint-disable-file MD041 -->
