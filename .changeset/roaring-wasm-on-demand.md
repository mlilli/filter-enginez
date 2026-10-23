---
'@filter-enginez/core': patch
---

roaring-wasm loads only when `initializeBitmapAcceleration()` runs; an app that never enables bitmaps no longer bundles
it (about 93 kB smaller gzipped for an app that creates an engine and filters). An app that does call it gets the
library as a separate chunk from any bundler that splits code, fetched when the call runs, so the first render does not
wait for it. Results are the same with and without bitmaps, as before. `BitmapIndex` and `TextInvertedIndex`, used
directly before the initializer has resolved, throw a `FilterEngineModeError` with the new code
`MODE_ACCELERATION_NOT_READY` instead of failing inside the library.

<!-- markdownlint-disable-file MD041 -->
