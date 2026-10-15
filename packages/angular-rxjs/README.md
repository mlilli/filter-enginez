# `@filter-enginez/angular-rxjs`

Angular dependency-injection bindings over `@filter-enginez/reactive-rxjs`.

**Browser-only.** Requires `@angular/core` ^22 and `rxjs` ^7.8 as peers.

---

## Install

```bash
pnpm add @filter-enginez/angular-rxjs
```

Peer dependencies: `@angular/core@^22.0.0`, `rxjs@^7.8.1` — supplied by your app.

## Why this package is so small

It exports two injection tokens, three provider factories, and two `inject` helpers. That is the entire public surface,
and the smallness is the point.

Every other framework binding in this monorepo exists to bridge a reactivity primitive:

| Package            | Bridges                                                     |
| ------------------ | ----------------------------------------------------------- |
| `react-signals`    | `@preact/signals-core` → `useSyncExternalStore`             |
| `svelte-signals`   | `@preact/signals-core` → Svelte's `Readable` store contract |
| `vue-signals`      | `@preact/signals-core` → `shallowRef`                       |
| **`angular-rxjs`** | **nothing — Angular already speaks `Observable`**           |

`@filter-enginez/reactive-rxjs` publishes `Observable`s. Angular consumes `Observable`s natively via the `async` pipe,
and converts them to signals with `toSignal` when a component wants that. There is no impedance mismatch to absorb, so
this package doesn't invent a wrapper type, doesn't re-export the streams, and doesn't choose `async` pipe vs `toSignal`
on the app's behalf.

What Angular _does_ need is a way to get a booted engine into components without threading it through every `@Input`.
That is dependency injection, and that is all you'll find here.

---

## Usage

### Provide

The engine boot is app-specific (it loads a corpus, and may initialize acceleration), so the app owns it and hands the
finished engine to the injector as a value:

```ts
// app.config.ts — main.ts passes this to bootstrapApplication(AppComponent, appConfig)
import { createFilterEngine } from '@filter-enginez/core';
import type { Book } from '@filter-enginez/mock-data/books';
import { createEngineBusyStream, createRxJsEngine } from '@filter-enginez/reactive-rxjs';
import { provideEngineBusy, provideFilterEngine } from '@filter-enginez/angular-rxjs';
import { type ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';

declare const books: readonly Book[]; // your corpus

const core = createFilterEngine<Book>({ sourceData: books });

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideFilterEngine(createRxJsEngine(core)),
    provideEngineBusy(createEngineBusyStream()),
  ],
};
```

### Consume — `async` pipe (the default)

```ts
import { injectFilterEngine } from '@filter-enginez/angular-rxjs';
import type { Book } from '@filter-enginez/mock-data/books';
import { AsyncPipe } from '@angular/common';
import { Component } from '@angular/core';

@Component({
  selector: 'fe-results-header',
  template: `
    <span class="fe-results__count">{{ resultCount$ | async }}</span>
  `,
  imports: [AsyncPipe],
})
export class ResultsHeaderComponent {
  private readonly engine = injectFilterEngine<Book>();
  protected readonly resultCount$ = this.engine.resultCount$;
}
```

### Consume — `toSignal` (also legal, and here's why)

```ts
import { injectFilterEngine } from '@filter-enginez/angular-rxjs';
import type { Book } from '@filter-enginez/mock-data/books';
import { Component } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
  selector: 'fe-results-header',
  template: `
    <span class="fe-results__count">{{ resultCount() }}</span>
  `,
})
export class ResultsHeaderComponent {
  private readonly engine = injectFilterEngine<Book>();
  protected readonly resultCount = toSignal(this.engine.resultCount$, { requireSync: true });
}
```

`requireSync: true` throws at construction unless the source emits synchronously on subscribe. It is safe here because
of `reactive-rxjs`'s **replay contract**: every stream is a `BehaviorSubject` seeded from live engine state, piped
through `distinctUntilChanged()` and `shareReplay({ bufferSize: 1, refCount: false })`. So there is always a current
value to hand over.

The one exception is `events$`, which has no seed — it is a notification stream, not state, and emits nothing before the
first engine change. Never `toSignal(events$, { requireSync: true })`.

### Writes

Identical to every other framework binding. The read surface differs per framework; the write surface never does.

```ts
import { InSetRule } from '@filter-enginez/core';
import type { Book, BookGenre } from '@filter-enginez/mock-data/books';
import type { RxJsEngine } from '@filter-enginez/reactive-rxjs';

declare const engine: RxJsEngine<Book>; // e.g. injectFilterEngine<Book>()
declare const selected: readonly BookGenre[];

engine.core.addRule('genre', new InSetRule('genre', selected));
```

---

## API

| Export                       | Kind                       | Notes                                                                           |
| ---------------------------- | -------------------------- | ------------------------------------------------------------------------------- |
| `FILTER_ENGINE`              | `InjectionToken`           | Holds `RxJsEngine<unknown>`; type recovered at the call site                    |
| `provideFilterEngine`        | `<T>(engine) => Provider`  | Value provider — the app owns boot and lifetime                                 |
| `provideFilterEngineFactory` | `<T>(factory) => Provider` | Lazy variant; the factory runs in an injection context (route-resolver pattern) |
| `injectFilterEngine`         | `<T>() => RxJsEngine<T>`   | Injection-context only                                                          |
| `ENGINE_BUSY`                | `InjectionToken`           | Holds the app-wide `EngineBusyStream`                                           |
| `provideEngineBusy`          | `(busy) => Provider`       | App-scoped so panel commits and the header agree                                |
| `injectEngineBusy`           | `() => EngineBusyStream`   | Injection-context only                                                          |

`InjectionToken` cannot be generic, so `FILTER_ENGINE` is declared over `unknown` and `injectFilterEngine<T>()`
re-applies the item type. The cast is safe because the token is populated through `provideFilterEngine` or
`provideFilterEngineFactory`, and both accept only a correctly-typed `RxJsEngine<T>`.

---

## Zoneless

The reference app (`@filter-enginez/examples-angular`) runs `provideZonelessChangeDetection()`. Nothing in this package
depends on that choice — but it composes cleanly with it, because `AsyncPipe` calls `markForCheck()` itself on every
emission and `toSignal` produces a real signal. Neither path needs `zone.js` to notice that engine state moved.

## See also

- `@filter-enginez/reactive-rxjs` — the stream surface itself, and the full replay-contract writeup
- `docs/architecture.md` §11.2 — the rxjs adapter's design

## Documentation

Consumer guides live in the engine repository under `docs/guides/`:

- `extending_rules.md` — writing a custom `FilterRule` that survives serialization
- `json_config.md` — declaring filters as data, and why the format is safe to accept from a tenant
- `acceleration_tuning.md` — what the five `acceleration` toggles are worth, measured
- `worker_offload.md` — running the engine in a Web Worker

Project home, with six live demos: <https://filterenginez.com>. Documentation site: <https://docs.filterenginez.com>.

Apache-2.0. See `LICENSE.md` and `NOTICE.md`, both included in this package.
