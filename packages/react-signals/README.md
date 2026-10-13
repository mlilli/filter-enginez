# @filter-enginez/react-signals

React hooks over `@filter-enginez/reactive-signals`. Browser-only. Uses `useSyncExternalStore` for concurrent-mode-safe
consumption of signal state. Keyboard handlers (Cmd/Ctrl-Z for undo; Cmd/Ctrl-Shift-Z and Cmd/Ctrl-Y for redo) live in
the `./keyboard` sub-export.

## Install

```bash
pnpm add @filter-enginez/react-signals
```

Peer dependencies: `react@^19.0.0` — supplied by your app.

Sub-exports: `@filter-enginez/react-signals/keyboard`.

## Errors

`useFilterEngine()` outside a `<FilterEngineProvider>` throws `FilterEngineConfigError` with code
`BINDING_ENGINE_NOT_PROVIDED`.

## Documentation

Consumer guides live in the engine repository under `docs/guides/`:

- `extending_rules.md` — writing a custom `FilterRule` that survives serialization
- `json_config.md` — declaring filters as data, and why the format is safe to accept from a tenant
- `acceleration_tuning.md` — what the five `acceleration` toggles are worth, measured
- `worker_offload.md` — running the engine in a Web Worker

Project home: <https://filterenginez.com>

Apache-2.0. See `LICENSE.md` and `NOTICE.md`, both included in this package.
