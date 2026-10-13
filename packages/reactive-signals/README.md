# @filter-enginez/reactive-signals

Public signals facade over `@filter-enginez/core`'s subscribe API. Wraps the core's plain `subscribe(callback)` into
`@preact/signals-core` signals for fine-grained reactive consumption. Isomorphic.

## Install

```bash
pnpm add @filter-enginez/reactive-signals
```

Sub-exports: `@filter-enginez/reactive-signals/worker`.

## Errors

The worker-backed engine (`createSignalsEngineFromAsync`) exposes a synchronous `core` shim with every public
`FilterEngine` member. A member it cannot answer on the main thread — `applyFiltersAndQuery()`, `simulate()`,
`getResultIndices()`, `computeResults()`, `getFilteredFieldValuesExcept()`, `snapshot()`, `exportConfig()`,
`precomputeExclusions()`, the store internals, the dispatcher — throws `FilterEngineModeError` with code
`MODE_WORKER_UNSUPPORTED`, and the message names the awaited `asyncEngine` call to use instead.

## Documentation

Consumer guides live in the engine repository under `docs/guides/`:

- `extending_rules.md` — writing a custom `FilterRule` that survives serialization
- `json_config.md` — declaring filters as data, and why the format is safe to accept from a tenant
- `acceleration_tuning.md` — what the five `acceleration` toggles are worth, measured
- `worker_offload.md` — running the engine in a Web Worker

Project home: <https://filterenginez.com>

Apache-2.0. See `LICENSE.md` and `NOTICE.md`, both included in this package.
