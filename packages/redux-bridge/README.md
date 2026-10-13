# @filter-enginez/redux-bridge

Optional Redux mirror slice + middleware. One-way sync — engine is source of truth, Redux is read-only mirror. Two valid
write paths: direct on engine, OR dispatch through Redux middleware. Mirror is never mutated directly (enforced by the
`@filter-enginez/no-direct-mirror-mutation` rule from `@filter-enginez/eslint/plugin`). Isomorphic.

## Install

```bash
pnpm add @filter-enginez/redux-bridge
```

Peer dependencies: `@reduxjs/toolkit@^2.0.0` — supplied by your app.

## Documentation

Consumer guides live in the engine repository under `docs/guides/`:

- `extending_rules.md` — writing a custom `FilterRule` that survives serialization
- `json_config.md` — declaring filters as data, and why the format is safe to accept from a tenant
- `acceleration_tuning.md` — what the five `acceleration` toggles are worth, measured
- `worker_offload.md` — running the engine in a Web Worker

Project home: <https://filterenginez.com>

Apache-2.0. See `LICENSE.md` and `NOTICE.md`, both included in this package.
