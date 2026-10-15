# Guide — Moving the engine into a Web Worker

> **Audience:** consumers with a corpus large enough that filtering on the main thread drops frames. Needs
> `@filter-enginez/worker-bridge`. The engine itself is unchanged — it is the same `FilterEngine`, running on a
> different thread, reached through a promise-returning mirror of its interface.

---

## The shape, in two files

**The worker** registers named factories. Each one builds and returns a real engine:

```ts
// wine.worker.ts
import { createFilterEngine, initializeBitmapAcceleration } from '@filter-enginez/core';
import type { Wine } from '@filter-enginez/mock-data/wine';
import { exposeFilterEngineWorker, type WorkerEngineFactory } from '@filter-enginez/worker-bridge';

// Your own corpus loader.
declare function loadCorpus(
  options: Readonly<Record<string, unknown>>,
  onProgress?: (loaded: number) => void,
): Promise<readonly Wine[]>;

const wineEngine: WorkerEngineFactory<Wine> = async (options, callbacks) => {
  await initializeBitmapAcceleration(); // ⚠ the worker needs its own init — see below
  const onProgress = callbacks?.['onProgress'] as ((loaded: number) => void) | undefined;
  const wines = await loadCorpus(options, onProgress);

  return createFilterEngine<Wine>({ sourceData: wines });
};

exposeFilterEngineWorker({ wineEngine });
```

**The main thread** spawns the worker and wraps it:

```ts
import type { Wine } from '@filter-enginez/mock-data/wine';
import { wrapInWorker } from '@filter-enginez/worker-bridge';

declare function setLoaded(loaded: number): void;

const engine = await wrapInWorker<Wine>({
  worker: new Worker(new URL('./wine.worker.ts', import.meta.url), { type: 'module' }),
  factoryName: 'wineEngine',
  factoryOptions: { tier: 'full' },
  factoryCallbacks: { onProgress: (loaded) => setLoaded(loaded) },
  eagerly: ['getResults'],
});

const results = await engine.getResults();
```

`wrapInWorker` takes a **pre-spawned worker**, never a URL, and that is not a style preference. Vite, Webpack 5+ and
esbuild all detect workers by static analysis at the `new Worker(...)` site, and detection needs the argument to be a
literal inline expression. Pass a variable URL and the bundler serves your worker file as an ordinary ESM module — HMR
client injected, no worker chunk — and Comlink never wires up. So the spawn stays at your call site, where the bundler
can see it.

Options for the factory travel by `structuredClone`, so they must be plain data: pass functions (progress callbacks and
the like) through `factoryCallbacks`, which proxies them across the boundary.

---

## Register your custom rules on BOTH threads

This is the mistake that costs the most time, because it half-works.

Rules cross the postMessage boundary **serialized**, and both directions go through the registry:

- The **worker** needs the rule registered so `loadConfig` and `addRule` can revive it there.
- The **main thread** needs it registered too, because the reactive adapters mirror the worker's rule map back and
  rehydrate it through `ruleRegistry.deserialize` on arrival.

Miss the worker side and filtering breaks loudly. Miss the main-thread side and **filtering keeps working perfectly** —
the worker is doing it — while your rule is quietly omitted from the mirrored rule map, with one `console.warn` per rule
id. Any UI driven off the mirror (a chip list, a "clear filter" button, a devtools panel) shows a rule that isn't there,
and the results panel looks right the whole time.

So: `ruleRegistry.register('YourRule', YourRule)` at module scope in a module **both** entry points import. See
[`extending_rules.md`](./extending_rules.md) for the rule itself.

`PredicateRule` cannot cross the boundary at all — its config is a function. `addRule` with one throws
(`FilterEngineRuleError`, code `RULE_NOT_SERIALIZABLE`); the mirror omits it and says so once, which is why the warning
names `PredicateRule` explicitly. For a worker-hosted engine with non-serializable logic, write a registered subclass.

---

## WASM init happens per thread

`initializeBitmapAcceleration()` sets module-level state, and a worker has its own module graph. **Initializing on the
main thread does nothing for the worker.** Call it inside the factory, before `createFilterEngine`, as the example above
does.

Skip it and you get the silent fallback described in [`acceleration_tuning.md`](./acceleration_tuning.md) — except now
it is a slow predicate scan on a background thread, which is harder to notice, because the main thread stays responsive
and the symptom is only latency.

Conversely, if the engine lives **only** in the worker, the main thread does not need the init at all and should skip it
rather than pay for the WASM fetch.

---

## Make one round trip, not ten

Every call on the async surface is a postMessage round trip. A direct translation of main-thread code — results, then
indices, then rules, then per-slider bounds, then a simulate per chip — costs roughly **ten round trips** to render one
filter change, several of them in loops, and each waits on the one before.

Two methods exist to collapse that:

**`applyFiltersAndQuery(query?)`** returns a `FilterBundle` — the result indices and count, per-field bounds and
histogram buckets, and per-chip exclusion data — in **one** trip. It is the method to reach for whenever a filter change
needs more than one fact about the new state.

**`getFilteredFieldValuesExcept(ruleId, fieldKey)`** computes the all-rules-except-this-one projection on whichever
thread the engine lives on, instead of iterating the corpus on the main thread per slider per render (at 150k records
with four sliders, about 5.4M predicate evaluations per panel render).

Both return **transferable typed arrays** — `Uint32Array` for indices, `Float64Array` for field values, and the bundle's
`bucketEdges` / `counts`. The worker copies each array once into a buffer it can give away (so the engine's memoized
arrays stay intact) and marks it transferable, so the hand-off to the main thread moves ownership in constant time
instead of structured-cloning the data.

**The design consequence worth internalizing: batch by fact, not by call.** A worker-hosted engine rewards asking one
big question and punishes asking ten small ones, and the API is shaped to make the big question available.

---

## The async surface is not a 1:1 mirror

`FilterEngineAsync<T>` wraps almost all of `FilterEngine`'s methods in promises. The differences, all of them:

| Difference                        | Detail                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `computeResults()`                | **Absent.** No async equivalent — `getResultIndices()` is the transferable path        |
| `snapshot()`                      | **Absent** from the async surface                                                      |
| `destroy()`                       | **Async only** — tears down the proxy and (by default) terminates the worker           |
| 5 devtools methods                | **Async only**: action log, devtools state, jump-to-index, undo, redo                  |
| `getFilteredFieldValuesExcept(…)` | Returns `Float64Array`, not `readonly number[]`; `fieldKey` widens to `string`         |
| `loadConfig(config)`              | **No options parameter** — so no custom `registry`; register inside the worker instead |
| `exportConfig()`                  | **No options parameter** — so no `label` or `metadata`                                 |
| `subscribe(listener)`             | Returns `Promise<Unsubscribe>`; the facade wraps the listener in Comlink's `proxy()`   |

That `loadConfig` row is the one with teeth: the per-tenant registry isolation described in
[`json_config.md`](./json_config.md) is a main-thread facility. A worker-hosted engine resolves configs against the
worker's own module singleton.

A listener is a function, which cannot be cloned, so it crosses as a Comlink proxy. The facade's `subscribe` applies
`proxy()` for you, so a plain function is all it takes:

```ts
import type { ChangeEvent } from '@filter-enginez/core';
import type { Wine } from '@filter-enginez/mock-data/wine';
import type { FilterEngineAsync } from '@filter-enginez/worker-bridge';

declare const engine: FilterEngineAsync<Wine>;

const unsubscribe = await engine.subscribe((event: ChangeEvent) => {
  console.log(event.type);
});

await unsubscribe();
```

`proxy` and `transfer` are re-exported from `worker-bridge` for your own Comlink calls, so you don't take a direct
`comlink` dependency.

---

## A synchronous read right after a mutation is stale

This one is about correctness rather than performance, and it applies to consumers using the reactive adapters.

When an engine is worker-hosted, the main thread holds a **mirror** that updates a round trip behind the worker. So
`engine.core.getExpression()` — or `getResults()`, or `getRules()` — called immediately after a mutation returns the
state from _before_ the mutation. The mutation is in flight.

```tsx
import { and, inSet } from '@filter-enginez/core';
import type { Wine } from '@filter-enginez/mock-data/wine';
import { useExpression, useFilterEngine, useResultCount } from '@filter-enginez/react-signals';

// Rendered under a <FilterEngineProvider> whose engine came from createSignalsEngineFromAsync(asyncEngine).
export function RedWinesOnly(): React.JSX.Element {
  const engine = useFilterEngine<Wine>();
  // 🟢 Right: the hooks re-render this component when the mirror catches up.
  const expression = useExpression();
  const resultCount = useResultCount();

  const showRedOnly = (): void => {
    engine.core.setExpression(and(inSet('color', ['red'])));
    // 🔴 Wrong: still the expression from before the call — the write is on its way to the worker.
    const staleExpression = engine.core.getExpression();

    console.log(staleExpression);
  };

  return (
    <button disabled={expression !== null} onClick={showRedOnly} type="button">
      Red only ({resultCount})
    </button>
  );
}
```

Derive UI selection and derived state from local state and the reactive hooks (`useExpression`, `useResults`), never
from a synchronous `engine.core.*` read taken right after a mutation. The async methods on `FilterEngineAsync` are fine
— they await the actual round trip. It is the _synchronous mirror_ that lags.

The few synchronous queries only the worker can answer — `applyFiltersAndQuery()`, `simulate()`, `getResultIndices()`,
`computeResults()`, `getFilteredFieldValuesExcept()`, `exportConfig()`, `snapshot()`, `precomputeExclusions()` — throw
`FilterEngineModeError` (`MODE_WORKER_UNSUPPORTED`) on `engine.core`, and the message names the `engine.asyncEngine`
call to await instead.

---

## When to offload at all

`shouldEngageWorker(sourceDataLength, policy)` is the advisory helper:

```ts
import type { Wine } from '@filter-enginez/mock-data/wine';
import { DEFAULT_AUTO_THRESHOLD, shouldEngageWorker } from '@filter-enginez/worker-bridge';

declare const wines: readonly Wine[];

if (shouldEngageWorker(wines.length, 'auto')) {
  /* wrapInWorker */
}
```

`DEFAULT_AUTO_THRESHOLD` is **50,000**. Policies: `'auto'`, `'always'`, `'never'`, a number, or a boolean (`true` is
`'always'`, `false` is `'never'`).

**`'always'` deliberately does not check whether `Worker` exists.** `'auto'` and numeric policies return `false` when it
is undefined — Node, edge runtimes, jsdom — and fall back to the main thread. `'always'` returns `true` regardless, so
the subsequent `wrapInWorker` throws a real worker-construction error. That asymmetry is the documented intent: you
asked for a worker in an environment without one, and a clear throw beats a silent downgrade.

**The 50,000 figure is a reasoned estimate**, not a measurement: it marks roughly where a round trip stops costing more
than the main-thread work it removes, and the benchmark suite times in-process work only. Treat it as a starting point
and measure your own corpus — a numeric policy sets your own threshold.

Also worth saying plainly: **offloading does not make filtering faster.** It makes the main thread free. Total latency
for one query goes _up_ by the round trip. What you buy is a UI that keeps painting while the work happens, which is why
the threshold is about main-thread responsiveness rather than throughput.

---

## Lifecycle

`destroy()` releases the Comlink proxy and, by default, calls `worker.terminate()`. Set `terminateOnDestroy: false` only
when the worker does other work besides hosting this engine: a worker host keeps one engine for its lifetime, and a
second `init` on it — even after `destroy()` — throws `FilterEngineModeError` with code
`MODE_WORKER_ALREADY_INITIALIZED`. `destroy()` is idempotent; every other facade method rejects with
`FilterEngineDestroyedError` (`ENGINE_DESTROYED`) once it has run, instead of waiting on a worker that will never
answer.

**Errors keep their class across the boundary.** `wrapInWorker` and `exposeFilterEngineWorker` replace Comlink's error
serialization, so a rejection from the worker arrives as the same `FilterEngineError` subclass with its `name`, `code`,
`message`, worker-side stack and `cause` — `await engine.addRule(...)` in expression mode rejects with a real
`FilterEngineModeError`, and an unregistered rule type with a `RuleRegistryError`. An `Error` cause crosses too, rebuilt
as an `Error` with its name and message; a cause `postMessage` cannot clone is dropped. The full code list is in
`architecture.md` §2.5.

`eagerly` takes method names to call right after init, to pay a cold cost — a MinHash signature index, say — before the
user's first interaction instead of during it. **Pre-warm errors are swallowed on purpose:** the point is amortizing
cost, not validating correctness, and the real call will surface a persistent failure.

`wrapInWorker` waits for a `__filterEnginezWorkerReady` handshake before sending anything, because a message posted
before the worker's listener is wired is dropped (Vite's `?worker` dev mode shows it). A worker that fails to load or
evaluate — a wrong URL, a syntax error, an import that throws — fires `error` instead of the handshake, and
`wrapInWorker` rejects with a `FilterEngineError` whose code is `WORKER_LOAD_FAILED` (the error event as `cause`) and
terminates the worker. After the handshake, `error` and `messageerror` events are logged to the console.

A worker can host engines over different item types; each factory keeps its own type, and `exposeFilterEngineWorker`
infers the map:

```ts
import { createFilterEngine } from '@filter-enginez/core';
import type { Book } from '@filter-enginez/mock-data/books';
import type { Wine } from '@filter-enginez/mock-data/wine';
import { exposeFilterEngineWorker, type WorkerEngineFactory } from '@filter-enginez/worker-bridge';

declare const wines: readonly Wine[];
declare const books: readonly Book[];

const wineEngine: WorkerEngineFactory<Wine> = () => createFilterEngine<Wine>({ sourceData: wines });
const bookEngine: WorkerEngineFactory<Book> = () => createFilterEngine<Book>({ sourceData: books });

exposeFilterEngineWorker({ bookEngine, wineEngine });
```

---

## Checklist

- [ ] `initializeBitmapAcceleration()` **inside the worker factory**, not just on the main thread
- [ ] Custom rules registered on **both** threads, from a shared module
- [ ] Worker spawned at your own call site, inline, so the bundler sees it
- [ ] `applyFiltersAndQuery` instead of a cascade of reads
- [ ] No synchronous `engine.core.*` read right after a mutation
- [ ] Measure your own threshold rather than trusting 50,000
