---
'@filter-enginez/core': patch
---

A rule that leaves the engine no longer keeps what it prepared. Devtools, on by default, keeps the rules of the last 100
states for undo, and a replaced `FuzzySearchRule` kept the Fuse index it had built over the whole collection: a search
box that added a new fuzzy rule on each keystroke over 150,000 items grew by about 27 MB a keystroke. The engine now
calls the new `FilterRule.releasePrepared()` hook on each rule that is replaced, removed, cleared, dropped from the
expression, taken out by an undo or redo, or still active at `destroy()`, and `FuzzySearchRule` drops its indexes and
answers there. The matches are the same: a rule that comes back is prepared again by the next pass.

<!-- markdownlint-disable-file MD041 -->
