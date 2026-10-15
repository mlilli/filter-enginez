# @filter-enginez/worker-bridge

Opt-in Web Worker offload via Comlink. The whole engine runs in the worker; `wrapInWorker` returns a promise-returning
facade (`FilterEngineAsync`) whose every method is one round trip, and typed-array results (result indices, field
values, histograms) are transferred rather than cloned. `shouldEngageWorker(itemCount, policy)` advises whether to
offload — by default at 50,000 items or more. Browser-only.

## Install

```bash
pnpm add @filter-enginez/worker-bridge
```

## Errors

An engine error raised inside the worker reaches the main thread as the same class — `FilterEngineError` or one of its
subclasses, including `RuleRegistryError` — with its `name`, `code`, `message`, `cause` and worker-side stack.
`wrapInWorker` and `exposeFilterEngineWorker` each install the Comlink transfer handler that makes this work; there is
nothing to configure. After `destroy()`, every facade method rejects with `FilterEngineDestroyedError` instead of
waiting on a worker that will never answer.

A worker that fails to load or evaluate fires `error` before its ready handshake; `wrapInWorker` then rejects with a
`FilterEngineError` whose code is `WORKER_LOAD_FAILED` (the event as `cause`) and terminates the worker.

`exposeFilterEngineWorker` infers the item type of each registered factory, so one worker can host a
`WorkerEngineFactory<Wine>` and a `WorkerEngineFactory<Book>` side by side without casts.

## Documentation

Consumer guides live in the engine repository under `docs/guides/`:

- `extending_rules.md` — writing a custom `FilterRule` that survives serialization
- `json_config.md` — declaring filters as data, and why the format is safe to accept from a tenant
- `acceleration_tuning.md` — what the five `acceleration` toggles are worth, measured
- `worker_offload.md` — running the engine in a Web Worker

Project home, with six live demos: <https://filterenginez.com>. Documentation site: <https://docs.filterenginez.com>.

Apache-2.0. See `LICENSE.md` and `NOTICE.md`, both included in this package.
