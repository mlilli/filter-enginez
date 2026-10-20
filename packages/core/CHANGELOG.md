# @filter-enginez/core

## 0.1.0

### Minor Changes

- d4ea599: `InSetRule`, `InSetofSetsRule` and `HierarchicalRule` match fields that hold an array, such as
  `paymentMethods: ['card', 'cash']`, so "accepts any of these payment methods" is a serializable built-in rule. A new
  `arrayMatch` option chooses how the array meets the selection: `'any'` (the default) passes when at least one element
  is selected, and `'all'` passes when the array holds every selected value (for `InSetofSetsRule`, a value from every
  selected subset; for `HierarchicalRule`, an id in every selected subtree).

  ```ts
  new InSetRule('paymentMethods', ['card', 'cash']); // accepts card or cash
  new InSetRule('paymentMethods', ['card', 'cash'], { arrayMatch: 'all' }); // accepts both
  inSet('paymentMethods', { arrayMatch: 'all', set: ['card', 'cash'] });
  ```

  An empty selection matches everything, and an empty array matches no non-empty selection. A field that is not an array
  matches exactly as in 0.0.3. A rule over an array field, which matched no item in 0.0.3, passes the items whose array
  meets the selection. `arrayMatch` is saved by `exportConfig`, URL state and the worker bridge, and a value other than
  `'any'` or `'all'` throws `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG` on load.

  `applyFiltersAndQuery` reads array fields in `inSet` and `inSetOfSets` chip groups too: an item counts once toward
  each candidate its array holds, however many of its elements point at that candidate. A group whose rule has
  `arrayMatch: 'all'` is projected the way `containsAll` groups are, with its rule kept active, so a candidate that
  cannot combine with the current selection reports `wouldBeEmpty`.

  <!-- markdownlint-disable-file MD041 -->

- d4ea599: `FuzzySearchRule` passes Fuse.js's serializable options through, beside `threshold`, `distance` and `keys`:
  `ignoreLocation`, `minMatchCharLength`, `location`, `isCaseSensitive`, `ignoreDiacritics`, `findAllMatches`,
  `ignoreFieldNorm`, `fieldNormWeight`, `useExtendedSearch`, `useTokenSearch` and `tokenMatch`. A rule configured like
  your own Fuse instance matches the items that instance returns:

  ```ts
  new FuzzySearchRule(undefined, {
    ignoreLocation: true,
    keys: ['name', 'winery'],
    minMatchCharLength: 2,
    query: 'cabernay',
  });
  ```

  The options survive `exportConfig`, URL state and the worker bridge, and each is checked when a config loads: a
  wrongly typed one throws `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG`. Function options
  (`getFn`, `sortFn`) are not part of the config; a function `field` extractor covers custom extraction.

  A fuzzy rule builds one Fuse index over the data and searches it once per query, instead of building a Fuse instance
  per item, and keeps the index until the data, the `field` or a Fuse option other than `query` changes. The matches are
  the same as before for every option. Custom rules can do the same through the new `FilterRule.prepareForCollection`
  hook, which the engine calls before each pass over a collection.

  <!-- markdownlint-disable-file MD041 -->

### Patch Changes

- d4ea599: A `GeoProximityRule` matches the same places with bitmap acceleration as without it, for every center and
  radius. The R-tree search covers a radius that crosses ±180° longitude, reaches a pole, or extends at high latitudes
  beyond the center's own latitude; places there were left out of the accelerated results before.

  <!-- markdownlint-disable-file MD041 -->

- d4ea599: Loading a config whose expression was built from rules never passed to `addRule` reproduces the exported
  engine exactly. Those rules (`__inline_0`, `__inline_1`, …) are written to the config marked `"inline": true` and are
  used by the expression only, so clearing the expression after `loadConfig`, a `?f=` link or Back / Forward leaves the
  same rules filtering as on the engine that exported it, instead of leaving the expression's leaves behind as active
  filters. A config written without the mark loads the same way, because the `__inline_<n>` ids are reserved for these
  rules. The same rule used twice in one expression is written once.

  <!-- markdownlint-disable-file MD041 -->

## 0.0.3

### Patch Changes

- c582292: A rule with an open bound keeps its matches through `exportConfig` → JSON → `loadConfig`, URL state from
  `@filter-enginez/url-state-router`, devtools persistence and an HTTP request body. JSON writes `Infinity` and
  `-Infinity` as `null`; a `null` bound loads as open instead of comparing as `0`, so a link to "$60 and up" written as
  `{ "min": 60, "max": null }` matches the wines it matched when it was shared, including links shared before this
  release. The same holds for `NumericComparisonRule`'s `value` (`Infinity` under `<`, `<=`, `==`, `!=`; `-Infinity`
  under `>`, `>=`), `GeoProximityRule`'s `radiusKm` and `FuzzySearchRule`'s `threshold` and `distance` (`Infinity`), and
  `DateRangeRule`'s `start` and `end` (no bound, rather than 1970-01-01).

  Those rules check each bound as they load it: a value that is neither a number nor `null` (a string, a missing key,
  `NaN`), an unknown `NumericComparisonRule` operator, a non-finite `GeoProximityRule` center coordinate, or a
  `DateRangeRule` bound that is not a date throws `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG`,
  naming the rule type and the key. A subclass registered in place of `RangeRule`, `NumericComparisonRule`,
  `GeoProximityRule` or `FuzzySearchRule` loads as itself: `ruleRegistry.deserialize` calls a rule's
  `static deserialize` with the registered class as `this`.

  <!-- markdownlint-disable-file MD041 -->

- c582292: Every package declares `"sideEffects": false`, so bundlers drop the parts of a package an app does not
  import. An app that imports only `FilterEngineConfigError` from `@filter-enginez/core` bundles under 1 kB of it: the
  roaring-wasm WebAssembly, fuse.js and rbush come in only with the engine code that uses them. A bundler setting that
  marks these packages side-effect-free by hand, such as a `treeshake.moduleSideEffects` rule, has nothing left to do
  and can go.

  <!-- markdownlint-disable-file MD041 -->

## 0.0.2

### Patch Changes

- d05926c: Package descriptions lead with what each package does, and keywords cover the terms people search for:
  faceted search, filtering, facets, and the framework each package binds to. Published versions carry an npm provenance
  attestation, and each package's homepage is <https://filterenginez.com>.

  <!-- markdownlint-disable-file MD041 -->
