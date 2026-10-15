# @filter-enginez/vue-signals

Vue 3 reactivity bindings over `@filter-enginez/reactive-signals`. Browser-only.

The engine's reactive state is `@preact/signals-core` signals; Vue components want refs. This package bridges the two
and carries the provide/inject plumbing, so a component reads filter state without receiving an engine through props.

## Install

```bash
pnpm add @filter-enginez/vue-signals
```

Peer dependencies: `vue@^3.5.0` — supplied by your app.

## Usage

Provide the engine once, in a root component's `setup`:

```ts
import type { SignalsEngine } from '@filter-enginez/reactive-signals';
import { provideFilterEngine } from '@filter-enginez/vue-signals';

declare const engine: SignalsEngine<unknown>; // e.g. createSignalsEngine(core)

provideFilterEngine(engine);
```

Then read it in any descendant:

```vue
<script setup lang="ts">
import { useEngineRefs, useFilterEngine } from '@filter-enginez/vue-signals';

const { results, resultCount } = useEngineRefs(useFilterEngine());
</script>

<template>
  <p>{{ resultCount }} matches</p>
  <li v-for="item in results" :key="item.id">…</li>
</template>
```

## API

| Export                                    | What it is                                                     |
| ----------------------------------------- | -------------------------------------------------------------- |
| `provideFilterEngine` / `useFilterEngine` | Vue provide/inject for the engine                              |
| `useEngineRefs`                           | Engine signals as refs (`EngineRefs`, `LastChange`)            |
| `useSignal`                               | The primitive underneath: one `ReadonlySignalLike` to one ref  |
| `useBusy(tracker)`                        | From an `EngineBusyTracker`: `true` while a query is in flight |

`useFilterEngine()` with no engine provided above the component throws `FilterEngineConfigError` with code
`BINDING_ENGINE_NOT_PROVIDED`.

⚠ **`useEngineRefs` uses `shallowRef`, and that is deliberate.** Results are arrays of plain data objects, so a deep
reactive proxy would walk every record on every update — the cost scales with corpus size for no benefit, since the
engine replaces the array wholesale rather than mutating it in place.

## Documentation

Consumer guides live in the engine repository under `docs/guides/`:

- `extending_rules.md` — writing a custom `FilterRule` that survives serialization
- `json_config.md` — declaring filters as data, and why the format is safe to accept from a tenant
- `acceleration_tuning.md` — what the five `acceleration` toggles are worth, measured
- `worker_offload.md` — running the engine in a Web Worker

Project home, with six live demos: <https://filterenginez.com>. Documentation site: <https://docs.filterenginez.com>.

Apache-2.0. See `LICENSE.md` and `NOTICE.md`, both included in this package.
