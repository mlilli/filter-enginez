# @filter-enginez/reactive-rxjs

Public RxJS Observable facade over `@filter-enginez/core`'s `subscribe` API — one of the two reactive surfaces (the
other is `@filter-enginez/reactive-signals`). Isomorphic: no DOM, no framework.

## Install

```bash
pnpm add @filter-enginez/reactive-rxjs
```

Peer dependencies: `rxjs@^7.8.1` — supplied by your app.

Sub-exports: `@filter-enginez/reactive-rxjs/worker`.

## The replay contract (load-bearing)

Every stream is a `BehaviorSubject` **seeded from live engine state at construction**, then piped through
`distinctUntilChanged()` + `shareReplay({ bufferSize: 1, refCount: false })`. Consequences worth knowing before you
build on this:

- **A late subscriber synchronously receives the current value.** Angular's `| async` renders a real value on the first
  tick rather than flashing `null`, and `toSignal(stream$, { requireSync: true })` is legal — that option throws against
  a non-replaying source.
- **`refCount: false`** means the replay buffer survives all subscribers unsubscribing, so navigating away from a route
  and back does not lose the current value. The buffer is released on `dispose()`.
- **`events$` is the one stream with no seed** — it is a notification stream, so it emits nothing until the first engine
  change; after that, a late subscriber receives the most recent event and then every new one. Use `lastChangeEvent$` (a
  `BehaviorSubject` seeded `null`) when you need a value immediately.
- **`replayBufferSize: 0`** disables replay entirely. Passing it makes `| async` render blank and `requireSync: true`
  throw. Supported, but rarely what you want.

Seeded `BehaviorSubject`s are what make these guarantees hold; a `fromEventPattern` stream would be cold and
non-replaying, so a late subscriber would see nothing until the next change.

## Surface parity

`RxJsEngine<T>` is field-for-field equivalent to `SignalsEngine<T>`, with a `$` suffix on each stream (the convention
Angular/NgRx readers expect): `results$`, `resultCount$`, `sourceData$`, `workingSet$`, `activeRules$`,
`activeRuleIds$`, `rule$(id)`, `expression$`, `groups$`, `mode$`, `lastChangeRuleId$`, `lastChangeTimestamp$`,
`lastChangeEvent$`, optional `swrRevision$`, plus `events$` (rxjs-only). Non-stream members match exactly: `core`,
optional `asyncEngine`, `dispose()`, `isDisposed`.

`core` is the **same `FilterEngine` instance** you passed to `createRxJsEngine` — the write path is identical whichever
surface you read through. (The async factory instead exposes a synthetic core shim whose reads mirror the worker; the
synchronous queries only the worker can answer — `applyFiltersAndQuery()`, `simulate()`, `getResultIndices()` and the
like — throw `FilterEngineModeError` with code `MODE_WORKER_UNSUPPORTED` on it, naming the awaited `asyncEngine` call to
use instead.)

`dispose()` unsubscribes from the core, completes every subject, and clears the per-rule stream cache. It deliberately
does **not** destroy the engine — the adapter does not own the engine's lifecycle.

## Peer dependency

`rxjs` is a **peer** dependency, not a direct one, so the consuming application owns the single RxJS instance. This
matters for Angular, which ships its own: two copies in one graph break `instanceof Observable`, cross-copy operator
interop, and `takeUntilDestroyed`.

## Documentation

Consumer guides live in the engine repository under `docs/guides/`:

- `extending_rules.md` — writing a custom `FilterRule` that survives serialization
- `json_config.md` — declaring filters as data, and why the format is safe to accept from a tenant
- `acceleration_tuning.md` — what the five `acceleration` toggles are worth, measured
- `worker_offload.md` — running the engine in a Web Worker

Project home, with six live demos: <https://filterenginez.com>. Documentation site: <https://docs.filterenginez.com>.

Apache-2.0. See `LICENSE.md` and `NOTICE.md`, both included in this package.
