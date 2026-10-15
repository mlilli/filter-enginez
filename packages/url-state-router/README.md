# @filter-enginez/url-state-router

react-router URL serialization for filter state. `<FilterEngineUrlSync>` keeps one query parameter and the engine in
sync both ways: filter changes `replace` the history entry by default (`historyMode`), and with `routeChangeMode` set,
the current filter state is re-attached when the app navigates to another route whose URL lacks the parameter.
Origin-tracking prevents engine ↔ URL ↔ engine loops. Three serializers — `json-base64` (opaque), `compact` (lz-string,
shortest) and `human-readable` (the config as plain JSON) — plus `createTaggedSerializer`, which prefixes the format so
one URL parameter can carry any of them. Browser-only.

## Install

```bash
pnpm add @filter-enginez/url-state-router
```

Peer dependencies: `react@>=19.2.7`, `react-router@^8.3.0` — supplied by your app.

Sub-exports: `@filter-enginez/url-state-router/serializers`.

## Errors

A serializer's `decode` throws `FilterEngineConfigError` with code `URL_STATE_MALFORMED` for a truncated, corrupt or
untagged URL value, with the parser's own error as `cause`; `resolveSerializer` throws `URL_STATE_UNKNOWN_SERIALIZER`
for a name that is not a built-in. `FilterEngineUrlSync` hands a failed decode to `onError` and, by default, leaves the
engine unchanged.

## Documentation

Consumer guides live in the engine repository under `docs/guides/`:

- `extending_rules.md` — writing a custom `FilterRule` that survives serialization
- `json_config.md` — declaring filters as data, and why the format is safe to accept from a tenant
- `acceleration_tuning.md` — what the five `acceleration` toggles are worth, measured
- `worker_offload.md` — running the engine in a Web Worker

Project home, with six live demos: <https://filterenginez.com>. Documentation site: <https://docs.filterenginez.com>.

Apache-2.0. See `LICENSE.md` and `NOTICE.md`, both included in this package.
