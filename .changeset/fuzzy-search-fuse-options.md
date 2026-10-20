---
'@filter-enginez/core': minor
---

`FuzzySearchRule` passes Fuse.js's serializable options through, beside `threshold`, `distance` and `keys`:
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

The options survive `exportConfig`, URL state and the worker bridge, and each is checked when a config loads: a wrongly
typed one throws `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG`. Function options (`getFn`,
`sortFn`) are not part of the config; a function `field` extractor covers custom extraction.

A fuzzy rule builds one Fuse index over the data and searches it once per query, instead of building a Fuse instance per
item, and keeps the index until the data, the `field` or a Fuse option other than `query` changes. The matches are the
same as before for every option. Custom rules can do the same through the new `FilterRule.prepareForCollection` hook,
which the engine calls before each pass over a collection.

<!-- markdownlint-disable-file MD041 -->
