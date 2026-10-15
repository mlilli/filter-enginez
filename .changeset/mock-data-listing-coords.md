---
'@filter-enginez/mock-data': minor
---

Every real-estate `Listing` carries `coords: { lat, lng }`, the same point as `coordinates: { lat, lon }` in the shape
`GeoProximityRule` and the engine's R-tree spatial index read, typed by the new exported `ListingGeoCoords`.
`new GeoProximityRule('coords', { center, radiusKm })` names its field by string, so a radius filter survives
`exportConfig` → JSON → `loadConfig`, a shared URL, a worker and a server with the same matches, and the R-tree
accelerates it. A function extractor that renames `lon` to `lng` serializes as `'<function>'` and matches nothing once
loaded.

`coordinates` is unchanged, and `coords` is copied from it rather than generated, so every other field of every listing
keeps its value. The `geo-proximity` rule in `realEstateFilterConfig` reads `coords` with a `{ lat, lng }` center, and
matches the listings within 25 km of San Francisco.

<!-- markdownlint-disable-file MD041 -->
