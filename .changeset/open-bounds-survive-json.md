---
'@filter-enginez/core': patch
---

A rule with an open bound keeps its matches through `exportConfig` → JSON → `loadConfig`, URL state from
`@filter-enginez/url-state-router`, devtools persistence and an HTTP request body. JSON writes `Infinity` and
`-Infinity` as `null`; a `null` bound loads as open instead of comparing as `0`, so a link to "$60 and up" written as
`{ "min": 60, "max": null }` matches the wines it matched when it was shared, including links shared before this
release. The same holds for `NumericComparisonRule`'s `value` (`Infinity` under `<`, `<=`, `==`, `!=`; `-Infinity` under
`>`, `>=`), `GeoProximityRule`'s `radiusKm` and `FuzzySearchRule`'s `threshold` and `distance` (`Infinity`), and
`DateRangeRule`'s `start` and `end` (no bound, rather than 1970-01-01).

Those rules check each bound as they load it: a value that is neither a number nor `null` (a string, a missing key,
`NaN`), an unknown `NumericComparisonRule` operator, a non-finite `GeoProximityRule` center coordinate, or a
`DateRangeRule` bound that is not a date throws `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG`,
naming the rule type and the key. A subclass registered in place of `RangeRule`, `NumericComparisonRule`,
`GeoProximityRule` or `FuzzySearchRule` loads as itself: `ruleRegistry.deserialize` calls a rule's `static deserialize`
with the registered class as `this`.

<!-- markdownlint-disable-file MD041 -->
