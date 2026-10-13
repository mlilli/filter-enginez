# @filter-enginez/svelte-signals

Svelte store bindings over `@filter-enginez/reactive-signals`. Browser-only.

The engine's reactive state is `@preact/signals-core` signals; Svelte consumes anything implementing its `Readable`
contract. This package is the adapter between the two, plus the context plumbing to get an engine to a component without
threading it through props.

## Install

```bash
pnpm add @filter-enginez/svelte-signals
```

Peer dependencies: `svelte@^5.0.0` — supplied by your app.

## Usage

Provide the engine once, near the root:

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { SignalsEngine } from '@filter-enginez/reactive-signals';
  import { setFilterEngine } from '@filter-enginez/svelte-signals';
  import type { Wine } from './wine';

  let { children, engine }: { children: Snippet; engine: SignalsEngine<Wine> } = $props();

  setFilterEngine(engine);
</script>

{@render children()}
```

Then read it anywhere below:

```svelte
<script lang="ts">
  import { createEngineStores, getFilterEngine } from '@filter-enginez/svelte-signals';
  import type { Wine } from './wine';

  const { results, resultCount } = createEngineStores(getFilterEngine<Wine>());
</script>

<p>{$resultCount} matches</p>
<ul>
  {#each $results as wine (wine.id)}
    <li>{wine.title}</li>
  {/each}
</ul>
```

Svelte 5 reads a `Readable` store with the `$` prefix in markup and in runes alike, so these stores work unchanged
inside `$derived` (`const empty = $derived($resultCount === 0);`).

## API

| Export                                | What it is                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| `setFilterEngine` / `getFilterEngine` | Svelte context put/get for the engine — call `set` during component init       |
| `createEngineStores`                  | Engine signals as Svelte `Readable` stores (`EngineStores`, `LastChange`)      |
| `toStore`                             | The primitive underneath: one `ReadonlySignalLike` to one Svelte store         |
| `busyStore(tracker)`                  | From an `EngineBusyTracker`: a store that is `true` while a query is in flight |

`getFilterEngine()` with no engine set above the component throws `FilterEngineConfigError` with code
`BINDING_ENGINE_NOT_PROVIDED`.

Hold the engine in plain or `$state.raw` state, never deep `$state`: Svelte's deep proxy wraps the engine object and
breaks the `@preact/signals-core` signals inside it, so filtering stops without an error.

`toStore` is exported rather than kept internal because a consumer composing their own derived state needs the same
bridge, and reimplementing it means getting the subscribe/unsubscribe lifetime right a second time.

## Documentation

Consumer guides live in the engine repository under `docs/guides/`:

- `extending_rules.md` — writing a custom `FilterRule` that survives serialization
- `json_config.md` — declaring filters as data, and why the format is safe to accept from a tenant
- `acceleration_tuning.md` — what the five `acceleration` toggles are worth, measured
- `worker_offload.md` — running the engine in a Web Worker

Project home: <https://filter-enginez.com>

Apache-2.0. See `LICENSE.md` and `NOTICE.md`, both included in this package.
