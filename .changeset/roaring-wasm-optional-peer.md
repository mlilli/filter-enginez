---
'@filter-enginez/core': minor
---

`roaring-wasm` is now an optional peer dependency, so installing `@filter-enginez/core` no longer installs it. Bitmap
acceleration needs it installed alongside core:

```bash
npm install roaring-wasm
```

(or `pnpm add roaring-wasm`, `yarn add roaring-wasm`). An app that calls `initializeBitmapAcceleration()` and does not
add it gets a rejection, a `FilterEngineModeError` with the new code `MODE_ACCELERATION_PEER_MISSING`, whose message is
that install command; every later call rejects the same way. Nothing in the engine calls the initializer for you, so an
app that never calls it needs nothing and behaves as before, and an engine whose initializer was rejected keeps
filtering through its predicate path with the same results. Every other load failure is still
`ACCELERATION_INIT_FAILED`.

An app without `roaring-wasm` builds with Vite, Rollup, esbuild and webpack (webpack reports a "Module not found"
warning), and core's type declarations no longer name the library, so it type-checks under `skipLibCheck: false` as
well. The bitmaps `BitmapIndex` and `TextInvertedIndex` return are typed by core's own `RoaringBitmap32` interface, the
members the engine uses; they are still the library's instances, and code that needs its full type can assert it.

`zod` is no longer installed with core: nothing in core used it.

<!-- markdownlint-disable-file MD041 -->
