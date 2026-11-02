---
'@filter-enginez/core': patch
---

With `acceleration.textIndex` engaged, a strict-threshold `FuzzySearchRule` confirms its trigram candidates with one
Fuse search over all of them, instead of building and searching a one-item Fuse index for each. The matches are the
same; the confirm takes about two-thirds of the time.

<!-- markdownlint-disable-file MD041 -->
