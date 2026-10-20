---
'@filter-enginez/core': patch
---

A `GeoProximityRule` matches the same places with bitmap acceleration as without it, for every center and radius. The
R-tree search covers a radius that crosses ±180° longitude, reaches a pole, or extends at high latitudes beyond the
center's own latitude; places there were left out of the accelerated results before.

<!-- markdownlint-disable-file MD041 -->
