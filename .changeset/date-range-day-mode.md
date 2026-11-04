---
'@filter-enginez/core': patch
---

`DateRangeRule` has a day mode, and its Date mode can name its calendar. With `mode: 'day'`, values, bounds and `today`
are `YYYY-MM-DD` strings compared as strings, with no `Date` and no time zone, and presets count from the `today` the
caller passes ("last 7 days" is the seven days ending on it). In Date mode, `timeZone: 'utc'` or `'local'` sets the
calendar that `'this-month'` and `'this-year'` start in and that a date string without an offset is read in; without it
the rule behaves as before. Both survive `exportConfig` / `loadConfig`. The constructor now checks the config and throws
`FilterEngineRuleError` with the new code `RULE_INVALID_CONFIG` for an unknown `mode`, `preset` or `timeZone`, a
day-mode bound or `today` that is not a real calendar day, or a day-mode preset without `today`. `DateRangeRule` takes
its config type as a parameter (Date mode by default), so `DateRangeRule.deserialize` now returns a rule whose bounds
may be either kind.

<!-- markdownlint-disable-file MD041 -->
