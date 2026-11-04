---
'@filter-enginez/core': patch
---

`TextSearchRule` takes two new options. `diacritics: 'ignore'` strips accents from both sides before comparing, so
`'Cafe'` finds `'Café'` and `'Zoe'` finds `'Zoë'`; the default, `'match'`, compares them as written. `locale` folds case
by that language's rules (`toLocaleLowerCase`), so under `'tr'` the dotless `'ı'` matches `'I'` and `'i'` matches `'İ'`.
Both apply in every mode, and an `'allWords'` rule with either is still served by the inverted word index, from postings
folded the same way, so the index and the predicate scan return the same items. The constructor throws
`FilterEngineRuleError` with code `RULE_INVALID_CONFIG` for any other `diacritics` value or a `locale` that is not a BCP
47 tag, and a new `TextSearchRule.deserialize` makes the same checks when a config is loaded. Without either option the
rule matches exactly as before.

<!-- markdownlint-disable-file MD041 -->
