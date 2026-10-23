# Filter EngineZ — Architecture

> **Status:** Living document. The implementation reference.
>
> **Companions:** the guides under [`guides/`](./guides/) (task-oriented usage) and each package's `README.md` (its
> public surface).
>
> **Started:** 2026-05-24
>
> **Scope:** Implementation reference for Filter EngineZ. Class hierarchies, exact TypeScript signatures, internal data
> flow, algorithm details, per-pattern mappings, performance characteristics, testing strategy. This document answers
> _how_.
>
> **Repository:** This repository holds the 13 engine packages; the example apps and their supporting packages live in
> [`filter-enginez-examples`](https://github.com/mlilli/filter-enginez-examples).
>
> **Code blocks:** Every TypeScript example compiles against the packages, and every implementation excerpt is verified
> verbatim against the source, by [`tests/tooling/docCodeBlocks.test.ts`](../tests/tooling/docCodeBlocks.test.ts). See
> §0.1.

---

## §0. How to Read This Document

The doc is organized **layer by layer, inside-out**: starting with the engine core, working outward through the
acceleration stack, reactive adapters, framework bindings, optional integrations, supporting infrastructure, and the
cross-cutting design patterns + performance + tooling concerns that span all of them.

If you're looking for:

- **An implementation question** — find the relevant subsystem section (§2-§17). Each has class signatures, data flow,
  and impl notes.
- **"Where does pattern X live?"** — §18 maps every design pattern to specific file paths.
- **Performance details** — §19 covers the acceleration stack composition and benchmark methodology.
- **Testing or build concerns** — §21 and §22 respectively.

### §0.1. How the code blocks are verified

🟢 Every fenced TypeScript block in this document is checked against the code by
[`tests/tooling/docCodeBlocks.test.ts`](../tests/tooling/docCodeBlocks.test.ts), in the `tooling` Vitest project. Each
block is one of two kinds:

- **Excerpts** show how the engine is built. Each is the exact text between `// #region docs:<id>` and
  `// #endregion docs:<id>` in the source file named by the `<!-- excerpt: <path>#<id> -->` marker above it in the
  Markdown source, compared line for line with only leading indentation normalized. Comments are part of the region, so
  an excerpt carries the code's own TSDoc.
- **Examples** show how a consumer or an extender calls the packages. Each compiles as a standalone module against
  `packages/*/src` with the repository's strict compiler options, and `@filter-enginez/*` imports resolve through each
  package's `exports` map, exactly as they would for a consumer. Anything a reader supplies — their data, an engine
  built elsewhere — is declared visibly in the block.

An example never re-declares a type, class or function the packages declare; showing a real declaration is what an
excerpt is for. Content that is not TypeScript — directory trees, data-flow diagrams, JSON — is fenced as `text` or
`json`. The same guard covers the guides under [`guides/`](./guides/), the root `README.md` and every package
`README.md`.

⚠ **Changing documented code.** Editing inside a `docs:` region fails the guard until the excerpt is updated to match,
which is the point: the block and the code change together, in one diff a reviewer can read. A region that no document
excerpts fails too, so the markers cannot outlive their readers.

---

## §1. The Six Architectural Pillars — Deep-Dive

This section unpacks each of the six pillars into its concrete implementation implications.

### §1.1. Isomorphic Core

**The contract.** `core`, `reactive-signals`, `reactive-rxjs`, `redux-bridge`, `mock-data`, `svelte-signals` and
`worker-bridge` run in any modern JavaScript runtime: browsers, Node 24.18+, Cloudflare Workers, Deno, Vercel Edge, Bun.
Their default entry points reference no browser-only global — `window`, `document`, `localStorage`, `sessionStorage`,
`history`, `navigator`, `XMLHttpRequest`, DOM element and event classes, and the rest of the list in §17.1. Globals
every runtime provides (`URL`, `console`, timers) are fine.

**The enforcement.** Two layers:

1. **Lint-level**: the `nodeIsomorphic` ESLint preset turns on `@filter-enginez/no-browser-api-in-core` for these
   packages, so a browser-global reference fails CI. Browser-only sub-paths (`**/browser/**`, `**/keyboard/**`) are
   exempt by design. (Implementation in §17.1.)
2. **Runtime-level**: `tests/tooling/isomorphicEntries.test.ts` imports every isomorphic package's default entry in the
   Node test environment — no `window`, no `document`, no `localStorage` — so a module that touches a browser API at
   load time, directly or through a dependency, fails there. The package list is derived from which packages apply the
   `nodeIsomorphic` preset, so a new isomorphic package is covered the day it opts in. CI runs it with the rest of the
   suite.

Type-checking uses the default ES + DOM libraries: the browser sub-exports (`core/storage/browser`,
`core/keyboard/browser`) and the worker-facing adapters need DOM and Worker types, so the boundary is held by the two
layers above rather than by the `lib` setting. Core modules that need a host API outside ES2022 (`console`,
`setTimeout`) declare the minimal contract inline instead of relying on the DOM lib.

**Browser concerns escape via sub-exports.** Where a package needs browser capabilities, they live in a clearly- flagged
sub-path. Example for `core/storage/browser`:

```json
// packages/core/package.json (abridged)
{
  "name": "@filter-enginez/core",
  "type": "module",
  // In the workspace, every entry point resolves to its TypeScript source.
  "exports": {
    ".": "./src/index.ts",
    "./keyboard/browser": "./src/keyboard/browser/index.ts",
    "./similarity": "./src/similarity/index.ts",
    "./storage/browser": "./src/storage/browser/index.ts",
    "./suggestions": "./src/suggestions/index.ts"
  },
  // On publish, the same sub-paths point at the compiled output.
  "publishConfig": {
    "exports": {
      ".": {
        "types": "./dist/index.d.ts",
        "default": "./dist/index.js"
      },
      "./storage/browser": {
        "types": "./dist/storage/browser/index.d.ts",
        "default": "./dist/storage/browser/index.js"
      }
      // ...plus ./keyboard/browser, ./similarity and ./suggestions, same shape
    },
    "types": "./dist/index.d.ts"
  }
}
```

Consumers do `import { LocalStorageAdapter } from '@filter-enginez/core/storage/browser'` and opt in deliberately. The
default entry point stays Node-clean.

**What this buys.** Filter EngineZ runs at the edge, in serverless functions, in pre-rendering builds, in CLI tools, and
in test environments without jsdom.

### §1.2. Adapter + Facade (Gang-of-Four Bridge)

**The pattern.** The core exposes a minimal imperative API + a plain `subscribe(callback)` mechanism. Public reactive
surfaces (signals, RxJS) are independent adapter packages that wrap the core. Engine abstraction varies independently
from reactive-surface implementation — textbook Bridge.

**Three layers where Bridge recurs.**

1. **Engine ↔ reactive surface**: `FilterEngine` is the abstraction; `reactive-signals` and `reactive-rxjs` are
   implementations.
2. **React binding ↔ reactive surface**: `react-signals` bridges React to the signals surface; `react-rxjs` bridges
   React to RxJS.
3. **Rule ↔ evaluator**: every rule's predicate evaluation can be performed by the bitmap engine OR the predicate
   engine; the rule doesn't know which.

**Why this matters at implementation time.** A feature is implemented once, in `core`'s imperative + subscribe API.
Writes reach every reactive surface through `.core`; new readable state is exposed by the adapters mirroring it from the
`ChangeEvent`s they already subscribe to — one mirrored field per surface, not a second implementation of the feature.

**Reading order for engineers.** When debugging a reactive flow, trace through `core/subscribe` first, then walk outward
to the adapter to see how the event is lifted, then to the React hook to see how it's consumed. Start at the source of
truth rather than the hook.

### §1.3. Composition Over Inheritance

**The contract.** No deep inheritance hierarchies anywhere in the codebase. The single abstract class with descendants
is `FilterRule` (extended by the 15 concrete rule classes, `CompositeRule`, and consumer-supplied subclasses).
Everything else composes.

**What this means in practice.**

- The `FilterEngine` is a single class composed of fields holding sub-objects (the signal store, the dispatcher,
  devtools, and the three acceleration objects). It does not extend a `BaseEngine` or implement a templated abstract.
  The rule registry is a shared module-level instance (`ruleRegistry`), not an engine field.
- The acceleration stack is three composed objects (`BitmapIndex`, `ExclusionGraph`, `SimulationCache`), each with their
  own interface and each exposed as its own `FilterEngine` field. None inherit from each other.
- Adapters are composed wrappers, not subclass overrides. `createSignalsEngine` returns a `SignalsEngine` that
  _contains_ a `FilterEngine` (`.core`), not one that _is-a_ engine.
- Devtools is a composed sidecar, not a mixin. The engine calls `devtools.recordAction` after every action.

**Why this matters.** Composition lets new behavior arrive as a small object added to an existing class, rather than as
another subclass that duplicates its parent's wiring.

### §1.4. Custom Signals-Based Internal Store + Action Log

**The architecture.** Internal state lives in `@preact/signals-core` signals. Every state mutation is a typed action,
applied by the dispatcher and recorded on a bounded action log (oldest entries evicted first). The action log feeds
devtools (time-travel + diff + replay) and is bridged to the Redux DevTools browser extension via its JSON-RPC protocol
— _without_ a Redux runtime dependency.

**Why this combination.** Signals give us fine-grained reactivity (the right tool for filter cascades and derived
options). The action log gives us inspectability (the killer feature of Redux DevTools). Combining them gives us the
best of both worlds — signals for the _runtime_, action log for _dev introspection_ — at the cost of ~1.5KB (signals) +
~200 LOC (action log + DevTools bridge).

**Critical implementation note.** Every public mutator goes through one funnel in `FilterEngine`, so no state change
escapes the log. Writing a signal directly (`someSignal.value = X`) bypasses the action log and the change events, and
is never done outside the store, the dispatcher and the devtools restore path:

<!-- excerpt: packages/core/src/FilterEngine.ts#dispatch-and-emit -->
<!-- prettier-ignore -->
```ts
/**
 * Dispatch an action AND emit the corresponding change event: capture the pre-action
 * snapshot, invalidate the acceleration caches the action affects, mutate the store via the
 * dispatcher (one batched write), re-warm an `'eager'` exclusion graph, record the action with
 * both snapshots into devtools (for time-travel + Redux DevTools), then notify subscribers.
 *
 * Caches are dropped BEFORE the write so that a signal effect reacting to the write — which
 * runs when the dispatcher's batch ends — can never read a bitmap built for the old state.
 * With `devtools.enabled: false` no snapshots are captured at all.
 */
private _dispatchAndEmit(action: Action, event: ChangeEvent): void {
  const previousSnapshot = this.devtools.enabled ? captureSnapshot(this.store) : null;
  const shouldWarmExclusions = invalidateForAction(this.bitmapIndex, this.exclusionGraph, action);

  this.simulationCache.invalidate(action);
  this.dispatcher.dispatch(action);
  if (shouldWarmExclusions) {
    this._maybeWarmExclusionGraph();
  }
  if (previousSnapshot !== null) {
    this.devtools.recordAction(action, previousSnapshot, captureSnapshot(this.store));
  }
  this._emit(event);
}
```

`_dispatchAndEmit`, the funnel: (a) captures the pre-action snapshot (when devtools are enabled), (b) drops the bitmap,
exclusion-graph and simulation caches the action affects — before the write, so nothing reacting to the write can read a
cache built for the old state, (c) hands the action to the dispatcher, which applies it in one batched write, (d)
re-warms an `'eager'` exclusion graph, (e) records the action with both snapshots — which also forwards it to the Redux
DevTools bridge and schedules persistence — and (f) notifies subscribers. The dispatcher's own job is (c) alone.

§3 covers the dispatcher implementation in full.

### §1.5. Three-Layer Acceleration Stack

**The composition.** Three layers, each cheap on its own, each composing:

1. **Roaring Bitmaps** — one compressed bitmap per active rule. Filter intersection = bitwise AND across bitmaps: 0.02
   ms over the 10k synthetic wine tier and 0.42 ms over the 150k tier, with warm bitmaps (`benchmarks/RESULTS.md`, run
   of 2026-10-15).
2. **Mutual Exclusion Graph** — pre-computed pairwise table of rules that share zero items. Lazy by default;
   `engine.precomputeExclusions()` warms it, and `acceleration.exclusionGraph: 'eager'` keeps it warm.
3. **Memoized Simulation** — `simulate({ withRule: X })` results cached in an LRU (100 entries), keyed by the
   hypothetical rule's serialized form (object identity for rules that cannot serialize). Every state change — each
   dispatched action and each time-travel restore — clears it.

**Why this is one architecture and not three optimizations.** Each layer makes the next cheaper. The bitmap layer makes
intersection fast, so simulation per option becomes a bitmap build plus an AND. The exclusion graph answers "do these
two rules share any item?" in O(1) once built. The memoization layer returns the answer outright when the same
hypothetical is asked again. Measured over 40 options on a 10k corpus (`benchmarks/RESULTS.md`, `simulate-per-option`):
27.6 ms on the predicate path, 9.9 ms with bitmaps, 0.09 ms from the cache.

§6 covers each layer's implementation.

### §1.6. Three-Pass Implementation Cadence

**The discipline.** Each change lands in three reviewed steps:

- **Signatures** — classes, methods and properties with full TSDoc, reviewed while the API is cheapest to change.
- **Implementation** — bodies filled in, docs updated as the shape settles.
- **Tests** — 100% coverage of public API and business-logic branches. Genuinely unreachable defensive paths
  (`typeof window === 'undefined'` guards, exhaustive-switch throws) carry a `/* v8 ignore … -- reason */` comment.

**Why this order.** Reviewing signatures first surfaces awkward APIs while a change is trivial; tests written last pin a
settled shape rather than churning with it.

---

## §2. The Core Engine

### §2.1. Module structure

The non-test `.ts` files under `packages/core/src`, by directory. Per-directory `index.ts` barrels are listed without
annotation — each re-exports its own directory and nothing else.

```text
packages/core/src/
├── index.ts                    # Public API barrel — what consumers import
├── FilterEngine.ts             # The main FilterEngine class
├── FilterEngineOptions.ts      # Construction options — acceleration, storage, devtools
├── createFilterEngine.ts       # Factory function (Facade)
├── applyFiltersAndQuery.ts     # Single-pass bundle algorithm (results + facets in one walk)
├── filteredFieldValuesExcept.ts # The "all rules but one" field projection behind getFilteredFieldValuesExcept
├── queryBundle.ts              # FilterBundleQuery / FilterBundle types — the bundle wire shape
├── types.ts                    # Shared types — RuleId, ChangeEvent, etc.
├── types/
│   └── rbush.d.ts              # Type-only stub for the untyped rbush dependency (wired in via `paths`)
├── errors/
│   ├── index.ts
│   ├── FilterEngineError.ts    # Base class: `code` + `cause`, a name that survives minification
│   ├── FilterEngineConfigError.ts
│   ├── FilterEngineRuleError.ts
│   ├── FilterEngineModeError.ts
│   ├── FilterEngineDestroyedError.ts
│   └── codes.ts                # The code unions, one per class (§2.5)
├── rules/
│   ├── index.ts
│   ├── FilterRule.ts           # Abstract base
│   ├── ValueRule.ts
│   ├── BooleanRule.ts
│   ├── RangeRule.ts
│   ├── NumericComparisonRule.ts
│   ├── InSetRule.ts
│   ├── InSetofSetsRule.ts
│   ├── TextSearchRule.ts
│   ├── FuzzySearchRule.ts
│   ├── RegexRule.ts
│   ├── DateRangeRule.ts
│   ├── HierarchicalRule.ts
│   ├── GeoProximityRule.ts
│   ├── ExistsRule.ts
│   ├── PredicateRule.ts
│   ├── BloomMembershipRule.ts  # The 15th rule — probabilistic pre-screen (§4.3, §8a.1)
│   ├── CompositeRule.ts
│   ├── factories.ts            # range(), inSet(), text(), geo() — RULE constructors
│   ├── ruleTypeName.ts         # Reads a rule's declared, minifier-proof type name
│   ├── serializedConfig.ts     # Revives numeric bounds in deserialize hooks; JSON's null is an open bound (§9.3)
│   └── ruleRegistry.ts         # The central RuleRegistry
├── composition/
│   ├── index.ts
│   ├── FilterGroup.ts          # OR-within-group convenience composition
│   ├── composeFlatExpression.ts # Flat-map rules + filter groups → one expression
│   ├── ExpressionEvaluator.ts  # CompositeRule tree walker
│   ├── factories.ts            # and(), or(), not() — EXPRESSION constructors (see note)
│   └── simplify.ts             # Algebraic simplification
├── store/
│   ├── index.ts
│   ├── InternalStore.ts        # Signal-tree-based state owner
│   ├── Dispatcher.ts           # Typed action dispatcher
│   ├── Action.ts               # Action types
│   └── snapshots.ts            # Snapshot capture + restore
├── internals/
│   ├── index.ts
│   ├── BitmapIndex.ts          # Roaring Bitmaps per rule
│   ├── ExclusionGraph.ts       # Mutual exclusion graph
│   ├── SimulationCache.ts      # LRU-memoized simulation
│   ├── SpatialIndex.ts         # R-tree wrapper
│   ├── TextInvertedIndex.ts    # Roaring inverted text index — 5th axis (§8a.2)
│   ├── createAccelerationStack.ts # Builds + wires the acceleration axes; predicate/bitmap dispatch
│   ├── accelerationModes.ts    # Acceleration-mode vocabulary + auto-engagement thresholds
│   ├── invalidateForAction.ts  # Which caches an action invalidates, run before the write
│   ├── rejectCallsAfterDestroy.ts # Makes every public method throw ENGINE_DESTROYED after destroy()
│   ├── textPlan.ts             # Chooses index vs scan per text query
│   ├── fuzzyTrigramBound.ts    # Fuse-pinned trigram bound for FuzzySearchRule pre-filtering
│   ├── roaringInit.ts          # Loads roaring-wasm on demand: `import()`, then `roaringLibraryInitialize()`
│   └── types/
│       └── roaring-wasm.d.ts   # Ambient types for the WASM binding
├── similarity/
│   ├── index.ts
│   ├── MinHash.ts              # Signature computation
│   ├── LSH.ts                  # Locality-sensitive bucketing
│   ├── SimilaritySearch.ts     # findSimilar() orchestrator
│   └── attachSimilarity.ts     # Binds a SimilaritySearch to an engine — opt-in, see §8a
├── suggestions/                # opt-in via '@filter-enginez/core/suggestions'
│   ├── index.ts
│   ├── attachSuggestions.ts    # the memoized trio bag — see §8
│   ├── BayesianModel.ts        # Naive Bayes co-occurrence
│   ├── SessionTracker.ts       # Active-rule-set session recording
│   └── SuggestionEngine.ts     # Top-k suggestions
├── devtools/
│   ├── index.ts
│   ├── Devtools.ts             # Facade tying the log / time-travel / bridge together
│   ├── ActionLog.ts            # Bounded FIFO action log (§3.3)
│   ├── TimeTravel.ts           # jumpTo / undo / redo
│   ├── Diff.ts                 # State-diff (microdiff wrapper)
│   ├── Replay.ts               # Action replay
│   ├── ReduxDevtoolsBridge.ts  # JSON-RPC bridge to extension
│   ├── DevtoolsPersistence.ts  # Cross-reload persistence
│   └── snapshotCodec.ts        # Plain-JSON form of snapshots + log entries (extension, persistence)
├── keyboard/
│   └── browser/                # Browser-only sub-export (§12.3)
│       ├── index.ts
│       ├── undoRedoIntent.ts   # Keydown → 'undo' | 'redo' | null
│       └── attachUndoRedoKeyboard.ts # Binds the intent to a time-travel cursor
├── storage/
│   ├── index.ts
│   ├── StorageAdapter.ts       # Interface
│   ├── MemoryStorageAdapter.ts # Default
│   └── browser/
│       ├── index.ts            # Browser-only sub-export
│       ├── LocalStorageAdapter.ts
│       ├── SessionStorageAdapter.ts
│       └── IndexedDBAdapter.ts # For larger devtools persistence
├── lib/
│   ├── LRUCache.ts             # Doubly-linked-list LRU (SimulationCache)
│   ├── setOps.ts               # intersectionSet, unionSet, differenceSet
│   ├── internal.ts             # ~50 LOC of lodash replacements
│   ├── getPath.ts              # FieldExtractor string-path resolver
│   ├── BloomFilter.ts          # Bit-array primitive behind BloomMembershipRule
│   ├── murmur3.ts              # Hash used by BloomFilter + MinHash
│   ├── base64.ts               # Isomorphic encode/decode — no atob/btoa dependency
│   ├── geo.ts                  # Haversine + bounding-box math for GeoProximityRule
│   └── textTokens.ts           # Tokenizer shared by the text index + trigram bound
└── config/
    ├── index.ts
    ├── FilterEngineConfig.ts   # Config type
    ├── loadConfig.ts           # JSON config → engine state
    ├── exportConfig.ts         # Engine state → JSON config
    └── ConfigMigrator.ts       # Version migrations
```

**Note the two `factories.ts`.** `rules/factories.ts` builds RULES (`range`, `inSet`, `text`, `geo`);
`composition/factories.ts` builds EXPRESSIONS (`and`, `or`, `not`). Both are re-exported from the root barrel, so the
distinction is invisible at the import site and only matters when navigating the source.

Each subdirectory is a coherent concern. The root barrel re-exports the public surface, which deliberately includes the
building blocks the adapter packages compose — `InternalStore`, `Dispatcher`, the devtools classes and the acceleration
classes — so a custom reactive surface can be written outside this repository. Module-private helpers (the expression
composer, the snapshot codec, the per-action cache invalidation) are not exported.

### §2.2. Exact public API types

The full public surface of the default entry point. The listing is `packages/core/src/index.ts` itself, excerpted and
verified as described in §0.1:

<!-- excerpt: packages/core/src/index.ts#public-surface -->
<!-- prettier-ignore -->
```ts
// ─── Rule catalog (15 rules + composite + registry + factories) ────────────
export {
  type ArrayMatch,
  type ArrayMatchOptions,
  bloomMembership,
  BloomMembershipRule,
  type BloomMembershipRuleConfig,
  bool,

  BooleanRule,
  // Composite + composition operators
  CompositeRule,
  type CompositeRuleConfig,
  type CompositionOp,
  dateRange,
  type DateRangePreset,
  DateRangeRule,
  type DateRangeRuleConfig,
  exists,
  ExistsRule,
  // Abstract base
  FilterRule,
  fuzzy,
  FuzzySearchRule,
  type FuzzySearchRuleConfig,
  geo,
  type GeoCoords,
  GeoProximityRule,
  type GeoProximityRuleConfig,
  getRuleTypeName,
  haversineKm,
  hierarchical,
  HierarchicalRule,
  type HierarchicalRuleConfig,
  inSet,
  inSetofSets,
  InSetofSetsRule,
  type InSetofSetsRuleConfig,
  InSetRule,
  type InSetRuleConfig,
  numCompare,
  type NumericComparisonOp,
  NumericComparisonRule,
  type NumericComparisonRuleConfig,
  predicate,

  PredicateRule,
  type PredicateRuleConfig,
  range,

  RangeRule,
  type RangeRuleConfig,
  regex,
  RegexRule,

  type RegexRuleConfig,
  type RegexRuleSerializedConfig,
  resolvePreset,
  type RuleClass,
  // Registry
  ruleRegistry,
  RuleRegistry,
  RuleRegistryError,
  type RuleRegistryErrorCode,
  text,
  type TextSearchMode,
  TextSearchRule,
  type TextSearchRuleConfig,
  type TreeNode,
  // Factory functions (ergonomic constructors)
  value,
  // Concrete rule classes
  ValueRule,
} from './rules/index.js';

// ─── Composition (filter groups + and/or/not + evaluator + simplify) ──────
export {
  and,
  applyExpression,
  evaluateExpression,
  type FilterGroup,
  type FilterGroupCompositionMode,
  type FilterGroupInput,
  not,
  or,
  simplify,
} from './composition/index.js';

// ─── Storage (interface + memory adapter; browser adapters via sub-export) ─
export { MemoryStorageAdapter, type StorageAdapter } from './storage/index.js';

// ─── Internal store (types are public surface; classes exposed for adapters) ─
export {
  type Action,
  type ActionType,
  captureSnapshot,
  Dispatcher,
  type EngineMode,
  type EngineSnapshot,
  InternalStore,
  restoreSnapshot,
} from './store/index.js';

// ─── Devtools (action log, time-travel, diff, replay, Redux DevTools bridge) ─
export {
  ActionLog,
  type ActionLogEntry,
  type ActionLogEntryMeta,
  Devtools,
  type DevtoolsConfig,
  DevtoolsPersistence,
  type DevtoolsPersistenceConfig,
  diff,
  ReduxDevtoolsBridge,
  Replay,
  type ReplayOptions,
  type StateDiffEntry,
  TimeTravel,
} from './devtools/index.js';

// ─── Acceleration internals (BitmapIndex, ExclusionGraph, SimulationCache, R-tree) ─
export {
  type AccelerationMode,
  AUTO_BITMAP_THRESHOLD,
  BitmapIndex,
  ExclusionGraph,
  initializeBitmapAcceleration,
  isBitmapAccelerationReady,
  SimulationCache,
  SpatialIndex,
  type SpatialIndexMode,
  TEXT_INDEX_AUTO_THRESHOLD,
  type TextIndexMode,
  TextInvertedIndex,
} from './internals/index.js';

// ─── Shared types ───────────────────────────────────────────────────────────
export type {
  ChangeEvent,
  ChangeListener,
  FieldExtractor,
  FilterRuleAction,
  RuleId,
  SerializedRule,
  SimulationModification,
  SimulationResult,
  Unsubscribe,
} from './types.js';

// ─── Optional subsystems — NOT here, and deliberately ──────────────────────
//
//   similarity   → '@filter-enginez/core/similarity'   (attachSimilarity)   −1,764 B measured
//   suggestions  → '@filter-enginez/core/suggestions'  (attachSuggestions)  −657 B measured
//
// The caller constructs both (via the attach functions), so `FilterEngine` never imports them and
// consumers who never call them don't ship MinHash, LSH, a session tracker or a Bayesian model.
// Re-exporting either from this file would put those bytes back in every bundle while every other
// test stayed green. `index.test.ts` asserts their ABSENCE for that reason — if you are here to
// "restore a missing export", the export is not missing.

// ─── JSON-driven config (load / export / migrate) ──────────────────────────
export {
  type ConfigMigrationStep,
  ConfigMigrator,
  CURRENT_CONFIG_VERSION,
  defaultMigrator,
  exportConfig,
  type ExportConfigEngineSource,
  type ExportConfigOptions,
  type FilterEngineConfig,
  loadConfig,
  type LoadConfigEngineTarget,
  type LoadConfigOptions,
  resolveConfig,
  type ResolvedConfig,
  type SerializedExpressionNode,
  type SerializedFilterGroup,
} from './config/index.js';

// ─── Errors (one base class, four categories, a machine-readable `code`) ──
export {
  FilterEngineConfigError,
  type FilterEngineConfigErrorCode,
  FilterEngineDestroyedError,
  type FilterEngineDestroyedErrorCode,
  FilterEngineError,
  type FilterEngineErrorCode,
  FilterEngineModeError,
  type FilterEngineModeErrorCode,
  FilterEngineRuleError,
  type FilterEngineRuleErrorCode,
  type FilterEngineRuntimeErrorCode,
} from './errors/index.js';

// ─── Main engine class + factory ───────────────────────────────────────────
export { type AccelerationOptions, FilterEngine, type FilterEngineOptions } from './FilterEngine.js';
export { createFilterEngine } from './createFilterEngine.js';

// ─── Single-round-trip query bundle ─────────────────────────────────────────
export type {
  FilterBundle,
  FilterBundleChipCandidateMeta,
  FilterBundleChipGroupMeta,
  FilterBundleChipGroupQuery,
  FilterBundleFieldMeta,
  FilterBundleFieldQuery,
  FilterBundleQuery,
} from './queryBundle.js';

// ─── Lib helpers ────────────────────────────────────────────────────────────
export { BloomFilter, type BloomFilterOptions, type SerializedBloomFilter } from './lib/BloomFilter.js';
export { LRUCache, LRUCacheNode } from './lib/LRUCache.js';
export { differenceSet, intersectionSet, unionSet } from './lib/setOps.js';
export { getPath, parsePath } from './lib/getPath.js';
```

Anything not re-exported here is internal: package.json `exports` restricts consumers (including the workspace's own
adapter packages) to `.` plus the four sub-paths `./keyboard/browser`, `./similarity`, `./storage/browser` and
`./suggestions`.

Beyond the exported names, `FilterEngine` carries a few members worth knowing: `getResultIndices()` (the `Uint32Array`
positional projection of `getResults()`), `getFilteredFieldValuesExcept()` (the filtered-except-self projection powering
per-slider available-bounds), and `applyFiltersAndQuery()` — the single-round-trip method returning a `FilterBundle`
(results + per-field bounds + histograms + chip-exclusion metadata in one pass), whose shapes live in `queryBundle.ts`.
`AccelerationOptions` is defined in `FilterEngineOptions.ts` and re-exported from `FilterEngine.ts`.
`getResultIndices()` is memoized by the signal graph and computed through the Roaring-Bitmap path whenever that path is
exact (§6.1); `computeResults()` returns the same indices but recomputes them on every call, and
`precomputeExclusions()` builds the exclusion graph ahead of the first query. **Benchmark note:** `filter-intersection`
measures `computeResults()` (bitmap) against a fresh `applyFiltersAndQuery({})` predicate pass, never the memoized
`getResultIndices()`. See §19.

### §2.3. Internal state shape

The engine's mutable state lives in a single `InternalStore` object (see §3 for full impl). Its shape:

<!-- excerpt: packages/core/src/store/InternalStore.ts#internal-store-shape -->
<!-- prettier-ignore -->
```ts
/**
 * The engine's signal-tree state container. One instance per `FilterEngine`.
 *
 * @typeParam T - The item type the engine operates over
 */
export class InternalStore<T> {
  // ─── Writable signals — mutated only via Dispatcher ────────────────────

  /** The full source-data array — set by `setSourceData`, immutable from outside. */
  readonly sourceData: Signal<readonly T[]>;

  /**
   * Monotonically increasing version counter for `sourceData`. Bumped on every
   * `SOURCE_DATA_SET` action. Used as a cache key part for the acceleration stack
   * (bitmap index, similarity signatures, exclusion graph) so any source-data change
   * invalidates all derived caches in O(1).
   */
  readonly sourceDataVersion: Signal<number>;

  /**
   * The current working subset of source data. Defaults to source data; consumers can
   * substitute a pre-filtered subset via `setWorkingSet`. Independent version counter for
   * cache invalidation.
   */
  readonly workingSet: Signal<readonly T[]>;

  /** Monotonically increasing version counter for `workingSet`. */
  readonly workingSetVersion: Signal<number>;

  /** Map of currently-registered rules (flat-map mode). Immutable updates via Dispatcher. */
  readonly rules: Signal<ReadonlyMap<RuleId, FilterRule>>;

  /** Explicit expression tree (expression mode). Null in flat-map mode. */
  readonly expression: Signal<CompositeRule | null>;

  /** Registered filter groups (OR-within / AND-between convenience). */
  readonly groups: Signal<readonly FilterGroup[]>;

  /** The id of the last rule mutated. Powers the `lastChangeRuleId` UI affordance. */
  readonly lastChangeRuleId: Signal<RuleId | null>;

  /** Timestamp (Date.now()) of the last rule mutation. */
  readonly lastChangeTimestamp: Signal<number | null>;

  // ─── Computed signals — derived views ───────────────────────────────────

  /** Current evaluation mode: `'expression'` when expression is non-null, else `'flat-map'`. */
  readonly mode: ReadonlySignal<EngineMode>;

  /** All currently-registered rule IDs (keys of `rules`). */
  readonly activeRuleIds: ReadonlySignal<readonly RuleId[]>;

  /**
   * The current filtered results. Computed from `workingSet` + `effectiveExpression`, through the
   * installed results accelerator when it engages and the predicate evaluator otherwise.
   *
   * **Derived from `resultIndices`.** To keep a single source of truth for "which workingSet
   * positions pass the filter," `results` projects through `resultIndices` rather than running
   * its own filter pass. This guarantees `results[i] === workingSet[resultIndices[i]]` for
   * every i, which is the invariant the worker-bridge transferable-indices path
   * (`getResultIndices()`) relies on.
   */
  readonly results: ReadonlySignal<readonly T[]>;

  /**
   * Positional indices into `workingSet` for each item in `results`. The natural sibling of
   * `results` — same filter pass, different projection. Lives as a `Uint32Array` so it can be
   * `postMessage`-transferred to the main thread with zero copy when the engine is hosted
   * in a Web Worker (see `@filter-enginez/worker-bridge`'s `getResultIndices()` over the wire).
   *
   * @remarks
   * Why Uint32Array, not number[]: a 150k-record corpus has at most 150k indices × 4 bytes =
   * 600KB. That fits in a single transferable `ArrayBuffer`, which moves between threads in
   * constant time regardless of payload size — vs ~130MB of structuredClone work to ship the
   * full filtered Wine objects per filter tick.
   */
  readonly resultIndices: ReadonlySignal<Uint32Array>;

  /**
   * The effective expression, simplified (`composition/simplify`) — derived from `rules` +
   * `groups` in flat-map mode (see `composition/composeFlatExpression`) or from `expression` in
   * expression mode. `null` means no constraint: every working-set item passes.
   */
  readonly effectiveExpression: ReadonlySignal<FilterRule | null>;

  /** `results.length`. */
  readonly resultCount: ReadonlySignal<number>;

  /** The installed accelerator, or `null` for predicate-only evaluation. */
  private _resultsAccelerator: ResultsAccelerator | null = null;
```

**Why signals as the substrate.** Three reasons:

1. **Fine-grained reactivity** — when a single rule changes, only the `results` computed re-runs (and only its
   downstream subscribers re-fire). With a plain event emitter, every subscriber would receive every event and filter at
   the subscription level.
2. **Automatic dependency tracking** — `results = computed(() => applyFilters(...))` records its dependencies on read.
   No manual subscribe/unsubscribe. Cascading derived state (e.g.,
   `availableColors = computed(() => distinctColorsIn(results.value))`) Just Works.
3. **Cheap updates** — preact-signals' update mechanism is O(dependent-effects), implemented via a doubly-linked
   dependency graph, so a write costs in proportion to what actually depends on it.

**Why one store, not per-domain stores.** All engine state is one coherent thing — an in-flight filter operation — so a
single `InternalStore` holds it. Splitting it would create coordination problems the engine does not need.

### §2.4. Lifecycle

```text
createFilterEngine(options)
    │
    ├─ new InternalStore(sourceData)       the signal tree (§3.1)
    ├─ new Dispatcher(store)
    │
    ├─ new Devtools(store, dispatcher, options.devtools)       always constructed
    │      ├─ ActionLog, TimeTravel, Replay                     always; inert when enabled: false
    │      ├─ ReduxDevtoolsBridge   only when enabled (default) and bridgeToReduxDevtools (default)
    │      │                        — connects if the extension is present, otherwise inert
    │      └─ DevtoolsPersistence   only when enabled and a persistence block is given
    │
    ├─ createAccelerationStack(store, options.acceleration)
    │      └─ BitmapIndex, ExclusionGraph, SimulationCache — nothing is built yet;
    │         bitmaps build on first use, once the WASM module is initialized
    │
    ├─ store.setResultsAccelerator(bitmapIndex.tryComputeResults)
    │
    ├─ devtools.init(initial snapshot)    sends the initial state to the extension, subscribes to
    │                                     its scrub messages, starts loading the persisted log
    │                                     (`engine.devtools.ready` settles when it has)
    │
    ├─ loadConfig(options.config)         if given — dispatched like any other action
    │
    └─ warm the exclusion graph           only with acceleration.exclusionGraph: 'eager'

engine.destroy()                          idempotent
    │
    ├─ mark destroyed                     every other public method now throws ENGINE_DESTROYED
    ├─ drop every subscriber
    ├─ clear the acceleration caches      bitmaps, R-trees, text postings, exclusion graph, simulations
    └─ devtools.destroy()                 final persistence save, then disconnect the extension;
                                          a failed save is reported to devtools.onError, not thrown
```

Similarity and suggestions are not part of construction: `attachSimilarity(engine, config)`
(`@filter-enginez/core/similarity`) and `attachSuggestions(engine)` (`@filter-enginez/core/suggestions`) build them on
demand, memoized per engine in a `WeakMap`, so they become collectable with the engine and `destroy()` has nothing of
theirs to release.

**No singleton-per-process.** Every `createFilterEngine()` call returns a fresh, independent instance. This is a
deliberate anti-singleton pattern (§18). Multiple engine instances coexist (e.g., two filter panels on one page) without
interfering in their state. Two things are process-wide by nature and shared: the rule registry (`ruleRegistry`, so a
class registered once is revivable everywhere) and the Roaring WASM module's initialization.

### §2.5. Error handling

Every error the engine raises is a `FilterEngineError`. The class answers "is this the engine's failure or someone
else's?", one of four category subclasses narrows it to a family, and a readonly `code` names the exact case as a
string-literal union (`FilterEngineErrorCode`) that stays stable when a message is reworded. A wrapped failure — a
malformed `RegExp` source, an IndexedDB request error, a failed WASM fetch — rides along as the standard ES2022 `cause`,
passed through the `Error` options argument, so runtimes, test runners and error reporters print it without knowing
about the engine. All of it is exported from `@filter-enginez/core`'s main entry, and it is isomorphic.

<!-- excerpt: packages/core/src/errors/FilterEngineError.ts#filter-engine-error -->
<!-- prettier-ignore -->
```ts
/**
 * Base class of every error the engine raises.
 *
 * @remarks
 * Catch this to separate engine failures from everything else, then read {@link code} for the exact
 * case. It is thrown directly only for the runtime failures in `FilterEngineRuntimeErrorCode`;
 * every other failure uses one of the four category subclasses.
 *
 * The constructor resets the prototype from `new.target` so `instanceof` stays correct for consumers
 * who transpile to a target where subclassing `Error` loses the subclass prototype.
 *
 * @example
 *   try {
 *     engine.loadConfig(untrustedConfig);
 *   } catch (error) {
 *     if (error instanceof FilterEngineError) report(error.code, error.message, error.cause);
 *     else throw error;
 *   }
 */
export class FilterEngineError extends Error {
  /** Machine-readable failure identifier — stable across releases, unlike `message`. */
  readonly code: FilterEngineErrorCode;

  static {
    defineErrorName(this, 'FilterEngineError');
  }

  /**
   * @param code - The machine-readable failure identifier
   * @param message - Human-readable explanation, including how to fix it
   * @param options - Standard `Error` options; pass `{ cause }` when wrapping another failure
   */
  constructor(code: FilterEngineErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
    this.code = code;
  }
}
```

Each subclass narrows `code` to its own union and shares the base constructor shape `(code, message, options?)`.
`defineErrorName` pins every class's `name` on its prototype as a string literal, because a minifier rewrites class
identifiers and a `name` read from `constructor.name` would say `d` in production;
`tests/tooling/ruleTypeNamesSurviveMinification.test.ts` asserts the names against a real minified bundle.
`RuleRegistryError` (§9.1) is a `FilterEngineRuleError`, so existing `instanceof RuleRegistryError` checks and its three
`REGISTRY_*` codes are unchanged.

| Class                        | Code union                       | Thrown when                                                                                              |
| ---------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `FilterEngineConfigError`    | `FilterEngineConfigErrorCode`    | A config document, option object, URL-state payload, worker factory name or framework binding is invalid |
| `FilterEngineRuleError`      | `FilterEngineRuleErrorCode`      | A rule class or a serialized rule is unusable                                                            |
| `FilterEngineModeError`      | `FilterEngineModeErrorCode`      | The call is valid in general but not in the engine's current mode                                        |
| `FilterEngineDestroyedError` | `FilterEngineDestroyedErrorCode` | A method is called after `destroy()`                                                                     |
| `FilterEngineError` (itself) | `FilterEngineRuntimeErrorCode`   | The environment refused an operation or failed to load, or a devtools cursor is out of range             |

The full code list, by class:

| Code                              | Class                        | Raised by                                                                                                                                                                                                                          |
| --------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONFIG_UNKNOWN_RULE_ID`          | `FilterEngineConfigError`    | `loadConfig` / `resolveConfig`: an expression leaf names a rule id the document does not define                                                                                                                                    |
| `CONFIG_VERSION_UNSUPPORTED`      | `FilterEngineConfigError`    | `ConfigMigrator.migrate` (so `loadConfig` too): the document is newer than this engine                                                                                                                                             |
| `CONFIG_MIGRATION_MISSING`        | `FilterEngineConfigError`    | `ConfigMigrator.migrate`: no step is registered for an intermediate version                                                                                                                                                        |
| `BLOOM_FILTER_INVALID_OPTIONS`    | `FilterEngineConfigError`    | `new BloomFilter`, `BloomFilter.forCapacity`, `BloomFilter.deserialize`: a size, hash count or rate is out of range                                                                                                                |
| `BLOOM_FILTER_INVALID_PAYLOAD`    | `FilterEngineConfigError`    | `BloomFilter.deserialize`: `bits` is not base64 (decoder error as `cause`) or does not match `sizeBits`                                                                                                                            |
| `SIMILARITY_INVALID_OPTIONS`      | `FilterEngineConfigError`    | `new MinHash`, `new LSH`, or a similarity config with neither `attributes` nor `signatureFn`                                                                                                                                       |
| `SIMILARITY_NOT_CONFIGURED`       | `FilterEngineConfigError`    | A `SimilaritySearch` query before a config or the source-data accessors are set                                                                                                                                                    |
| `SIMILARITY_SIGNATURE_MISMATCH`   | `FilterEngineConfigError`    | `MinHash.jaccardEstimate`, `LSH.insert`, `LSH.queryCandidates`: a signature of the wrong length                                                                                                                                    |
| `URL_STATE_MALFORMED`             | `FilterEngineConfigError`    | `@filter-enginez/url-state-router` serializers' `decode`: a truncated, corrupt or untagged URL value (parser error as `cause`)                                                                                                     |
| `URL_STATE_UNKNOWN_SERIALIZER`    | `FilterEngineConfigError`    | `resolveSerializer` with a name that is not a built-in serializer                                                                                                                                                                  |
| `WORKER_FACTORY_NOT_FOUND`        | `FilterEngineConfigError`    | `exposeFilterEngineWorker`'s `init`, surfaced by `wrapInWorker`: no factory under that name                                                                                                                                        |
| `BINDING_ENGINE_NOT_PROVIDED`     | `FilterEngineConfigError`    | `useFilterEngine` (React, Vue) or `getFilterEngine` (Svelte) with no engine provided above the component                                                                                                                           |
| `REGISTRY_DUPLICATE`              | `RuleRegistryError`          | `ruleRegistry.register` with a type name already registered                                                                                                                                                                        |
| `REGISTRY_TYPE_NAME_MISMATCH`     | `RuleRegistryError`          | `ruleRegistry.register` with a class whose `ruleTypeName` is not the registered name                                                                                                                                               |
| `REGISTRY_UNKNOWN_TYPE`           | `RuleRegistryError`          | `ruleRegistry.get` / `deserialize` (so config loading, URL state and the worker tier) for an unregistered type                                                                                                                     |
| `RULE_TYPE_NAME_MISSING`          | `FilterEngineRuleError`      | `FilterRule.serialize` on a class that never declared `static readonly ruleTypeName`                                                                                                                                               |
| `RULE_NOT_SERIALIZABLE`           | `FilterEngineRuleError`      | `PredicateRule.serialize`: a predicate function has no serialized form                                                                                                                                                             |
| `RULE_INVALID_SERIALIZED_CONFIG`  | `FilterEngineRuleError`      | A rule's `static deserialize` hook (`RegexRule`, `BloomMembershipRule`, `DateRangeRule`, the numeric rules) or a persisted devtools snapshot: a payload that does not rebuild, or a bound not a number or `null`                   |
| `RULE_NOT_FOUND`                  | `FilterEngineRuleError`      | `BitmapIndex.getBitmap` for a rule id with no registered rule                                                                                                                                                                      |
| `MODE_EXPRESSION_ACTIVE`          | `FilterEngineModeError`      | `FilterEngine.addRule` while an expression is set — flat-map rules are ignored in expression mode, so the rule would never apply                                                                                                   |
| `MODE_WORKER_UNSUPPORTED`         | `FilterEngineModeError`      | A synchronous `engine.core` member a worker-backed engine has no main-thread mirror for (`applyFiltersAndQuery`, `simulate`, `getResultIndices`, the store internals, …; §11.2); the message names the async call to await instead |
| `MODE_WORKER_NOT_INITIALIZED`     | `FilterEngineModeError`      | A worker host method called before `init`                                                                                                                                                                                          |
| `MODE_WORKER_ALREADY_INITIALIZED` | `FilterEngineModeError`      | A second `init` on a worker host, which keeps one engine for its lifetime                                                                                                                                                          |
| `MODE_ACCELERATION_NOT_READY`     | `FilterEngineModeError`      | `BitmapIndex` or `TextInvertedIndex` building a bitmap before `initializeBitmapAcceleration()` has resolved; the engine checks readiness first and never raises it                                                                 |
| `ENGINE_DESTROYED`                | `FilterEngineDestroyedError` | Any public `FilterEngine` method, or any `wrapInWorker` facade method, after `destroy()`                                                                                                                                           |
| `ACCELERATION_INIT_FAILED`        | `FilterEngineError`          | `initializeBitmapAcceleration`: roaring-wasm or its WASM module failed to load (original error as `cause`), on that call and every later one                                                                                       |
| `DEVTOOLS_INDEX_OUT_OF_RANGE`     | `FilterEngineError`          | `TimeTravel.jumpTo`, `ActionLog.setCurrentIndex`: an index outside the action log                                                                                                                                                  |
| `STORAGE_UNAVAILABLE`             | `FilterEngineError`          | `IndexedDBAdapter` in a runtime without `indexedDB`                                                                                                                                                                                |
| `STORAGE_OPERATION_FAILED`        | `FilterEngineError`          | `IndexedDBAdapter` open, load, save or remove failed (the request's error as `cause`)                                                                                                                                              |
| `WORKER_LOAD_FAILED`              | `FilterEngineError`          | `wrapInWorker`: the worker fired `error` before its ready handshake — it failed to load or evaluate (the event as `cause`); the worker is terminated                                                                               |
| `DEVTOOLS_EXTENSION_FAILED`       | `FilterEngineError`          | Reported to `devtools.onError`, never thrown: the Redux DevTools extension threw (as `cause`), and the bridge disconnected                                                                                                         |
| `DEVTOOLS_PERSISTENCE_FAILED`     | `FilterEngineError`          | Reported to `devtools.onError`, never thrown: loading, saving or the final save of the persisted action log failed (as `cause`)                                                                                                    |

**Two rules carry behavior, not just a class.** `destroy()` stays idempotent and `engine.isDestroyed` reports it; every
other public method of a destroyed engine throws, because a destroyed engine has dropped its subscribers and flushed its
devtools, so a call that succeeded would change state nothing observes. The guard is applied to the class prototype by
`internals/rejectCallsAfterDestroy.ts`, which derives the method list rather than keeping one, so a method added later
is guarded the day it is written. `addRule()` in expression mode throws for the same reason: the rule would be accepted
and then ignored. `removeRule()` and `clearRules()` stay valid in expression mode, so clean-up always works, and
`loadConfig(engine, document, { clearExisting: false })` drops an active expression before adding rules when the
document carries an expression of its own.

**What is not a `FilterEngineError`.** Errors from consumer code pass through unchanged: a worker factory that throws, a
custom URL-state serializer, a predicate. Subscriber errors are caught and logged so one listener cannot break the
others. Devtools side channels — the Redux DevTools extension and action-log persistence — report their failures to
`devtools.onError` as `FilterEngineError`s instead of throwing them into the action that triggered them (§10.6, §10.7).

A consumer matches on the class for the family and on `code` for the case. `code` also works where `instanceof` cannot:
across two copies of the package in one bundle.

```ts
import {
  createFilterEngine,
  type FilterEngineConfig,
  FilterEngineConfigError,
  FilterEngineError,
  FilterEngineRuleError,
} from '@filter-enginez/core';

interface Wine {
  readonly color: string;
}

declare const wines: readonly Wine[];
declare const sharedConfig: FilterEngineConfig;
declare const showMessage: (text: string) => void;

const engine = createFilterEngine<Wine>({ sourceData: wines });

try {
  engine.loadConfig(sharedConfig);
} catch (error) {
  if (!(error instanceof FilterEngineError)) {
    throw error;
  }
  if (error instanceof FilterEngineConfigError && error.code === 'CONFIG_VERSION_UNSUPPORTED') {
    showMessage('This link was made by a newer version of the app.');
  } else if (error instanceof FilterEngineRuleError) {
    showMessage(`This link uses a filter this app does not know (${error.code}).`);
  } else {
    showMessage(error.message);
  }
}
```

**Across the worker boundary.** Comlink serializes a rejection as `{ message, name, stack }` and rebuilds a plain
`Error`, which would lose the class, the `code` and the `cause`. `exposeFilterEngineWorker` (worker side) and
`wrapInWorker` (main thread) both install a replacement for Comlink's `'throw'` transfer handler
(`worker-bridge/src/errorTransfer.ts`) before any message crosses. It writes `code` and `cause` as well — an `Error`
cause recursively, up to eight links; a primitive cause as-is; any other cause, which `postMessage` could not clone, is
dropped — and the main thread rebuilds the matching class by its pinned `name`, with the worker-side stack. So
`await asyncEngine.addRule(...)` in expression mode rejects with a real `FilterEngineModeError`, and a revival failure
inside the worker reaches the main thread as a `RuleRegistryError`. A thrown value that is not an `Error` keeps
Comlink's own behavior. After `destroy()`, every `wrapInWorker` facade method rejects with `FilterEngineDestroyedError`
at once, rather than calling into a released proxy or a terminated worker that never answers.

---

## §3. The Internal Store

### §3.1. Signal tree topology

```text
Writable signals — written only by the Dispatcher (and by a devtools restore)
├─ sourceData          Signal<readonly T[]>
├─ sourceDataVersion   Signal<number>                        bumped with every setSourceData
├─ workingSet          Signal<readonly T[]>                  sourceData until setWorkingSet
├─ workingSetVersion   Signal<number>                        bumped with every working-set change
├─ rules               Signal<ReadonlyMap<RuleId, FilterRule>>
├─ expression          Signal<CompositeRule | null>
├─ groups              Signal<readonly FilterGroup[]>
├─ lastChangeRuleId    Signal<RuleId | null>
└─ lastChangeTimestamp Signal<number | null>

Computed signals — derived, cached until a dependency changes
├─ mode                 ← expression                          'expression' when set, else 'flat-map'
├─ activeRuleIds        ← rules                               the keys of `rules`
├─ effectiveExpression  ← expression, rules, groups           the explicit tree, or rules + groups
│                                                             composed (composeFlatExpression);
│                                                             simplified either way; null = no filter
├─ resultIndices        ← effectiveExpression, workingSet     THE hot path: the results accelerator
│                                                             (bitmaps) when it can answer exactly,
│                                                             else one predicate pass → Uint32Array
├─ results              ← effectiveExpression, workingSet,    workingSet itself when unfiltered,
│                         resultIndices                       else workingSet projected by the indices
└─ resultCount          ← resultIndices                       resultIndices.length
```

Each signal is a small object with `.value` accessor and `.subscribe()` method. Computeds auto-track their dependencies
by recording which signals they read.

### §3.2. The dispatcher

<!-- excerpt: packages/core/src/store/Dispatcher.ts#dispatcher-apply -->
<!-- prettier-ignore -->
```ts
/**
 * Routes `Action` instances to the appropriate state mutations on an `InternalStore`.
 */
export class Dispatcher<T> {
  constructor(private readonly _store: InternalStore<T>) {}

  /**
   * Apply an action to the store. Equivalent to {@link Dispatcher.apply}; `FilterEngine` wraps
   * it with the recording and notification pipeline.
   *
   * @param action - The action to dispatch
   */
  dispatch(action: Action): void {
    this.apply(action);
  }

  /**
   * Apply an action to the store without logging it. Used by the devtools `Replay` module
   * (and internally by `dispatch`). The writes are batched: an action that touches several
   * signals (`RESET`, `SOURCE_DATA_SET`) is observed as one change, never a half-applied one.
   *
   * @param action - The action to apply
   */
  apply(action: Action): void {
    batch(() => {
      this._applyUnbatched(action);
    });
  }

  /** The per-action signal writes; always called inside {@link Dispatcher.apply}'s batch. */
  private _applyUnbatched(action: Action): void {
    const store = this._store;

    switch (action.type) {
      case 'EXPRESSION_SET': {
        store.expression.value = action.payload.expression;

        return;
      }
      case 'GROUP_ADDED': {
        store.groups.value = [...store.groups.value, action.payload.group];

        return;
      }
      case 'GROUP_REMOVED': {
        store.groups.value = store.groups.value.filter(
          (group) => group.id !== action.payload.groupId,
        );

        return;
      }
      case 'RESET': {
        store.rules.value = new Map();
        store.groups.value = [];
        store.expression.value = null;
        store.workingSet.value = store.sourceData.value;
        store.workingSetVersion.value = store.workingSetVersion.value + 1;
        store.lastChangeRuleId.value = null;
        store.lastChangeTimestamp.value = null;

        return;
      }
      case 'RULE_ADDED':
      case 'RULE_CHANGED': {
        const next = new Map(store.rules.value);

        next.set(action.payload.ruleId, action.payload.rule);
        store.rules.value = next;
        store.lastChangeRuleId.value = action.payload.ruleId;
        store.lastChangeTimestamp.value = Date.now();

        return;
      }
      case 'RULE_REMOVED': {
        const next = new Map(store.rules.value);

        next.delete(action.payload.ruleId);
        store.rules.value = next;
        store.lastChangeRuleId.value = action.payload.ruleId;
        store.lastChangeTimestamp.value = Date.now();

        return;
      }
```

**Why one Map, not one signal per rule.** A `Map<RuleId, FilterRule>` as a single signal lets the `rules` signal fire
once per rule mutation, which downstream computeds (results, exclusion graph) react to via single invalidation.
Splitting into per-rule signals would create N subscriber registrations and N invalidations per mutation.

**Why an immutable update (`new Map`) instead of mutating in place.** Signals track value identity, not deep equality.
Mutating the map in place would not trigger downstream invalidation. The `new Map` copy is O(rules) — small next to
anything downstream of it.

### §3.3. The action log

<!-- excerpt: packages/core/src/devtools/ActionLog.ts#action-log-append -->
<!-- prettier-ignore -->
```ts
/**
 * Optional metadata attached to an action log entry — useful for forensics / dev debugging.
 */
export interface ActionLogEntryMeta {
  /** Where the action originated from. */
  readonly source?: 'devtools' | 'engine' | 'redux-bridge' | 'replay' | 'url-state';
  /** Optional caller-supplied label for grouping or filtering. */
  readonly origin?: string;
}

/**
 * One entry in the action log — wraps an action with its before/after state.
 */
export interface ActionLogEntry {
  readonly action: Action;
  readonly meta?: ActionLogEntryMeta;
  readonly nextStateSnapshot: EngineSnapshot;
  readonly previousStateSnapshot: EngineSnapshot;
  readonly timestamp: number;
}

/**
 * Bounded chronological action log with time-travel-aware truncation.
 */
export class ActionLog {
  private _currentIndexInternal = -1;
  private readonly _entries: ActionLogEntry[] = [];

  /**
   * @param maxEntries - Maximum entries retained. Older entries are dropped FIFO on overflow.
   *                     Use `Infinity` for unbounded (dev only — production typically 100-500).
   */
  constructor(readonly maxEntries: number) {}

  /**
   * Append an entry to the log. If `currentIndex` is mid-log (user previously jumped
   * backward), future entries are first truncated. If the resulting length exceeds
   * `maxEntries`, the oldest entry is shifted out (currentIndex's conceptual position is
   * preserved relative to the new array).
   *
   * @param entry - The entry to append
   */
  append(entry: ActionLogEntry): void {
    // Truncate "future" entries if we were jumped backward before this append.
    if (this._currentIndexInternal < this._entries.length - 1) {
      this._entries.length = this._currentIndexInternal + 1;
    }

    this._entries.push(entry);

    if (this._entries.length > this.maxEntries) {
      this._entries.shift();
      // currentIndex stays at the same numeric value — the just-pushed entry is now at
      // (maxEntries - 1), which is where currentIndex points after the shift offset.
    } else {
      this._currentIndexInternal++;
    }
  }

  /**
   * Insert entries from an earlier session ahead of this session's entries — used when
   * `DevtoolsPersistence` finishes loading. The cursor shifts with the entries it pointed at
   * (or, on an empty log, lands on the last inserted entry), so the log reads as if the earlier
   * actions happened just before this session's. When the combined log would exceed
   * `maxEntries`, the oldest inserted entries are dropped.
   *
   * @param entries - Earlier entries, oldest first
   */
  prepend(entries: readonly ActionLogEntry[]): void {
    const room = Math.max(this.maxEntries - this._entries.length, 0);
    const kept = room >= entries.length ? entries : entries.slice(entries.length - room);

    this._entries.unshift(...kept);
    this._currentIndexInternal += kept.length;
  }

  /** Look up an entry by index. */
  get(index: number): ActionLogEntry | undefined {
    return this._entries[index];
  }

  /** Total number of entries currently retained. */
  get size(): number {
    return this._entries.length;
  }

  /** The current cursor — points at the most recently applied entry. -1 if empty. */
  get currentIndex(): number {
    return this._currentIndexInternal;
  }
```

**A bounded FIFO, not an LRU.** The log is a plain array: at `maxEntries` (default 100; `Infinity` for unbounded) the
oldest entry is dropped. Appending after a time-travel jump first truncates the entries after the cursor — the "future"
they described is no longer canonical. `prepend` places a persisted earlier session's entries ahead of this session's
(§10.7).

### §3.4. Snapshots

Snapshots are **shallow clones of the signal values** — the rules map is copied, the rules themselves are shared, and
the source data is not included (only its version counter is). Structure:

<!-- excerpt: packages/core/src/store/snapshots.ts#engine-snapshot -->
<!-- prettier-ignore -->
```ts
/**
 * Captured engine state at a point in time. Restorable via `restoreSnapshot`.
 */
export interface EngineSnapshot {
  readonly expression: CompositeRule | null;
  readonly groups: readonly FilterGroup[];
  readonly lastChangeRuleId: RuleId | null;
  readonly rules: ReadonlyMap<RuleId, FilterRule>;
  readonly sourceDataVersion: number;
  readonly workingSetVersion: number;
  readonly capturedAt: number;
}

/**
 * Capture the current state of the engine into an immutable snapshot.
 *
 * @param store - The internal store to snapshot
 * @returns A new `EngineSnapshot` with a fresh `capturedAt` timestamp
 */
export function captureSnapshot<T>(store: InternalStore<T>): EngineSnapshot {
  return {
    capturedAt: Date.now(),
    expression: store.expression.value,
    groups: [...store.groups.value],
    lastChangeRuleId: store.lastChangeRuleId.value,
    rules: new Map(store.rules.value),
    sourceDataVersion: store.sourceDataVersion.value,
    workingSetVersion: store.workingSetVersion.value,
  };
}
```

**Size profile.** A snapshot is a map of rule references plus a few scalars, so the in-memory log grows with the number
of rules, not the number of items. Persisted and bridged snapshots use their plain-JSON form (§10.7), sized by the
rules' serialized configs.

**Restore semantics.** `engine.devtools.jumpTo(idx)` sets the rules, expression, groups and last-changed-rule signals to
the snapshot's values in a single batched update (preact-signals' `batch(() => { ... })`), so effects fire once for the
whole restoration. The source data and working set are not part of a snapshot and are left as they are. The engine drops
its acceleration caches just before the restore and emits one `{ type: 'reset' }` change event after it.

### §3.5. Memory profile

What each structure holds and how it scales. Only the first five exist for every engine; the bitmap structures exist
once bitmaps are engaged, and the last two only after `attachSimilarity` / `attachSuggestions`.

| State              | Scales with                           | Notes                                                                                                                        |
| ------------------ | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `sourceData`       | a reference                           | The engine never copies the consumer's array                                                                                 |
| `rules` Map        | rules                                 | Copied (O(rules)) on each rule mutation                                                                                      |
| Action log         | `actionLogSize` (default 100) × rules | Two shallow snapshots per entry; a `setSourceData` entry references the array it set. Nothing with `devtools.enabled: false` |
| Simulation cache   | ≤ 100 results                         | Each holds a count and a 5-item sample; cleared on every state change                                                        |
| Result indices     | passing items                         | One `Uint32Array`, 4 bytes per passing item                                                                                  |
| Bitmap index       | rules × items, compressed             | One Roaring bitmap per active rule, plus an R-tree per geo field and postings per text field in use                          |
| Exclusion graph    | rule pairs                            | Adjacency sets; built only on query or `precomputeExclusions()`                                                              |
| MinHash signatures | items × `numHashes`                   | `Uint32Array` per item: 128 × 4 B × 10k items ≈ 5 MB at the defaults — the largest structure                                 |
| Bayesian model     | sessions (≤ 500) × rules per session  | Single and pairwise co-occurrence counts                                                                                     |

In worker-bridge mode the whole engine, with every structure above, lives in the worker; the main thread holds the
reactive adapter's mirror (active rules, expression, result indices or results).

---

## §4. The Filter Rule Catalog

### §4.1. The abstract `FilterRule` base

<!-- excerpt: packages/core/src/rules/FilterRule.ts#filter-rule-contract -->
<!-- prettier-ignore -->
```ts
/**
 * Abstract base for all filter rules. Subclass to create custom rule types.
 *
 * @remarks
 * Subclasses MUST:
 *   1. Define a typed `config` shape (replacing the base `unknown`)
 *   2. Provide an `action` predicate that consults `this.getFieldValue(item)` to test items
 *   3. Declare `static readonly ruleTypeName = '<TheirName>'` if they are to be serializable
 *      (see {@link FilterRule.ruleTypeName})
 *
 * Subclasses MAY:
 *   - Override `serialize()` for non-JSON-safe configs (e.g., RegExp, Date)
 *   - Register themselves with the global `ruleRegistry` to participate in JSON-config
 *     loading, URL-state round-trip, worker-bridge serialization, and devtools persistence
 */
export abstract class FilterRule {
  /**
   * The stable wire name for this rule class — what `serialize()` writes as `type` and what
   * `ruleRegistry.deserialize` looks up.
   *
   * @remarks
   * **Declare it as a literal, not annotated as `string`:**
   *
   * ```ts
   * class ContainsAllRule extends FilterRule {
   *   static override readonly ruleTypeName = 'ContainsAllRule';
   * }
   * ruleRegistry.register('ContainsAllRule', ContainsAllRule);
   * ```
   *
   * The literal type is what lets `ruleRegistry.register` reject a name that disagrees with the
   * class **at compile time** — an annotated `: string` widens it and gives that check nothing
   * to bite on.
   *
   * The wire name is never read from `this.constructor.name`, because a minifier rewrites class
   * identifiers: a production build would label `InSetRule` as `d` while the registry's keys
   * (string literals) stay intact, so nothing it serialized could be revived. See
   * `./ruleTypeName.ts` for the details.
   *
   * The base's own value is the sentinel for "this class never declared one". It is safe as a
   * sentinel because `FilterRule` is abstract and can never itself be registered.
   */
  static readonly ruleTypeName: string = 'FilterRule';

  /**
   * Rule-specific configuration. Subclasses narrow this to a specific shape.
   */
  abstract config: unknown;

  /**
   * How to pull the value-to-test out of an item.
   *
   * See {@link FieldExtractor} for the four supported forms (undefined / string path /
   * string-path array / function).
   */
  field: FieldExtractor;

  /**
   * The predicate. Subclasses override; the base default returns `true` (i.e., a no-op rule
   * matches every item).
   *
   * Receives both the item AND the rule itself so subclasses can access `config` via a typed
   * narrowing cast.
   */
  action: FilterRuleAction = (): boolean => true;

  /**
   * @param field - Optional FieldExtractor to install on construction. Subclasses' factory
   *                functions typically pass this through from consumer-friendly constructor
   *                arguments.
   */
  constructor(field?: FieldExtractor) {
    this.field = field;
  }
```

The lens-resolution helper subclasses call from `action`:

<!-- excerpt: packages/core/src/rules/FilterRule.ts#get-field-value -->
<!-- prettier-ignore -->
```ts
/**
 * Pull the field value out of an item using this rule's `FieldExtractor`. Intended for use
 * inside subclass `action` implementations.
 *
 * Resolution rules:
 *   - If `item` is null/undefined → `undefined`
 *   - If `field` is undefined → the item itself (item-as-value)
 *   - If `field` is a function → invoke with the item
 *   - If `field` is a string → resolve as a dotted/bracketed path via `getPath`
 *   - If `field` is a string array → try each path in order; return first defined match
 *
 * @param item - The item to extract from
 * @returns The extracted value, or `undefined` if not present
 */
protected getFieldValue(item: unknown): unknown {
  if (isNil(item)) {
    return undefined;
  }
  if (this.field === undefined) {
    return item;
  }
  if (typeof this.field === 'function') {
    return this.field(item);
  }
  if (typeof this.field === 'string') {
    return getPath(item, this.field);
  }

  // Array of paths — try each until we get a non-undefined value.
  for (const path of this.field) {
    const value = getPath(item, path);

    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}
```

**`prepareForCollection(collection)`** is the one optional hook beside `action`. Every engine pass that runs `action`
across a collection — the predicate results pass, a bitmap build, `applyFiltersAndQuery`, the filtered-except-self
projection, a simulation, `applyExpression` — first calls it with the collection it is about to iterate (through
`prepareRuleForCollection`, which skips a rule that lacks the method, such as one built against another installed copy
of `core`); a `CompositeRule` passes the call to its children. The base does nothing. A rule that answers faster for a
whole collection overrides it to work its answers out ahead of the per-item calls, and must still answer `action`
exactly for any item outside the prepared collection. `FuzzySearchRule` is the built-in that does (§4.3).

#### §4.1a. `ruleTypeName` — why the wire name is a declared static

`serialize()` writes `type: Class.ruleTypeName`, a string literal each rule class declares, and `ruleRegistry` looks
classes up by that same literal. The wire name never comes from `this.constructor.name`, because a minifier rewrites
class identifiers — `new InSetRule(…)` built by a production bundler would otherwise serialize as `type: "d"` — while
the registry's keys (`register('InSetRule', …)`) are string literals that are not rewritten. `@filter-enginez/core`
publishes unminified ESM and is minified by **the consumer's** bundler, which no flag of ours reaches, so the name has
to be independent of class identifiers.

**The contract, in three parts:**

1. Every serializable rule class declares `static override readonly ruleTypeName = '<Name>'` — as a **literal**, not
   annotated `: string`.
2. `getRuleTypeName(rule)` (`packages/core/src/rules/ruleTypeName.ts`) is the single reader. It never throws, because
   the worker bridge's devtools "args" column labels entries with it, and a label should never take the action log down.
   `serialize()` **does** throw for an undeclared class: a wire `type` nothing can revive is refused at the source, as
   `PredicateRule.serialize` refuses.
3. `ruleRegistry.register` enforces that the two agree — see its signature in §9.1. A disagreement, including a subclass
   that forgot the static and so inherited the base's `string`, is a **compile-time** error; a runtime
   `REGISTRY_TYPE_NAME_MISMATCH` covers JavaScript consumers and casts. **`NoInfer` is load-bearing:** without it
   TypeScript infers the type parameter from both arguments, the undeclared class contributes `string`, and the check
   would accept exactly the case it exists to reject.

**The guard is `tests/tooling/ruleTypeNamesSurviveMinification.test.ts`**, which bundles + minifies `core` through Vite
/ Rolldown (resolved through `vitest`) and asserts the round trip against the artifact. It is registry-driven, so a rule
added later is covered the day it is registered, and it carries a vacuity guard asserting the identifiers really were
mangled, so the test cannot pass by not minifying.

### §4.2. `FieldExtractor` — the functional lens

Two-line type, ten-line implementation, enormous decoupling power:

<!-- excerpt: packages/core/src/types.ts#field-extractor -->
<!-- prettier-ignore -->
```ts
/**
 * The `FieldExtractor` — a functional lens for pulling the value-to-test out of an item.
 *
 * Four forms, each useful for a different access pattern:
 *
 * - **`undefined`** — the item itself is the value (use when items are primitives)
 * - **`string`** — a dotted path resolved via `getPath` (`'address.city'`, `'tags[0]'`)
 * - **`string[]`** — multiple paths tried in order, returning the first non-undefined match
 *   (useful when a value could live at different paths in different items)
 * - **`(item) => unknown`** — arbitrary extractor function (the escape hatch for any access
 *   pattern the string forms can't express)
 *
 * Only the first three forms serialize. A function is written as the placeholder `'<function>'` by
 * `serialize()` / `exportConfig`, and revives as `undefined` — "the item itself" — so a rule that
 * travels through a config document, a URL, a worker or a server names its field by path. Where the
 * value needs computing, store it on the item and name that field.
 *
 * @example
 *   // Simple property:
 *   const f1: FieldExtractor = 'price';
 *
 *   // Nested:
 *   const f2: FieldExtractor = 'address.city';
 *
 *   // Multi-path fallback:
 *   const f3: FieldExtractor = ['mailingAddress.city', 'address.city'];
 *
 *   // Computed:
 *   const f4: FieldExtractor = (item) => (item as Wine).tastingNotes.join(' ');
 *
 *   // Item itself is the value:
 *   const f5: FieldExtractor = undefined;
 */
export type FieldExtractor =
  | string
  | ((item: unknown) => unknown)
  | undefined
  | readonly string[];
```

The `getPath()` helper, a dependency-free equivalent of lodash `get`:

<!-- excerpt: packages/core/src/lib/getPath.ts#get-path -->
<!-- prettier-ignore -->
```ts
/**
 * Resolve a string path against an object, returning the value at that path or `undefined`
 * if any segment of the path is missing.
 *
 * @example
 *   getPath({ a: { b: { c: 42 } } }, 'a.b.c')              // → 42
 *   getPath({ tags: ['x', 'y'] }, 'tags[1]')               // → 'y'
 *   getPath({ meta: { 'weird.key': 1 } }, 'meta["weird.key"]') // → 1
 *   getPath({ a: 1 }, 'b.c')                                // → undefined
 *
 * @param object - The object to traverse
 * @param path - The string path (dotted + bracketed)
 * @returns The value at the path, or `undefined` if not found
 */
export function getPath(object: unknown, path: string): unknown {
  if (object === null || object === undefined) {
    return undefined;
  }

  // Fast path for simple top-level keys with no dots or brackets.
  if (!path.includes('.') && !path.includes('[')) {
    return (object as Record<string, unknown>)[path];
  }

  const segments = parsePath(path);
  let cursor: unknown = object;

  for (const segment of segments) {
    if (cursor === null || cursor === undefined) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }

  return cursor;
}
```

`parsePath` handles `a.b.c`, `a.b[0].c` and `['weird key'].b`.

**Why this is a Lens.** A lens is a composable focus into nested data. Our `FieldExtractor` is a one-way lens (get only,
no set) with four forms — a path string, an array of fallback paths (the first that resolves to a defined value wins), a
function, or `undefined` for the item itself — and function lenses compose via function composition.

### §4.3. The 15 concrete rules — signatures + impl notes

Each rule subclass is small. The full catalog, each entry excerpted from the rule's source:

#### `ValueRule`

<!-- excerpt: packages/core/src/rules/ValueRule.ts#value-rule -->
<!-- prettier-ignore -->
```ts
/**
 * Filter items by exact equality against a configured value.
 *
 * @example
 *   // Items where `category === 'wine'`:
 *   engine.addRule('cat', new ValueRule<string>('category', 'wine'));
 *
 *   // Items where `inStock === true`:
 *   engine.addRule('avail', new ValueRule<boolean>('inStock', true));
 *
 *   // No-op rule (config is undefined, matches everything):
 *   engine.addRule('placeholder', new ValueRule('category', undefined));
 *
 * @typeParam V - The value type. Defaults to `unknown` for maximally flexible declaration.
 */
export class ValueRule<V = unknown> extends FilterRule {
  /**
   * Minifier-proof wire name — see {@link FilterRule.ruleTypeName}. Declared as a literal so
   * `ruleRegistry.register` can reject a key that disagrees with it at compile time.
   */
  static override readonly ruleTypeName = 'ValueRule';

  /**
   * The configured value to match. When `undefined`, the rule matches every item (no-op).
   */
  config: V | undefined;

  /** Passes when the field value strictly equals `config`; passes everything when `config` is `undefined`. */
  override action: FilterRuleAction = (item, rule): boolean => {
    const configValue = (rule as ValueRule<V>).config;

    if (configValue === undefined) {
      return true;
    }

    return configValue === this.getFieldValue(item);
  };

  /**
   * @param field - How to pull the value-to-test from each item
   * @param value - The value to match, or `undefined` for a no-op rule
   */
  constructor(field: FieldExtractor, value: V | undefined) {
    super(field);
    this.config = value;
  }
}
```

#### `BooleanRule` (typed boolean equality)

<!-- excerpt: packages/core/src/rules/BooleanRule.ts#boolean-rule -->
<!-- prettier-ignore -->
```ts
/**
 * Filter items by a boolean field equality.
 *
 * @example
 *   // Items where `available === true`:
 *   engine.addRule('available', new BooleanRule('available', true));
 */
export class BooleanRule extends FilterRule {
  /**
   * Minifier-proof wire name — see {@link FilterRule.ruleTypeName}. Declared as a literal so
   * `ruleRegistry.register` can reject a key that disagrees with it at compile time.
   */
  static override readonly ruleTypeName = 'BooleanRule';

  /** Passes when the field value is exactly `config`; passes everything when `config` is `undefined`. */
  override action: FilterRuleAction = (item, rule): boolean => {
    const { config: mustEqual } = rule as BooleanRule;

    if (mustEqual === undefined) {
      return true;
    }

    return this.getFieldValue(item) === mustEqual;
  };

  /** The configured boolean to match. `undefined` makes the rule a no-op. */
  config: boolean | undefined;

  /**
   * @param field - How to pull the boolean from each item
   * @param value - The boolean to match, or `undefined` for a no-op rule
   */
  constructor(field: FieldExtractor, value: boolean | undefined) {
    super(field);
    this.config = value;
  }
}
```

#### `RangeRule`

<!-- excerpt: packages/core/src/rules/RangeRule.ts#range-rule -->
<!-- prettier-ignore -->
```ts
/**
 * Configuration for `RangeRule`.
 */
export interface RangeRuleConfig {
  /** Lower bound, inclusive. Use `-Infinity` for unbounded-low; JSON writes it as `null`. */
  readonly min: number;
  /** Upper bound, inclusive. Use `Infinity` for unbounded-high; JSON writes it as `null`. */
  readonly max: number;
}

/** A constructor with `RangeRule`'s signature: `RangeRule` itself, or a subclass that keeps it. */
type RangeRuleClass = new (field: FieldExtractor, config: RangeRuleConfig) => RangeRule;

/**
 * Filter items by an inclusive numeric range.
 *
 * @example
 *   // Items where 20000 <= price <= 30000:
 *   engine.addRule('price', new RangeRule('price', { min: 20000, max: 30000 }));
 *
 *   // Items where rating >= 4:
 *   engine.addRule('rating', new RangeRule('rating', { min: 4, max: Infinity }));
 */
export class RangeRule extends FilterRule {
  /**
   * Minifier-proof wire name — see {@link FilterRule.ruleTypeName}. Declared as a literal so
   * `ruleRegistry.register` can reject a key that disagrees with it at compile time.
   */
  static override readonly ruleTypeName = 'RangeRule';

  config: RangeRuleConfig;

  /** Passes when the field value lies within `[min, max]`, both inclusive; a `null` or missing value fails. */
  override action: FilterRuleAction = (item, rule): boolean => {
    const value = this.getFieldValue(item);

    if (value === undefined || value === null) {
      return false;
    }
    const numericValue = value as number;
    const { max, min } = (rule as RangeRule).config;

    return numericValue >= min && numericValue <= max;
  };

  /**
   * @param field - How to pull the numeric value from each item
   * @param config - The inclusive min/max bounds
   */
  constructor(field: FieldExtractor, config: RangeRuleConfig) {
    super(field);
    this.config = config;
  }

  /**
   * Revive a `RangeRule` from its serialized form. `ruleRegistry.deserialize` calls this hook with
   * the registered class as `this`, so a subclass registered in its place revives as itself.
   *
   * @remarks
   * A `null` bound is an open one: `min` revives as `-Infinity` and `max` as `Infinity`. That is
   * what `JSON.stringify` writes for those values, so an open range keeps its meaning through
   * `exportConfig` → JSON → `loadConfig`, URL state and an HTTP request body. Any other config keys
   * are carried over unchanged.
   *
   * @param json - The serialized rule
   * @returns The revived rule, with both bounds numbers
   * @throws `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG` when `config` is not an
   *   object, or a bound is neither a number nor `null` (a string, a missing key, `NaN`)
   */
  static deserialize(this: RangeRuleClass, json: SerializedRule): RangeRule {
    return new this(
      revivedField(json),
      reviveBounds(json, { max: Number.POSITIVE_INFINITY, min: Number.NEGATIVE_INFINITY }),
    );
  }
}
```

#### `NumericComparisonRule`

<!-- excerpt: packages/core/src/rules/NumericComparisonRule.ts#numeric-comparison-rule -->
<!-- prettier-ignore -->
```ts
/**
 * The six supported comparison operators.
 */
export type NumericComparisonOp = '!=' | '<' | '<=' | '==' | '>' | '>=';

/**
 * Configuration for `NumericComparisonRule`.
 */
export interface NumericComparisonRuleConfig {
  readonly op: NumericComparisonOp;
  /** The number to compare against. An infinite value is written to JSON as `null`. */
  readonly value: number;
}

/** The six operators, for checking a serialized `op`. */
const NUMERIC_COMPARISON_OPS: readonly string[] = ['!=', '<', '<=', '==', '>', '>='] satisfies readonly NumericComparisonOp[];

/** A constructor with `NumericComparisonRule`'s signature: the class itself, or a subclass that keeps it. */
type NumericComparisonRuleClass = new (field: FieldExtractor, config: NumericComparisonRuleConfig) => NumericComparisonRule;

/**
 * Filter items by a numeric comparison.
 *
 * @example
 *   // Items where `rating >= 4`:
 *   engine.addRule('rating', new NumericComparisonRule('rating', { op: '>=', value: 4 }));
 *
 *   // Items where `year > 2020`:
 *   engine.addRule('year', new NumericComparisonRule('year', { op: '>', value: 2020 }));
 */
export class NumericComparisonRule extends FilterRule {
  /**
   * Minifier-proof wire name — see {@link FilterRule.ruleTypeName}. Declared as a literal so
   * `ruleRegistry.register` can reject a key that disagrees with it at compile time.
   */
  static override readonly ruleTypeName = 'NumericComparisonRule';

  override action: FilterRuleAction = (item, rule): boolean => {
    const fieldValue = this.getFieldValue(item);

    if (fieldValue === undefined || fieldValue === null) {
      return false;
    }
    const numericValue = fieldValue as number;
    const { op, value } = (rule as NumericComparisonRule).config;

    switch (op) {
      case '!=':
        return numericValue !== value;
      case '<':
        return numericValue < value;
      case '<=':
        return numericValue <= value;
      case '==':
        return numericValue === value;
      case '>':
        return numericValue > value;
      case '>=':
        return numericValue >= value;
    }
  };

  config: NumericComparisonRuleConfig;

  constructor(field: FieldExtractor, config: NumericComparisonRuleConfig) {
    super(field);
    this.config = config;
  }

  /**
   * Revive a `NumericComparisonRule` from its serialized form. `ruleRegistry.deserialize` calls this
   * hook with the registered class as `this`, so a subclass registered in its place revives
   * as itself.
   *
   * @remarks
   * A `null` value is an open one: `Infinity` under `<`, `<=`, `==` and `!=`, `-Infinity` under `>`
   * and `>=`. That is what `JSON.stringify` writes for an infinity, so `{ op: '<=', value: Infinity }`
   * keeps its meaning through `exportConfig` → JSON → `loadConfig`, URL state and an HTTP request
   * body. Any other config keys are carried over unchanged.
   *
   * @param json - The serialized rule
   * @returns The revived rule, with a numeric `value`
   * @throws `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG` when `config` is not an
   *   object, `op` is not one of the six operators, or `value` is neither a number nor `null`
   */
  static deserialize(this: NumericComparisonRuleClass, json: SerializedRule): NumericComparisonRule {
    const { op } = readRecord(json.config, `${json.type} config`);

    if (!NUMERIC_COMPARISON_OPS.includes(op as string)) {
      throw invalidConfig(`${json.type} config.op`, `one of ${NUMERIC_COMPARISON_OPS.join(' ')}`, op);
    }
    // `>` and `>=` are open toward -Infinity; `<`, `<=` toward Infinity, and `==` / `!=` compare
    // every finite value the same way against either infinity.
    const openValue = op === '>' || op === '>=' ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;

    return new this(revivedField(json), { ...reviveBounds(json, { value: openValue }), op: op as NumericComparisonOp });
  }
}
```

#### `InSetRule<V>`

<!-- excerpt: packages/core/src/rules/InSetRule.ts#in-set-rule -->
<!-- prettier-ignore -->
```ts
/**
 * Configuration for `InSetRule`.
 */
export interface InSetRuleConfig<V> {
  /** Array of allowed values. Empty array means "match anything." */
  readonly set: readonly V[];
  /**
   * How an array-valued field meets `set`: `'any'` (default) passes when at least one element is
   * in it, `'all'` when the array contains every value in it. Ignored for a non-array field.
   */
  readonly arrayMatch?: ArrayMatch;
}

/**
 * Filter items by membership in a configured set.
 *
 * @example
 *   // Items where varietal is 'pinot-noir' or 'chardonnay':
 *   const colors = new InSetRule<string>('varietal', ['pinot-noir', 'chardonnay']);
 *   engine.addRule('varietal', colors);
 *
 *   // Toggle a value in/out via the helper:
 *   colors.toggleSetValues(['cabernet']);  // adds 'cabernet' to set
 *   colors.toggleSetValues(['cabernet']);  // removes 'cabernet' from set
 *
 *   // An array field: venues that accept card OR cash, then venues that accept both:
 *   new InSetRule<string>('paymentMethods', ['card', 'cash']);
 *   new InSetRule<string>('paymentMethods', ['card', 'cash'], { arrayMatch: 'all' });
 *
 * @typeParam V - The element type. Defaults to `unknown`.
 */
export class InSetRule<V = unknown> extends FilterRule {
  /**
   * Minifier-proof wire name — see {@link FilterRule.ruleTypeName}. Declared as a literal so
   * `ruleRegistry.register` can reject a key that disagrees with it at compile time.
   */
  static override readonly ruleTypeName = 'InSetRule';

  config: InSetRuleConfig<V>;

  /**
   * @param field - How to pull the value-to-test from each item
   * @param initialSet - Initial set of allowed values (may be empty)
   * @param options - `arrayMatch` for array-valued fields; omitted, they match `'any'`
   */
  constructor(field: FieldExtractor, initialSet: readonly V[] = [], options: ArrayMatchOptions = {}) {
    super(field);
    this.config = options.arrayMatch === undefined
      ? { set: [...initialSet]}
      : { arrayMatch: options.arrayMatch, set: [...initialSet]};
  }

  /**
   * Passes when the field value is in `config.set` (an array field: per `config.arrayMatch`); an
   * empty set passes everything.
   */
  override action: FilterRuleAction = (item, rule): boolean => {
    const { arrayMatch, set } = (rule as InSetRule<V>).config;

    if (set.length === 0) {
      return true;
    }
    const value = this.getFieldValue(item);

    return Array.isArray(value)
      ? matchesArraySelection(value, set, arrayMatch, isSameValueZero)
      : set.includes(value as V);
  };

  /**
   * Toggle one or more values in/out of the set via symmetric difference (xor) semantics.
   *
   * For each value in `values`:
   *   - If currently in the set → remove it
   *   - If currently NOT in the set → add it
   *
   * Replaces `config` with a new set, keeping `arrayMatch`; the previous array is left untouched,
   * so a snapshot holding it still describes the earlier state.
   *
   * @param values - Values to toggle
   */
  toggleSetValues(values: readonly V[]): void {
    this.config = { ...this.config, set: xor(this.config.set, values) };
  }
```

(Note: the `xor` helper is from `lib/internal.ts`, replacing `_xor`.)

**Array-valued fields.** `InSetRule`, `InSetofSetsRule` and `HierarchicalRule` read a field that holds an array
(`paymentMethods: ['card', 'cash']`) as the set of values it holds, and `config.arrayMatch` (`rules/arrayMatch.ts`)
decides how that set meets the selection. The selection is a list of units: a value for `InSetRule`, a subset for
`InSetofSetsRule`, a selected node for `HierarchicalRule`.

| `arrayMatch`      | An array passes when                             | Selecting another unit | Example                        |
| ----------------- | ------------------------------------------------ | ---------------------- | ------------------------------ |
| `'any'` (default) | at least one element satisfies at least one unit | widens the result      | "accepts any of these methods" |
| `'all'`           | every unit is satisfied by at least one element  | narrows the result     | "has all of these features"    |

An empty selection constrains nothing under either mode, an empty array satisfies no unit (so it fails any non-empty
selection), and a field that is not an array is compared as a single value exactly as before, whatever the mode.
`InSetRule` compares elements as `includes` does (SameValueZero). The option is written only when set, revives through
each rule's `static deserialize` hook (which rejects any value but `'any'` and `'all'`), and survives `toggleSetValues`.
Bitmap acceleration builds these rules' bitmaps from the same `action`, so accelerated and per-item results are the same
by construction; `config/configRoundTripBehavior.test.ts` holds every rule case to that, array fields included. For
facet counts over array fields, see `FilterBundleChipGroupQuery` in `queryBundle.ts` and
[`predictive_disable.md`](./guides/predictive_disable.md).

#### `InSetofSetsRule<V>`

<!-- excerpt: packages/core/src/rules/InSetofSetsRule.ts#in-set-of-sets-rule -->
<!-- prettier-ignore -->
```ts
/**
 * Configuration for `InSetofSetsRule`.
 */
export interface InSetofSetsRuleConfig<V> {
  readonly set: readonly (readonly V[])[];
  /**
   * How an array-valued field meets `set`: `'any'` (default) passes when at least one element is in
   * some subset, `'all'` when every subset has a value in the array. Ignored for a non-array field.
   */
  readonly arrayMatch?: ArrayMatch;
}

/**
 * Filter items by membership in any subset of a set-of-sets.
 *
 * @example
 *   const sizes = new InSetofSetsRule<string>('size', [['xs', 's'], ['xl', 'xxl']]);
 *   engine.addRule('size', sizes);
 *   // Toggle the 'small sizes' subset in/out:
 *   sizes.toggleSetValues(['xs', 's']);
 *
 * @typeParam V - The element type.
 */
export class InSetofSetsRule<V = unknown> extends FilterRule {
  /**
   * Minifier-proof wire name — see {@link FilterRule.ruleTypeName}. Declared as a literal so
   * `ruleRegistry.register` can reject a key that disagrees with it at compile time.
   */
  static override readonly ruleTypeName = 'InSetofSetsRule';

  config: InSetofSetsRuleConfig<V>;

  /**
   * @param field - How to pull the value-to-test from each item
   * @param initialSets - Initial subsets of allowed values (may be empty)
   * @param options - `arrayMatch` for array-valued fields; omitted, they match `'any'`
   */
  constructor(
    field: FieldExtractor,
    initialSets: readonly (readonly V[])[] = [],
    options: ArrayMatchOptions = {},
  ) {
    super(field);
    this.config = options.arrayMatch === undefined
      ? { set: initialSets }
      : { arrayMatch: options.arrayMatch, set: initialSets };
  }

  /**
   * Passes when the field value is in any of the configured subsets (an array field: per
   * `config.arrayMatch`); no subsets passes everything.
   */
  override action: FilterRuleAction = (item, rule): boolean => {
    const { arrayMatch, set } = (rule as InSetofSetsRule<V>).config;

    if (set.length === 0) {
      return true;
    }
    const value = this.getFieldValue(item);

    return Array.isArray(value)
      ? matchesArraySelection(value, set, arrayMatch, (subset, element) => subset.includes(element as V))
      : set.some((subset) => subset.includes(value as V));
  };
```

Under `arrayMatch: 'all'` every subset must have at least one of its values in the array: selecting the subsets
`['it-pie', 'it-ven']` and `['fr-bdx']` asks for an item listed under Italy **and** France. See `InSetRule` above for
the shared array semantics.

#### `TextSearchRule`

<!-- excerpt: packages/core/src/rules/TextSearchRule.ts#text-search-config -->
<!-- prettier-ignore -->
```ts
/**
 * The six supported text-search modes.
 *
 * - `'exact'` — entire string equals the query
 * - `'substring'` — query appears anywhere in the string
 * - `'startsWith'` — string begins with the query
 * - `'endsWith'` — string ends with the query
 * - `'tokenized'` — query is split on whitespace; ALL tokens must appear as SUBSTRINGS
 * - `'allWords'` — query is split into words; ALL query words must appear as WHOLE WORDS (a word
 *   being a maximal run of Unicode letters/numbers, per `lib/textTokens`). Unlike `'tokenized'`,
 *   `'oak'` matches the whole word `oak` but NOT a substring like `oakwood`. This is the mode the
 *   inverted word index accelerates (an exact AND of word postings).
 */
export type TextSearchMode = 'allWords' | 'endsWith' | 'exact' | 'startsWith' | 'substring' | 'tokenized';

/**
 * Configuration for `TextSearchRule`.
 */
export interface TextSearchRuleConfig {
  readonly caseSensitive?: boolean;
  readonly mode: TextSearchMode;
  readonly query: string;
}
```

#### `FuzzySearchRule` (depends on `fuse.js`)

<!-- excerpt: packages/core/src/rules/FuzzySearchRule.ts#fuzzy-search-rule -->
<!-- prettier-ignore -->
```ts
/**
 * Configuration for `FuzzySearchRule`: the query, optional `keys`, and any of the Fuse.js options
 * in {@link FuzzySearchFuseOptions}, passed through to Fuse as they are.
 *
 * See [Fuse.js docs](https://www.fusejs.io/api/options.html) for the full option reference.
 */
export interface FuzzySearchRuleConfig extends FuzzySearchFuseOptions {
  /** The search query. Empty string matches every item with a string field. */
  readonly query: string;
  /**
   * Optional list of property paths to search within (for object items). When set, overrides
   * the rule's `field` extractor in favor of multi-field Fuse search.
   */
  readonly keys?: readonly string[];
}

/**
 * Filter items by fuzzy / typo-tolerant text match.
 *
 * @example
 *   // Items whose title fuzzy-matches 'cabernay' (catches 'cabernet' too):
 *   engine.addRule(
 *     'fuzzy-title',
 *     new FuzzySearchRule('title', { query: 'cabernay', threshold: 0.4 }),
 *   );
 *
 *   // Several fields, matched anywhere in the text, ignoring one-character runs:
 *   new FuzzySearchRule(undefined, {
 *     ignoreLocation: true,
 *     keys: ['name', 'winery'],
 *     minMatchCharLength: 2,
 *     query: 'cabernay',
 *   });
 */
export class FuzzySearchRule extends FilterRule {
  /**
   * Minifier-proof wire name — see {@link FilterRule.ruleTypeName}. Declared as a literal so
   * `ruleRegistry.register` can reject a key that disagrees with it at compile time.
   */
  static override readonly ruleTypeName = 'FuzzySearchRule';

  override action: FilterRuleAction = (item, rule): boolean => {
    const cfg = (rule as FuzzySearchRule).config;

    if (cfg.query.length === 0) {
      return true;
    }

    // The prepared collection's answer, when this item is in it and nothing has changed since.
    const verdicts = this._verdicts;

    if (verdicts?.config === cfg && verdicts.field === this.field) {
      const isMatch = verdicts.matched.get(item);

      if (isMatch !== undefined) {
        return isMatch;
      }
    }

    // Multi-key mode: search the entire item via Fuse, not just the field extractor.
    if (cfg.keys && cfg.keys.length > 0) {
      return new Fuse([item], buildFuseOptions(cfg)).search(cfg.query).length > 0;
    }

    // Single-field mode: extract the string and probe.
    const fieldValue = this.getFieldValue(item);

    if (typeof fieldValue !== 'string') {
      return false;
    }

    return new Fuse([fieldValue], buildFuseOptions(cfg)).search(cfg.query).length > 0;
  };
```

**Fuse options.** `FuzzySearchFuseOptions` (`rules/fuseOptions.ts`) passes Fuse.js's serializable options through:
`threshold`, `distance`, `location`, `ignoreLocation`, `minMatchCharLength`, `isCaseSensitive`, `ignoreDiacritics`,
`findAllMatches`, `ignoreFieldNorm`, `fieldNormWeight`, `useExtendedSearch`, `useTokenSearch` and `tokenMatch`. An
absent option takes Fuse's default. Function options are not part of it — `getFn` (a function `field` extractor does
that job in single-field mode) and `sortFn` (a filter never ranks) — and neither are the options that shape Fuse's
result list (`includeScore`, `includeMatches`, `shouldSort`); a key outside the list stays on the config and never
reaches Fuse. `FuzzySearchRule.deserialize` checks each option's type as it loads.

**One Fuse index per collection.** `prepareForCollection` (§4.1) builds one Fuse index over the collection — each item's
field string in single-field mode, the items themselves with `keys` — searches it once, and records each indexed item's
answer, which `action` then looks up. The index is cached per collection array (a `WeakMap`) and rebuilt when the
collection, the `field` or any Fuse option other than `query` changes; a new `query` searches the existing index. The
answers are tied to the `config` object and the `field`, so replacing either prepares afresh, and an item outside the
prepared collection (or one the index left out: a non-string field, a non-object item with `keys`) is answered by the
one-item search. The match set is the per-item search's exactly: Fuse decides each record's match from that record alone
(the threshold applies to each field's own Bitap score), while the parts of scoring that read the collection — the
field-length norm, token search's inverse document frequency — only order the matches, which a filter never reads.
`FuzzySearchRule.collection.test.ts` holds the collection search, the per-item search and a direct
`new Fuse(collection).search(query)` to the same answer for every option.

#### `RegexRule`

<!-- excerpt: packages/core/src/rules/RegexRule.ts#regex-rule -->
<!-- prettier-ignore -->
```ts
/**
 * Configuration for `RegexRule`.
 */
export interface RegexRuleConfig {
  readonly pattern: RegExp;
}

/**
 * Serialized form of a regex pattern (for JSON round-trip).
 */
export interface RegexRuleSerializedConfig {
  readonly flags: string;
  readonly source: string;
}

/**
 * Filter items by regex match against a string field.
 *
 * @example
 *   // Items whose SKU starts with 'CV1F':
 *   engine.addRule('sku', new RegexRule('sku', { pattern: /^CV1F/ }));
 */
export class RegexRule extends FilterRule {
  /**
   * Minifier-proof wire name — see {@link FilterRule.ruleTypeName}. Declared as a literal so
   * `ruleRegistry.register` can reject a key that disagrees with it at compile time.
   */
  static override readonly ruleTypeName = 'RegexRule';

  override action: FilterRuleAction = (item, rule): boolean => {
    const value = this.getFieldValue(item);

    if (typeof value !== 'string') {
      return false;
    }

    const { pattern } = (rule as RegexRule).config;

    pattern.lastIndex = 0;

    return pattern.test(value);
  };

  config: RegexRuleConfig;

  constructor(field: FieldExtractor, config: RegexRuleConfig) {
    super(field);
    this.config = config;
  }
```

`RegexRule` resets the pattern's `lastIndex` before every match, so a global (`g`) or sticky (`y`) pattern still matches
each item from the start of its value.

#### `DateRangeRule`

<!-- excerpt: packages/core/src/rules/DateRangeRule.ts#date-range-config -->
<!-- prettier-ignore -->
```ts
/**
 * The supported relative-range presets.
 */
export type DateRangePreset = 'all-time' | 'last-30-days' | 'last-7-days' | 'last-90-days' | 'this-month' | 'this-year';

/**
 * Configuration for `DateRangeRule`.
 *
 * Provide either:
 *   - `start` and/or `end` for absolute bounds
 *   - `preset` for a relative-range shortcut (resolved at evaluation time)
 *
 * If both are supplied, `preset` takes precedence.
 */
export interface DateRangeRuleConfig {
  readonly end?: Date;
  readonly preset?: DateRangePreset;
  readonly start?: Date;
}
```

#### `HierarchicalRule`

<!-- excerpt: packages/core/src/rules/HierarchicalRule.ts#hierarchical-rule -->
<!-- prettier-ignore -->
```ts
/**
 * A node in a filter hierarchy tree.
 */
export interface TreeNode {
  readonly id: string;
  readonly children?: readonly TreeNode[];
}

/**
 * Configuration for `HierarchicalRule`.
 */
export interface HierarchicalRuleConfig {
  readonly tree: TreeNode;
  /** IDs of selected nodes. Each selection includes the node itself + all descendants. */
  readonly selected: readonly string[];
  /**
   * How an array-valued field meets `selected`: `'any'` (default) passes when at least one id lies
   * in a selected subtree, `'all'` when every selected subtree holds one. Ignored for a string field.
   */
  readonly arrayMatch?: ArrayMatch;
}

/**
 * Filter items by hierarchical category membership.
 *
 * @example
 *   const categoryTree: TreeNode = {
 *     id: 'electronics',
 *     children: [
 *       { id: 'phones', children: [{ id: 'smartphones' }, { id: 'flip-phones' }] },
 *       { id: 'laptops' },
 *     ],
 *   };
 *
 *   // Items whose category is 'phones' or any descendant ('smartphones', 'flip-phones'):
 *   engine.addRule(
 *     'category',
 *     new HierarchicalRule('categoryId', { tree: categoryTree, selected: ['phones'] }),
 *   );
 */
export class HierarchicalRule extends FilterRule {
  /**
   * Minifier-proof wire name — see {@link FilterRule.ruleTypeName}. Declared as a literal so
   * `ruleRegistry.register` can reject a key that disagrees with it at compile time.
   */
  static override readonly ruleTypeName = 'HierarchicalRule';

  /**
   * Passes a string field inside a selected subtree, or an array field whose ids meet the selection
   * per `config.arrayMatch`; anything else fails. Nothing selected passes every string or array field.
   */
  override action: FilterRuleAction = (item, rule): boolean => {
    const fieldValue = this.getFieldValue(item);

    if (typeof fieldValue !== 'string' && !Array.isArray(fieldValue)) {
      return false;
    }
    const { arrayMatch, selected, tree } = (rule as HierarchicalRule).config;

    if (selected.length === 0) {
      return true;
    }
    if (typeof fieldValue === 'string') {
      return selected.some((selectedId) => isInSubtreeRootedAt(tree, selectedId, fieldValue));
    }

    return matchesArraySelection(fieldValue, selected, arrayMatch, (selectedId, element) =>
      typeof element === 'string' && isInSubtreeRootedAt(tree, selectedId, element));
  };

  config: HierarchicalRuleConfig;

  constructor(field: FieldExtractor, config: HierarchicalRuleConfig) {
    super(field);
    this.config = config;
  }
```

An array field (a product under several categories) is read as a set of node ids per `config.arrayMatch`, with the
semantics described under `InSetRule`: under `'any'` one id in a selected subtree is enough, under `'all'` every
selected subtree needs one. Elements that are not strings never match. A field that is neither a string nor an array
fails whatever is selected; with nothing selected, every string or array field passes.

#### `GeoProximityRule`

<!-- excerpt: packages/core/src/rules/GeoProximityRule.ts#geo-proximity-rule -->
<!-- prettier-ignore -->
```ts
/**
 * Configuration for `GeoProximityRule`.
 */
export interface GeoProximityRuleConfig {
  readonly center: GeoCoords;
  /** Radius in kilometers. `Infinity` for no limit; JSON writes it as `null`. */
  readonly radiusKm: number;
}

/**
 * Filter items by proximity to a geographic point.
 *
 * The field extractor MUST return a `GeoCoords` object (or `undefined` for items without a
 * location, which fail the rule).
 *
 * Name the field by path, as below, for a rule that is exported, put in a URL, or sent to a worker
 * or server: a function extractor serializes as `'<function>'` and loads back as "the item itself",
 * which carries no `lat` / `lng`, so the loaded rule matches nothing. Data whose coordinates are
 * shaped differently (`{ lat, lon }`, say) gets a `{ lat, lng }` field of its own.
 *
 * @example
 *   // Items within 5 km of San Francisco's Ferry Building:
 *   engine.addRule(
 *     'near-ferry',
 *     new GeoProximityRule('location', {
 *       center: { lat: 37.7955, lng: -122.3937 },
 *       radiusKm: 5,
 *     }),
 *   );
 */
export class GeoProximityRule extends FilterRule {
  /**
   * Minifier-proof wire name — see {@link FilterRule.ruleTypeName}. Declared as a literal so
   * `ruleRegistry.register` can reject a key that disagrees with it at compile time.
   */
  static override readonly ruleTypeName = 'GeoProximityRule';

  override action: FilterRuleAction = (item, rule): boolean => {
    const coords = this.extractCoords(item);

    if (coords === undefined) {
      return false;
    }
    const { center, radiusKm } = (rule as GeoProximityRule).config;

    return haversineKm(coords, center) <= radiusKm;
  };

  config: GeoProximityRuleConfig;

  constructor(field: FieldExtractor, config: GeoProximityRuleConfig) {
    super(field);
    this.config = config;
  }
```

#### `ExistsRule`

<!-- excerpt: packages/core/src/rules/ExistsRule.ts#exists-rule -->
<!-- prettier-ignore -->
```ts
/**
 * Filter items by presence — passes when the extracted field is neither null nor undefined.
 *
 * @example
 *   // Items that have a photoUrl set:
 *   engine.addRule('has-photo', new ExistsRule('photoUrl'));
 */
export class ExistsRule extends FilterRule {
  /**
   * Minifier-proof wire name — see {@link FilterRule.ruleTypeName}. Declared as a literal so
   * `ruleRegistry.register` can reject a key that disagrees with it at compile time.
   */
  static override readonly ruleTypeName = 'ExistsRule';

  /** Passes when the field value is neither `null` nor `undefined`. */
  override action: FilterRuleAction = (item): boolean => {
    const value = this.getFieldValue(item);

    return value !== null && value !== undefined;
  };

  /** No configuration needed — the rule's behavior is fully determined by the field extractor. */
  config: undefined = undefined;
}
```

#### `PredicateRule`

<!-- excerpt: packages/core/src/rules/PredicateRule.ts#predicate-rule -->
<!-- prettier-ignore -->
```ts
/**
 * Configuration for `PredicateRule`.
 *
 * @typeParam T - The item type the predicate expects (narrowed from `unknown`)
 */
export interface PredicateRuleConfig<T> {
  readonly predicate: (item: T, rule: PredicateRule<T>) => boolean;
}

/**
 * Filter items by a consumer-supplied predicate function.
 *
 * @example
 *   // Custom rule: items whose computed score exceeds a dynamic threshold:
 *   engine.addRule(
 *     'high-score',
 *     new PredicateRule<Item>('score', (item) => item.score > computeThreshold()),
 *   );
 *
 * @typeParam T - The item type
 */
export class PredicateRule<T = unknown> extends FilterRule {
  /**
   * Minifier-proof wire name — see {@link FilterRule.ruleTypeName}. Declared as a literal so
   * `ruleRegistry.register` can reject a key that disagrees with it at compile time.
   */
  static override readonly ruleTypeName = 'PredicateRule';

  override action: FilterRuleAction = (item, rule): boolean => {
    const { predicate } = (rule as PredicateRule<T>).config;

    return predicate(item as T, rule as PredicateRule<T>);
  };

  config: PredicateRuleConfig<T>;

  constructor(
    field: FieldExtractor,
    predicate: (item: T, rule: PredicateRule<T>) => boolean,
  ) {
    super(field);
    this.config = { predicate };
  }

  /**
   * Overrides the base `serialize` to throw — predicate functions are not serializable.
   *
   * @throws `FilterEngineRuleError` with code `RULE_NOT_SERIALIZABLE`, always; consumers needing
   *         round-trip must register a named `FilterRule` subclass instead of using `PredicateRule`.
   */
  override serialize(): SerializedRule {
    const fieldHint = typeof this.field === 'string' ? ` (field '${this.field}')` : '';

    throw new FilterEngineRuleError(
      'RULE_NOT_SERIALIZABLE',
      `PredicateRule${fieldHint} cannot be serialized — its predicate function is opaque. ` +
        'For round-trip support (URL state, JSON config, worker bridge, devtools persistence), ' +
        'write a named FilterRule subclass and register it with ruleRegistry.',
    );
  }
```

#### `BloomMembershipRule` (the 15th rule)

The 15th concrete rule — probabilistic set membership against a **prebuilt**, serialized `BloomFilter` bitset. A
registry-registered, serializable **pre-screen**: no false negatives, a tunable false-positive rate, so pair it with an
exact check where a false positive would be incorrect. Coerces primitive field values with `String(value)`; `null`,
`undefined` and object values never match. Full detail (the shared `lib/BloomFilter.ts` primitive and this rule) lives
in §8a.

### §4.4. The extension contract

Consumers subclass `FilterRule` directly with their own typed `config` + `action`. No registration is needed for
imperative use, and `serialize()` needs only the `ruleTypeName` static (§4.1a). Registration is what lets a serialized
rule be **revived** — by JSON-config loading, URL state, the worker bridge and devtools persistence:

```ts
import { FilterRule, ruleRegistry, type FilterRuleAction, type FieldExtractor } from '@filter-enginez/core';

export class MinTagMatchRule extends FilterRule {
  // Required to serialize. A literal, not `: string` — see §4.1a; `register` below
  // will not compile without it.
  static override readonly ruleTypeName = 'MinTagMatchRule';

  config: { required: string[]; minMatches: number };

  constructor(field: FieldExtractor, required: string[], minMatches: number) {
    super(field);
    this.config = { required, minMatches };
  }

  override action: FilterRuleAction = (item, rule) => {
    const tags = this.getFieldValue(item) as string[] | undefined;
    if (!tags) return false;
    const cfg = (rule as MinTagMatchRule).config;
    const matches = tags.filter((t) => cfg.required.includes(t)).length;
    return matches >= cfg.minMatches;
  };
}

// Optional: register for serialization
ruleRegistry.register('MinTagMatchRule', MinTagMatchRule);
```

### §4.5. Factory functions

Every rule class has a factory function for ergonomic imperative creation — `value`, `bool`, `range`, `numCompare`,
`inSet`, `inSetofSets`, `text`, `fuzzy`, `regex`, `dateRange`, `hierarchical`, `geo`, `exists`, `predicate` and
`bloomMembership`. They live in `packages/core/src/rules/factories.ts` (the composition factories `and` / `or` / `not`
live in `packages/core/src/composition/factories.ts`, §5). A representative slice:

<!-- excerpt: packages/core/src/rules/factories.ts#rule-factories -->
<!-- prettier-ignore -->
```ts
/** Create a `ValueRule` — exact equality against a configured value. */
export function value<V>(field: FieldExtractor, targetValue: V | undefined): ValueRule<V> {
  return new ValueRule(field, targetValue);
}

/** Create a `BooleanRule` — boolean equality convenience. */
export function bool(field: FieldExtractor, val: boolean | undefined): BooleanRule {
  return new BooleanRule(field, val);
}

/** Create a `RangeRule` — inclusive numeric range. */
export function range(field: FieldExtractor, config: RangeRuleConfig): RangeRule {
  return new RangeRule(field, config);
}

/** Create a `NumericComparisonRule` — single-operator numeric comparison. */
export function numCompare(
  field: FieldExtractor,
  config: NumericComparisonRuleConfig,
): NumericComparisonRule {
  return new NumericComparisonRule(field, config);
}

/**
 * Create an `InSetRule` — value must be in a configured set. Pass the config form
 * (`{ set, arrayMatch }`) to choose how an array-valued field matches.
 */
export function inSet<V>(
  field: FieldExtractor,
  initialSetOrConfig: InSetRuleConfig<V> | readonly V[],
): InSetRule<V> {
  if (Array.isArray(initialSetOrConfig)) {
    return new InSetRule<V>(field, initialSetOrConfig);
  }
  const { set, ...options } = initialSetOrConfig as InSetRuleConfig<V>;

  return new InSetRule<V>(field, set, options);
}

/** Create an `InSetofSetsRule` — value must be in any of the configured subsets. */
export function inSetofSets<V>(
  field: FieldExtractor,
  initialSets: readonly (readonly V[])[] = [],
  options: ArrayMatchOptions = {},
): InSetofSetsRule<V> {
  return new InSetofSetsRule<V>(field, initialSets, options);
}
```

---

## §5. `CompositeRule` + Expression Algebra

### §5.1. The class

<!-- excerpt: packages/core/src/rules/CompositeRule.ts#composite-rule-class -->
<!-- prettier-ignore -->
```ts
/**
 * Boolean composition operators.
 */
export type CompositionOp = 'and' | 'not' | 'or';

/**
 * Configuration for `CompositeRule`.
 */
export interface CompositeRuleConfig {
  readonly op: CompositionOp;
  readonly rules: readonly FilterRule[];
}

/**
 * Composite filter rule — combines child rules via AND / OR / NOT.
 *
 * @example
 *   // (color in {red, blue}) AND (price in [20k, 30k]) AND NOT (dealer = 'XYZ')
 *   const expr = and(
 *     or(inSet('color', ['red']), inSet('color', ['blue'])),
 *     range('price', { min: 20000, max: 30000 }),
 *     not(inSet('dealer', ['XYZ'])),
 *   );
 *   engine.setExpression(expr);
 *
 * @remarks
 * `CompositeRule` is itself a `FilterRule`, so it can be used anywhere a rule can — including
 * as a child of another `CompositeRule` (recursive composition).
 *
 * Per-item evaluation goes through `evaluateExpression`, the predicate-style recursive walker.
 * At the engine level, flat conjunctions are answered by the bitmap path when it is engaged
 * (`BitmapIndex.tryComputeResults`); expressions are answered by the evaluator.
 */
export class CompositeRule extends FilterRule {
  /**
   * Minifier-proof wire name — see {@link FilterRule.ruleTypeName}. Declared as a literal so
   * `ruleRegistry.register` can reject a key that disagrees with it at compile time.
   */
  static override readonly ruleTypeName = 'CompositeRule';

  config: CompositeRuleConfig;

  /**
   * @param op - The composition operator (`'and'` / `'or'` / `'not'`)
   * @param rules - Child rules to compose
   */
  constructor(op: CompositionOp, rules: readonly FilterRule[]) {
    super(undefined);
    this.config = { op, rules };
  }

  /**
   * Predicate evaluation — recursively evaluates child rules per the composition operator
   * via `evaluateExpression` (see `composition/ExpressionEvaluator.ts`).
   */
  override action: FilterRuleAction = (item, rule): boolean => {
    return evaluateExpression(rule, item);
  };

  /**
   * Prepare every child for a pass over `collection` — see {@link FilterRule.prepareForCollection}.
   *
   * @param collection - The items the coming pass will evaluate
   */
  override prepareForCollection(collection: readonly unknown[]): void {
    for (const child of this.config.rules) {
      prepareRuleForCollection(child, collection);
    }
  }

  /**
   * Recursively serialize the composite and every child into a fully plain, JSON-safe tree.
   *
   * @remarks
   * The inherited `FilterRule.serialize()` returns `config` by reference, which for a composite
   * carries live child `FilterRule` instances — each holding a non-cloneable `action` function.
   * That form throws `DataCloneError` the moment it crosses a `structuredClone` boundary (the
   * worker-bridge postMessage path, URL-state, devtools persistence) and can't be rebuilt into
   * working instances. Serializing each child into its own `SerializedRule` yields a plain tree;
   * `ruleRegistry.deserialize` mirrors this by recursively reviving composite children.
   */
  override serialize(): SerializedRule {
    return {
      config: {
        op: this.config.op,
        rules: this.config.rules.map((rule) => rule.serialize()),
      },
      field: undefined,
      type: CompositeRule.ruleTypeName,
    };
  }
}
```

**Recursive serialization.** `CompositeRule` overrides `FilterRule.serialize()` to recurse — it emits
`{ op, rules: [child.serialize(), …] }`, a fully plain, JSON-safe tree, rather than the inherited default's by-reference
`config` (which would carry live child `FilterRule` instances whose `action` functions are non-cloneable). Its inverse
lives in `ruleRegistry.deserialize`, which special-cases `CompositeRule` (`_deserializeComposite`) to rebuild each child
through the registry. This is what makes an expression survive any `structuredClone` boundary — the worker-bridge
`setExpression` / `getExpression` + the `toWireEvent` `expression`-event forwarding (§15), and the two reactive async
adapters. The config layer's expression export (§9) uses its own `SerializedExpressionNode` plane instead and is
independent of this path.

### §5.2. The evaluator

<!-- excerpt: packages/core/src/composition/ExpressionEvaluator.ts#evaluate-expression -->
<!-- prettier-ignore -->
```ts
/**
 * Recursively evaluate a rule (composite or leaf) against an item, returning whether the item
 * passes the rule.
 *
 * @param rule - The rule (or composite tree) to evaluate
 * @param item - The item under test
 * @returns `true` if the item passes, `false` if filtered out
 */
export function evaluateExpression(rule: FilterRule, item: unknown): boolean {
  if (rule instanceof CompositeRule) {
    const { op, rules: childRules } = rule.config;

    switch (op) {
      case 'and':
        return childRules.every((child) => evaluateExpression(child, item));
      case 'not': {
        const [firstChild] = childRules;

        return firstChild === undefined ? true : !evaluateExpression(firstChild, item);
      }
      case 'or':
        return childRules.length === 0 ? true : childRules.some((child) => evaluateExpression(child, item));
    }
  }

  // Leaf — delegate to the rule's own predicate
  return rule.action(item, rule);
}
```

The evaluator is the correctness reference and the path for every expression. For a plain conjunction — flat-map mode
with conjunctive groups, over the full source data — results come from the bitmap layer's AND instead once it is engaged
(§6.1), with identical answers.

### §5.3. `FilterGroup` convenience

<!-- excerpt: packages/core/src/composition/FilterGroup.ts#filter-group-type -->
<!-- prettier-ignore -->
```ts
/**
 * Composition mode for a `FilterGroup`'s child rules.
 *
 * - `'or'` — items pass if ANY child rule matches (default; matches the Amazon-style
 *   "any color OR any color" filter UX)
 * - `'and'` — items pass only if ALL child rules match
 */
export type FilterGroupCompositionMode = 'and' | 'or';

/**
 * A named collection of rule IDs composed via the same operator.
 *
 * The engine maintains groups separately from individual rules; `effectiveExpression` derives
 * the full Boolean expression by composing each group's registered rules with its operator and
 * AND-ing the groups with the standalone rules. Ids that name no registered rule are skipped.
 */
export interface FilterGroup {
  /** Unique group identifier. */
  readonly id: string;

  /** Optional human-readable display name for UI rendering. */
  readonly displayName?: string;

  /** IDs of rules that belong to this group. */
  readonly filterIds: readonly RuleId[];

  /** Composition operator. `engine.addGroup()` fills in `'or'` when the caller omits it. */
  readonly composition: FilterGroupCompositionMode;
}
```

`engine.addGroup(group)` registers a group — `composition` may be omitted and is stored as `'or'` — and the store's
`effectiveExpression` folds the groups in. Each group contributes one conjunct built from the rules it names that are
currently registered (none: nothing; one: that rule; more: the group's operator over them); every rule no group names is
a standalone conjunct; and the conjuncts AND together. Rules stay addressable by id, so toggling a chip is still
`addRule` / `removeRule` while the group decides how it combines. Groups apply in flat-map mode only — an explicit
expression replaces the whole composition. `getResults()`, `simulate()`, `getFilteredFieldValuesExcept()` and
`computeResults()` all see the groups; `applyFiltersAndQuery()` reports results without facets while an `'or'` group
spans two or more registered rules, as it does in expression mode.

<!-- excerpt: packages/core/src/store/InternalStore.ts#effective-expression -->
<!-- prettier-ignore -->
```ts
// Derive the effective expression. Flat-map mode composes the registered rules with the
// filter groups (each group's rules combine with its operator; groups and standalone rules
// AND together). Expression mode uses the explicit tree. Either way the tree is simplified
// before evaluation; `getExpression()` still returns the tree exactly as it was set.
this.effectiveExpression = computed<FilterRule | null>(() => {
  const explicit = this.expression.value;
  const composed = explicit ?? composeFlatExpression(this.rules.value, this.groups.value);

  return composed === null ? null : simplify(composed);
});
```

<!-- excerpt: packages/core/src/composition/composeFlatExpression.ts#compose-flat-expression -->
<!-- prettier-ignore -->
```ts
/**
 * Build the flat-map-mode expression for a rule map and a group list.
 *
 * @param rules - The registered rules, in registration order
 * @param groups - The registered filter groups, in registration order
 * @returns `null` when no rule is registered; the lone rule when exactly one conjunct remains;
 *   otherwise an `and` composite. A group whose named rules are all unregistered contributes
 *   nothing, and a group with one registered rule contributes that rule unwrapped.
 */
export function composeFlatExpression(
  rules: ReadonlyMap<RuleId, FilterRule>,
  groups: readonly FilterGroup[],
): FilterRule | null {
  if (groups.length === 0) {
    return conjoin([...rules.values()]);
  }
  const grouped = new Set<RuleId>();
  const groupConjuncts: FilterRule[] = [];

  for (const group of groups) {
    const members: FilterRule[] = [];

    for (const id of new Set(group.filterIds)) {
      grouped.add(id);
      const rule = rules.get(id);

      if (rule !== undefined) {
        members.push(rule);
      }
    }
    const [onlyMember] = members;

    if (onlyMember === undefined) {
      continue;
    }
    groupConjuncts.push(members.length === 1 ? onlyMember : new CompositeRule(group.composition, members));
  }
  const standalone: FilterRule[] = [];

  for (const [id, rule] of rules) {
    if (!grouped.has(id)) {
      standalone.push(rule);
    }
  }

  return conjoin([...standalone, ...groupConjuncts]);
}
```

### §5.4. Algebraic simplification

Performed by `composition/simplify.ts` on the effective expression every time the store derives it (both modes), before
evaluation. Every rewrite preserves the evaluator's answer for every item:

<!-- excerpt: packages/core/src/composition/simplify.ts#simplify -->
<!-- prettier-ignore -->
```ts
/**
 * Simplify an expression tree. Returns:
 *   - `null` if the expression reduces to "no constraint" (every item passes)
 *   - A `FilterRule` if simplification collapses to a single leaf
 *   - A new `CompositeRule` with simplified children otherwise
 *
 * @param rule - The expression tree to simplify
 * @returns The simplified expression, or `null` if no constraint
 */
export function simplify(rule: FilterRule): FilterRule | null {
  if (!(rule instanceof CompositeRule)) {
    return rule;
  }

  const { op, rules: children } = rule.config;

  // The evaluator reads only the first child of a `not`; an empty `not` passes everything.
  const operands = op === 'not' ? children.slice(0, 1) : children;

  // Recursively simplify children first.
  const simplifiedChildren: FilterRule[] = [];

  for (const child of operands) {
    const simplified = simplify(child);

    if (simplified !== null) {
      simplifiedChildren.push(simplified);
      continue;
    }
    // The child constrains nothing (always true).
    if (op === 'or') {
      return null;
    }
    if (op === 'not') {
      return new CompositeRule('not', [new CompositeRule('and', [])]);
    }
    // `and`: an always-true conjunct is dropped.
  }

  const [firstChild] = simplifiedChildren;

  // Zero children → no constraint (`not()` passes everything, as does an empty and/or).
  if (firstChild === undefined) {
    return null;
  }

  // and(x) / or(x) → x (single-child collapse)
  if (op !== 'not' && simplifiedChildren.length === 1) {
    return firstChild;
  }

  // not(not(x)) → x (double-negation elimination)
  if (op === 'not') {
    const inner = firstChild;

    if (inner instanceof CompositeRule && inner.config.op === 'not') {
      const [innerChild] = inner.config.rules;

      // `inner` is already simplified, and a simplified `not` always has exactly one child, so
      // the `=== undefined` arm is unreachable but required by `noUncheckedIndexedAccess`.
      /* v8 ignore next 3 -- defensive: unreachable guard (a simplified `not` has one child) */
      if (innerChild !== undefined) {
        return simplify(innerChild);
      }
    }
  }

  return new CompositeRule(op, simplifiedChildren);
}
```

Simplification is invisible to consumers — `engine.getExpression()` returns the original (un-simplified) form for
round-trip fidelity; the simplified form is used only for evaluation.

---

## §6. The Acceleration Stack

Three layers, introduced in §1.5. This section is the implementation reference for each.

### §6.1. Roaring Bitmaps integration

<!-- excerpt: packages/core/src/internals/BitmapIndex.ts#bitmap-compute-results -->
<!-- prettier-ignore -->
```ts
/**
 * Compute the result indices for the currently-active rule set via bitwise AND of all
 * rule bitmaps.
 *
 * @returns A `Uint32Array` of source-data indices that pass all active rules. Returns the
 *   indices of all source data when no rules are active.
 */
computeResults(): Uint32Array {
  this._invalidateIfVersionChanged();

  const rules = this._store.rules.value;
  const items = this._store.sourceData.value;

  if (rules.size === 0) {
    // No active rules → all indices pass.
    const all = new Uint32Array(items.length);

    for (let i = 0; i < items.length; i++) {
      all[i] = i;
    }

    return all;
  }

  // Start with a clone of the smallest bitmap (smallest-first → fastest AND chain).
  const ruleIds = [...rules.keys()];
  const bitmapsForRules = ruleIds.map((id) => this.getBitmap(id));

  bitmapsForRules.sort((a, b) => a.size - b.size);

  const [smallest] = bitmapsForRules;

  /* v8 ignore next 3 -- defensive: rules.size > 0 checked above, so `smallest` is always defined; guard keeps access type-safe */
  if (smallest === undefined) {
    return new Uint32Array(0);
  }
  const accumulator = smallest.clone();

  for (let i = 1; i < bitmapsForRules.length; i++) {
    const next = bitmapsForRules[i];

    /* v8 ignore next 3 -- defensive: noUncheckedIndexedAccess guard; bitmapsForRules is dense */
    if (next === undefined) {
      continue;
    }
    accumulator.andInPlace(next);
    if (accumulator.size === 0) {
      break;
    } // Short-circuit on empty intersection.
  }

  return Uint32Array.from(accumulator.toArray());
}
```

<!-- excerpt: packages/core/src/internals/BitmapIndex.ts#bitmap-lazy-build -->
<!-- prettier-ignore -->
```ts
/**
 * Drop all cached bitmaps if the store's source-data version has advanced since the cache
 * was built. Cheap O(1) check, called at the top of every public method that reads bitmaps.
 */
private _invalidateIfVersionChanged(): void {
  const currentVersion = this._store.sourceDataVersion.value;

  if (this._cachedVersion !== currentVersion) {
    this._bitmaps.clear();
    this._cachedVersion = currentVersion;
  }
}

/**
 * Build the per-rule bitmap by predicate-evaluating each source-data item against the rule.
 * One-time O(items) cost per rule; the bitmap caches forever (until invalidation).
 *
 * `CompositeRule` inputs would normally short-circuit through the predicate evaluator
 * recursively, which works but defeats the bitmap-acceleration purpose. The
 * `simulateIntersection` / `computeResults` callers only pass leaf rules into this method
 * in typical use; for completeness we still evaluate composites here (correct but slow).
 */
private _buildBitmapForRule(rule: FilterRule): RoaringBitmap32 {
  // Geo-proximity acceleration: resolve the passing indices via the shared R-tree instead
  // of a per-item haversine scan. Gated on a positive radius so this stays bit-for-bit
  // identical to `GeoProximityRule.action` — which includes an item sitting *exactly* on
  // the center at radius 0 (distance 0 <= 0), a case `SpatialIndex.queryRadius` returns
  // empty for. At radius <= 0 (and when the R-tree is off) we fall through to the scan.
  if (rule instanceof GeoProximityRule && this._spatialMode !== 'off' && rule.config.radiusKm > 0) {
    return this._buildGeoBitmap(rule);
  }
  if ((rule instanceof TextSearchRule || rule instanceof FuzzySearchRule) && this._shouldUseTextIndex()) {
    const textBitmap = this._buildTextBitmap(rule);

    if (textBitmap !== null) {
      return textBitmap;
    }
    // Plan said bypass — fall through to the per-item predicate scan below.
  }
  const items = this._store.sourceData.value;
  const bitmap = createRoaringBitmap();

  prepareRuleForCollection(rule, items);
  if (rule instanceof CompositeRule) {
    // Composite — defer to predicate evaluation per item. Rare in flat-map mode; the
    // normal arrival path for composites is `engine.setExpression(...)` which short-
    // circuits this whole code path via the expression-mode guard in
    // `simulateIntersection`.
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (item !== undefined && rule.action(item, rule)) {
        bitmap.add(i);
      }
    }

    return bitmap;
  }

  // Leaf rule — direct predicate evaluation.
  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (item !== undefined && rule.action(item, rule)) {
      bitmap.add(i);
    }
  }

  return bitmap;
}
```

**Loading.** `roaring-wasm` is reached only through a dynamic `import()` inside `initializeBitmapAcceleration()`
(`internals/roaringInit.ts`); everywhere else core imports its types alone, and `BitmapIndex` and `TextInvertedIndex`
build every bitmap with the `RoaringBitmap32` constructor that import resolved (`createRoaringBitmap()`). An app that
never calls the initializer never bundles the library, and a bundler that splits code gives it a chunk of its own,
fetched when the call runs. Called directly before the initializer resolves, the two classes throw
`MODE_ACCELERATION_NOT_READY` (§2.5).
[`tests/tooling/lazyDependencies.test.ts`](../tests/tooling/lazyDependencies.test.ts) fails if any static import chain
from core's entry points reaches the library, and the `core without bitmaps` size budget (§22.4) pins what an app saves.

**Engagement.** Bitmaps are engaged (`BitmapIndex.shouldUseBitmap()`) when the Roaring WASM module has been initialized
(`await initializeBitmapAcceleration()`) and `acceleration.bitmap` is `'on'`, or `'auto'` (the default) with
`sourceData.length >= 500` (`AUTO_BITMAP_THRESHOLD`) — below that, one predicate pass is cheaper than building bitmaps.
`'off'` never engages.

**Where bitmaps are used.** While engaged, `tryComputeResults()` answers the store's `resultIndices` — so
`getResults()`, `getResultIndices()`, `getResultCount()` and `computeResults()` — with the AND of the active rules'
bitmaps, provided the engine is in flat-map mode, every filter group is conjunctive, and the working set is the source
data (bitmaps index the source data). Otherwise it returns `null` and the predicate evaluator answers. `simulate()` and
the exclusion graph use the same bitmaps under the same conditions. Each rule's bitmap is built lazily on first use and
cached until that rule changes or the source data does; a time-travel restore or replay clears the cache before it
writes the store.

### §6.2. R-tree spatial indexing

Engaged for a `GeoProximityRule`'s **bitmap build** when `acceleration.spatialIndex !== 'off'` and the rule's
`radiusKm > 0` — `BitmapIndex._buildBitmapForRule` resolves the passing indices via `SpatialIndex.queryRadius` instead
of a per-item haversine scan. The `radiusKm > 0` gate preserves exact parity with `GeoProximityRule.action`, which
includes an item sitting exactly on the center at radius 0 (distance `0 <= 0`) — a case `queryRadius` returns empty for;
at `radiusKm <= 0`, and under `spatialIndex: 'off'`, the build falls back to the scan. The `SpatialIndex` instances live
in a **field-keyed** cache inside `BitmapIndex` (`Map<FieldExtractor, SpatialIndex>`): the tree is a pure function of
`(source data, coordinate source)`, so every geo rule reading the same `field` shares one tree and center/radius changes
never rebuild it — only a source-data version bump does. Coordinate extraction + the `GeoCoords` / haversine primitives
are shared through `GeoProximityRule.extractCoords` + `lib/geo`. Every bitmap consumer benefits: results,
`computeResults()`, `simulate()`, and the exclusion graph (whose hypothetical candidates are built through
`BitmapIndex.buildEphemeralBitmap`). The entry type and the two-phase query, from the source:

<!-- excerpt: packages/core/src/internals/SpatialIndex.ts#spatial-index-entry -->
<!-- prettier-ignore -->
```ts
/**
 * One R-tree entry — a point bbox plus the source-data index it points at.
 *
 * @internal
 */
interface SpatialIndexEntry {
  readonly idx: number;
  readonly lat: number;
  readonly lng: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly minX: number;
  readonly minY: number;
}
```

<!-- excerpt: packages/core/src/internals/SpatialIndex.ts#spatial-query-radius -->
<!-- prettier-ignore -->
```ts
/**
 * Find the source-data indices within `radiusKm` of `center`. Uses R-tree bounding-box
 * pruning + exact haversine distance check on candidates.
 *
 * @param center - The center point of the query
 * @param radiusKm - The radius in kilometers
 * @returns Array of source-data indices that lie within `radiusKm` of `center`
 */
queryRadius(center: GeoCoords, radiusKm: number): number[] {
  this._ensureBuilt();
  /* v8 ignore next 3 -- defensive: _ensureBuilt() always assigns _tree, so it is never falsy here */
  if (!this._tree) {
    return [];
  }
  if (radiusKm <= 0) {
    return [];
  }

  // Bounding-box prune via the R-tree, then exact haversine refinement. The two boxes of a cap
  // that crosses ±180° are disjoint, so no index is reported twice.
  const result: number[] = [];

  for (const box of capSearchBoxes(center, radiusKm)) {
    for (const entry of this._tree.search(box)) {
      if (haversineKm({ lat: entry.lat, lng: entry.lng }, center) <= radiusKm) {
        result.push(entry.idx);
      }
    }
  }

  return result;
}
```

The bounding box is the spherical cap's: `d = r / R` of latitude either side, and `asin(sin d / cos φ)` of longitude
either side, the cap's widest point, which lies poleward of the center's latitude `φ`. A cap that reaches a pole covers
every longitude and is searched as one full band; one that crosses ±180° is searched as two boxes, one on each side.
Both extents carry a 1e-6° margin so floating-point rounding never prunes an item the exact check keeps. The R-tree
answer therefore equals the per-item `GeoProximityRule` scan for every center and radius (coordinates in the `GeoCoords`
convention, `lng` in [-180, 180]); `SpatialIndex.test.ts` compares the two over a grid of centers and radii that
includes both poles and the antimeridian.

### §6.3. Mutual Exclusion Graph

<!-- excerpt: packages/core/src/internals/ExclusionGraph.ts#exclusion-graph-build -->
<!-- prettier-ignore -->
```ts
/**
 * Build (or rebuild) the adjacency graph if it's stale. O(rule-pairs × bitmap-AND).
 */
private _ensureBuilt(): void {
  if (this._isCacheFresh()) {
    return;
  }

  this._adjacency.clear();
  const ruleIds = [...this._store.rules.value.keys()];

  for (let i = 0; i < ruleIds.length; i++) {
    const idA = ruleIds[i];

    /* v8 ignore next 3 -- defensive: noUncheckedIndexedAccess guard; ruleIds is a dense key array */
    if (idA === undefined) {
      continue;
    }
    const bitmapA = this._bitmapIndex.getBitmap(idA);
    let disjointA = this._adjacency.get(idA);

    if (disjointA === undefined) {
      disjointA = new Set();
      this._adjacency.set(idA, disjointA);
    }

    for (let j = i + 1; j < ruleIds.length; j++) {
      const idB = ruleIds[j];

      /* v8 ignore next 3 -- defensive: noUncheckedIndexedAccess guard; ruleIds is a dense key array */
      if (idB === undefined) {
        continue;
      }
      const bitmapB = this._bitmapIndex.getBitmap(idB);

      if (bitmapA.andCardinality(bitmapB) === 0) {
        // Mutually exclusive — record symmetrically.
        disjointA.add(idB);
        let disjointB = this._adjacency.get(idB);

        if (disjointB === undefined) {
          disjointB = new Set();
          this._adjacency.set(idB, disjointB);
        }
        disjointB.add(idA);
      }
    }
  }

  this._cachedSourceVersion = this._store.sourceDataVersion.value;
  this._cachedRulesFingerprint = this._fingerprintActiveRules();
}
```

### §6.4. Memoized Simulation

<!-- excerpt: packages/core/src/internals/SimulationCache.ts#simulation-cache-simulate -->
<!-- prettier-ignore -->
```ts
/**
 * Run (or cache-fetch) a simulation against the current store state.
 *
 * @param modification - The hypothetical state change to project
 * @returns Projected `{ resultCount, sample, wouldBeEmpty, cacheKey }`
 */
simulate(modification: SimulationModification): SimulationResult<T> {
  const cacheKey = this._buildCacheKey(modification);

  // 1. Cache hit — skipped entirely when the memoization layer is disabled.
  if (this._enabled) {
    const cached = this._cache.get(cacheKey);

    if (cached) {
      return cached;
    }
  }

  // 2. Exclusion-graph short-circuit (when attached). Only a plain "add this rule" question
  //    in flat-map mode is a pairwise-exclusion question; anything that also drops rules,
  //    swaps the expression or swaps the data is answered by evaluation below.
  if (this._exclusionGraph && modification.withRule && this._isPlainWithRule(modification)) {
    const [withRuleId, withRule] = modification.withRule;

    if (this._exclusionGraph.isReady && this._exclusionGraph.wouldExcludeAll(withRuleId, withRule)) {
      const result: SimulationResult<T> = {
        cacheKey,
        resultCount: 0,
        sample: [],
        wouldBeEmpty: true,
      };

      return this._memoize(cacheKey, result);
    }
  }

  // 3. Bitmap-intersection fast path (when attached + ready); `null` means "not a
  //    conjunction over the source data", answered by the predicate path.
  if (this._bitmapIndex && this._bitmapIndex.isReady) {
    const intersected = this._bitmapIndex.simulateIntersection(modification);

    if (intersected !== null) {
      return this._memoize(cacheKey, this._buildResult(intersected, cacheKey));
    }
  }

  // 4. Predicate-evaluator fallback — always correct, always available.
  const projected = this._evaluateViaPredicate(modification);

  return this._memoize(cacheKey, this._buildResult(projected, cacheKey));
}
```

<!-- excerpt: packages/core/src/internals/SimulationCache.ts#simulation-cache-invalidate -->
<!-- prettier-ignore -->
```ts
/**
 * Invalidate the cache in response to a dispatcher action. Coarse but correct — every action
 * type can change a simulation outcome, so every action clears the whole cache (`RULE_CHANGED`
 * included: the "what if the price ceiling were 100?" answer must reflect the slider the user
 * just dragged).
 */
invalidate(action: Action): void {
  switch (action.type) {
    case 'EXPRESSION_SET':
    case 'GROUP_ADDED':
    case 'GROUP_REMOVED':
    case 'RESET':
    case 'RULE_ADDED':
    case 'RULE_CHANGED':
    case 'RULE_REMOVED':
    case 'RULES_CLEARED':
    case 'SOURCE_DATA_SET':
    case 'WORKING_SET_RESET':
    case 'WORKING_SET_SET':
      this._cache.clear();

      return;
  }
}
```

### §6.5. How they compose

A typical hot-path flow when a UI is rendering filter options:

```text
For each of 20 color options:
  engine.simulate({ withRule: ['color', new InSetRule(['color'], [option])] })
    │
    ├─ SimulationCache.simulate(mod)
    │      │
    │      ├─ cache.get(key)  → hit? return cached
    │      │
    │      ├─ exclusionGraph.areExclusive(...) → exclusive? return {wouldBeEmpty: true}
    │      │
    │      └─ bitmapIndex.simulateIntersection(mod)
    │              │
    │              └─ RoaringBitmap.and(...) → count → return result
    │
    └─ cache.set(key, result)
```

Measured by `simulate-per-option` (`benchmarks/RESULTS.md`: 40 options of one field, two standing rules) on 2026-10-15,
over the synthetic wine tiers of 10k and 150k items:

| Path                                                          | 10k items | 150k items |
| ------------------------------------------------------------- | --------- | ---------- |
| Predicate evaluator, no cache                                 | 27.6 ms   | 420.6 ms   |
| Bitmaps, no cache (each candidate's bitmap built, then ANDed) | 9.9 ms    | 241.1 ms   |
| Warm cache                                                    | 0.09 ms   | 0.09 ms    |

The exclusion-graph short-circuit is consulted only once the graph is built (`'eager'`, or after
`precomputeExclusions()`), and then only for a plain `withRule` question in flat-map mode with conjunctive groups; its
O(1) direct queries (`areExclusive`, `getExclusions`) are where it pays.

---

## §7. Similarity — MinHash + LSH

`attachSimilarity(engine, config)` from `@filter-enginez/core/similarity` returns a `SimilaritySearch` whose
`findSimilar(item, options)` and `findSimilarByFeatureSet(features, options)` use MinHash for fast approximate Jaccard
similarity + LSH for sub-linear candidate lookup. It is memoized per engine and rebuilds its index lazily when the
source data changes.

### §7.1. MinHash signature computation

<!-- excerpt: packages/core/src/similarity/MinHash.ts#minhash-signature -->
<!-- prettier-ignore -->
```ts
/**
 * Compute the MinHash signature for an item's attribute set.
 *
 * @param attributes - The string-set representation of the item — typically built by the
 *   `SimilaritySearch` config's `signatureFn` or by extracting `attributes` paths
 * @returns A fixed-length signature (`Uint32Array` of `numHashes` elements)
 *
 * @remarks
 * Empty input set returns an all-`0xffffffff`-sentinel signature. Comparing two such
 * signatures gives a (misleading) similarity of 1.0 since every slot matches — consumers
 * should filter out empty-signature items before similarity ranking, or special-case via
 * `isAllSentinel(sig)`.
 */
signature(attributes: ReadonlySet<string>): Uint32Array {
  const k = this.numHashes;
  const sig = new Uint32Array(k);

  // Sentinel = max u32; we track the minimum as we scan elements.
  sig.fill(0xffffffff);

  for (const element of attributes) {
    const baseHash = murmur3_32(element, this.seed);

    for (let i = 0; i < k; i++) {
      // `i` is provably in-bounds (`i < k`, and all three typed arrays have length `k`),
      // so `?? 0` is a no-op fallback that satisfies noUncheckedIndexedAccess without a
      // non-null assertion. `a`/`b` are coefficients; `current` is the running minimum.
      // noUncheckedIndexedAccess fallbacks — `i < k` and all three typed arrays have length
      // `k`, so each `??` right-hand side is unreachable. Per-line ignores (a single
      // multi-line `v8 ignore next 3` does NOT reliably span three separate statements).
      /* v8 ignore next -- defensive: i < k; _aValues has length k */
      const a = this._aValues[i] ?? 0;
      /* v8 ignore next -- defensive: i < k; _bValues has length k */
      const b = this._bValues[i] ?? 0;
      /* v8 ignore next -- defensive: i < k; sig has length k */
      const current = sig[i] ?? 0xffffffff;
      // `(a * baseHash + b) mod p`. `Math.imul` keeps the multiply in 32-bit signed
      // space; the `>>> 0` converts to unsigned before the modulo. The modulo on a
      // 32-bit-bounded numerator with prime `p = 2^31 - 1` gives a value in `[0, p)`.
      const h = (((Math.imul(a, baseHash) >>> 0) + b) >>> 0) % MERSENNE_31;

      if (h < current) {
        sig[i] = h;
      }
    }
  }

  return sig;
}
```

<!-- excerpt: packages/core/src/similarity/MinHash.ts#minhash-jaccard-estimate -->
<!-- prettier-ignore -->
```ts
/**
 * Approximate the Jaccard similarity between two signatures by counting matching positions.
 *
 * @param signatureA - First MinHash signature
 * @param signatureB - Second MinHash signature (must be same length as `signatureA`)
 * @returns A value in `[0, 1]` approximating `|A ∩ B| / |A ∪ B|`
 *
 * @remarks
 * **Static** because the estimator is signature-shape-agnostic — only the count of matching
 * slots matters. Doesn't need a `MinHash` instance to compute.
 *
 * **Standard-error.** The estimator's standard error is `~1/sqrt(numHashes)` — for the
 * default `numHashes=128` that's ~9% standard error. Tighten by raising `numHashes` at the
 * cost of proportionally more signature storage + computation.
 *
 * @throws `FilterEngineConfigError` with code `SIMILARITY_SIGNATURE_MISMATCH` if the two
 *   signatures differ in length (they came from `MinHash` instances with different `numHashes`)
 */
static jaccardEstimate(signatureA: Uint32Array, signatureB: Uint32Array): number {
  if (signatureA.length !== signatureB.length) {
    throw new FilterEngineConfigError(
      'SIMILARITY_SIGNATURE_MISMATCH',
      `MinHash.jaccardEstimate: signature lengths must match (got ${signatureA.length} vs ${signatureB.length})`,
    );
  }
  let matches = 0;

  for (let i = 0; i < signatureA.length; i++) {
    if (signatureA[i] === signatureB[i]) {
      matches++;
    }
  }

  return matches / signatureA.length;
}
```

`murmur3_32` is a small pure-JS implementation of the well-known algorithm, in `lib/murmur3.ts`, shared by `MinHash` and
`BloomFilter`.

### §7.2. LSH banding

<!-- excerpt: packages/core/src/similarity/LSH.ts#band-bucket-key -->
<!-- prettier-ignore -->
```ts
/**
 * Compute the bucket key for one band of a signature.
 *
 * @remarks
 * FNV-1a over the `bandSize` consecutive u32 values starting at `bandIndex * bandSize`.
 * The XOR-then-multiply mix is what gives FNV its avalanche; over typical signature inputs
 * the bucket distribution is uniform enough that collision rates match the theoretical
 * predictions of the LSH analysis.
 *
 * @param signature - The full MinHash signature
 * @param bandStart - Index of the first signature slot in this band (`bandIndex * bandSize`)
 * @param bandSize - Number of signature slots in each band
 * @returns 32-bit bucket key for this band
 */
function bandBucketKey(signature: Uint32Array, bandStart: number, bandSize: number): number {
  let h = FNV_OFFSET;

  for (let i = 0; i < bandSize; i++) {
    /* v8 ignore next -- defensive: noUncheckedIndexedAccess fallback; bandStart + i < numHashes = signature.length */
    const slot = signature[bandStart + i] ?? 0;

    h ^= slot;
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }

  return h;
}
```

<!-- excerpt: packages/core/src/similarity/LSH.ts#lsh-construct-and-insert -->
<!-- prettier-ignore -->
```ts
/** Number of bands the signature is split into — `numHashes / bandSize`. */
readonly numBands: number;

/**
 * Bucket index — `bandIndex -> bucketKey -> Set<itemIndex>`. The outer Map is fixed-size
 * (`numBands` entries) and pre-populated in the constructor; the inner Maps grow as items
 * insert.
 */
private readonly _bucketsByBand: Map<number, Set<number>>[];

constructor(
  readonly numHashes: number = 128,
  readonly bandSize: number = 8,
) {
  if (numHashes <= 0 || !Number.isInteger(numHashes)) {
    throw new FilterEngineConfigError(
      'SIMILARITY_INVALID_OPTIONS',
      `LSH: numHashes must be a positive integer, got ${numHashes}`,
    );
  }
  if (bandSize <= 0 || !Number.isInteger(bandSize)) {
    throw new FilterEngineConfigError(
      'SIMILARITY_INVALID_OPTIONS',
      `LSH: bandSize must be a positive integer, got ${bandSize}`,
    );
  }
  if (numHashes % bandSize !== 0) {
    throw new FilterEngineConfigError(
      'SIMILARITY_INVALID_OPTIONS',
      `LSH: numHashes (${numHashes}) must be divisible by bandSize (${bandSize}) — ` +
      `leftover signature slots would create an undersized final band, distorting the recall curve.`,
    );
  }

  this.numBands = numHashes / bandSize;
  this._bucketsByBand = Array.from(
    { length: this.numBands },
    () => new Map<number, Set<number>>(),
  );
}

/**
 * Insert an item's signature into its LSH buckets.
 *
 * @param itemIndex - The source-data index (or any unique integer id the consumer uses
 *   to refer back to items in `queryCandidates` results)
 * @param signature - The item's MinHash signature (must have length `numHashes`)
 */
insert(itemIndex: number, signature: Uint32Array): void {
  if (signature.length !== this.numHashes) {
    throw new FilterEngineConfigError(
      'SIMILARITY_SIGNATURE_MISMATCH',
      `LSH.insert: signature length ${signature.length} does not match expected ${this.numHashes}`,
    );
  }
  for (let bandIndex = 0; bandIndex < this.numBands; bandIndex++) {
    const key = bandBucketKey(signature, bandIndex * this.bandSize, this.bandSize);
    const bucketMap = this._bucketsByBand[bandIndex];

    /* v8 ignore next 3 -- defensive: noUncheckedIndexedAccess guard; _bucketsByBand is dense (length numBands) */
    if (bucketMap === undefined) {
      continue;
    }
    let bucket = bucketMap.get(key);

    if (!bucket) {
      bucket = new Set();
      bucketMap.set(key, bucket);
    }
    bucket.add(itemIndex);
  }
}
```

**The in-place read and the numeric key are both load-bearing.** `bandBucketKey` reads the band straight out of the
signature (`bandStart`, no `slice`) and mixes it with FNV-1a into a number, so inserting and querying allocate nothing
per band and the bucket maps are integer-keyed. `numBands` is a derived readonly field (`numHashes / bandSize`), and the
constructor validates that `numHashes % bandSize === 0`, because a remainder would create an undersized final band and
distort the recall curve.

**The recall curve.** With `b` bands of `r` rows, two items whose true Jaccard similarity is `s` share at least one
bucket — and so become candidates — with probability `1 − (1 − s^r)^b`. At the defaults (`numHashes: 128`,
`bandSize: 8`, so 16 bands of 8 rows) that is about 0.06 at `s = 0.5`, 0.24 at 0.6, 0.61 at 0.7, 0.95 at 0.8 and ≈1.0 at
0.9: the curve's midpoint is near `(1/b)^(1/r) ≈ 0.71`. Candidates are then verified against the exact MinHash estimate
and the `threshold` (default 0.5), so results never include an item below the threshold; recall for items between the
threshold and the curve's midpoint is probabilistic. For thresholds in the 0.4–0.6 range, pass `bandSize: 4` (32 bands
of 4 rows; midpoint ≈ 0.42, about 0.87 at `s = 0.5`), which trades more candidates for that recall.

### §7.3. The orchestrator

<!-- excerpt: packages/core/src/similarity/SimilaritySearch.ts#similarity-find-similar -->
<!-- prettier-ignore -->
```ts
/**
 * Find the top-k items most similar to `item` in the current source data.
 *
 * @param item - The query item — typically one already in the dataset (its own signature
 *   match is filtered out of results), but can also be a freshly-constructed "hypothetical
 *   query item" with the same shape.
 * @param options - Per-call query options (k, threshold override)
 * @returns Items sorted by similarity descending, length ≤ k. Empty array if no
 *   configuration is set, no source data is available, or no candidates pass threshold.
 */
findSimilar(item: T, options?: SimilarityQuery): SimilarityResult<T>[] {
  const configured = this._ensureConfigured();
  const { config, getSourceData } = configured;
  const { lsh, minHash, signatures } = this._ensureIndexBuilt(configured);
  const items = getSourceData();

  const querySig = minHash.signature(extractFeatureSet(item, config));
  const candidates = lsh.queryCandidates(querySig);

  const k = options?.k ?? 5;
  const threshold = options?.threshold ?? config.threshold ?? 0.5;

  const ranked: SimilarityResult<T>[] = [];

  for (const idx of candidates) {
    const candidate = items[idx];

    // Skip the query item itself (identity match) — consumers expect "items LIKE this,"
    // not "this item." Identity is detected by exact reference equality.
    if (candidate === item) {
      continue;
    }
    if (candidate === undefined) {
      continue;
    }
    const candidateSig = signatures[idx];

    /* v8 ignore next 3 -- defensive: signatures is parallel-indexed with items, so a valid idx always resolves to a signature */
    if (candidateSig === undefined) {
      continue;
    }
    const sim = MinHash.jaccardEstimate(querySig, candidateSig);

    if (sim >= threshold) {
      ranked.push({ item: candidate, similarity: sim });
    }
  }

  // Sort descending by similarity; slice to top-k. For small candidate sets the full
  // sort is cheaper than a heap-based top-k.
  ranked.sort((a, b) => b.similarity - a.similarity);

  return ranked.slice(0, k);
}
```

<!-- excerpt: packages/core/src/similarity/SimilaritySearch.ts#similarity-index-build -->
<!-- prettier-ignore -->
```ts
/**
 * Build (or rebuild) the MinHash + LSH + per-item signature cache if it's stale relative
 * to the current source-data version. Returns the live index handles so callers don't
 * re-narrow the cached optional fields.
 */
private _ensureIndexBuilt(handles: EnsureConfiguredHandles<T>): {
  lsh: LSH;
  minHash: MinHash;
  signatures: Uint32Array[];
} {
  const { config, getSourceData, getSourceDataVersion } = handles;
  const currentVersion = getSourceDataVersion();

  if (
    this._cachedVersion === currentVersion
    && this._itemSignatures
    && this._lsh
    && this._minHash
  ) {
    // Cache is fresh.
    return { lsh: this._lsh, minHash: this._minHash, signatures: this._itemSignatures };
  }

  const numHashes = config.numHashes ?? 128;
  const bandSize = config.bandSize ?? 8;

  const minHash = new MinHash(numHashes);
  const lsh = new LSH(numHashes, bandSize);
  const items = getSourceData();
  const signatures: Uint32Array[] = new Array<Uint32Array>(items.length);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (item === undefined) {
      continue;
    }
    const features = extractFeatureSet(item, config);
    const sig = minHash.signature(features);

    signatures[i] = sig;
    lsh.insert(i, sig);
  }

  this._minHash = minHash;
  this._lsh = lsh;
  this._itemSignatures = signatures;
  this._cachedVersion = currentVersion;

  return { lsh, minHash, signatures };
}
```

---

## §8. Bayesian Co-Occurrence

The "suggested filters" feature: empirical co-occurrence over recorded sessions predicts the next-likely filter
selections, combining the evidence from each selected rule with noisy-OR (§8.3).

The trio — `SessionTracker`, `BayesianModel`, `SuggestionEngine` — ships from `@filter-enginez/core/suggestions` and is
obtained with `attachSuggestions(engine)`, so consumers who never ask for suggestions never ship them:

- **It returns all three as one memoized bag**, keyed on the engine in a `WeakMap`. A caller recording sessions and a
  caller reading suggestions must share one `SessionTracker`; handing back the same bag on every call guarantees it.
- **The engine parameter is an identity key, not a data source.** Nothing is read from it.
- **It works on worker-backed engines** too: the main thread owns its trio, and the worker-side engine has none, so
  nothing can diverge.

### §8.1. Probability model

For each pair of rules `(X, Y)`:

```text
P(Y | X) = (sessions where both X and Y were active) / (sessions where X was active)
```

Stored as `singleCounts: Map<RuleId, number>` (sessions containing X), `pairCounts: Map<RuleId, Map<RuleId, number>>`
(sessions containing both, populated symmetrically so either direction is O(1)) and the session total. Probabilities are
raw empirical frequencies, without smoothing. The model retrains lazily, whenever the tracker's `version` has moved —
every recorded session and every `clear()` moves it, including once the 500-session buffer is full and evicting.

### §8.2. Session tracking

<!-- excerpt: packages/core/src/suggestions/SessionTracker.ts#session-tracker -->
<!-- prettier-ignore -->
```ts
/**
 * A single recorded session — the active rule IDs at a moment + timestamp.
 */
export interface SessionRecord {
  readonly ruleIds: ReadonlySet<RuleId>;
  readonly timestamp: number;
}

/**
 * Bounded FIFO buffer of session records, with a change counter the model trains against.
 */
export class SessionTracker {
  private readonly _recordedSessions: SessionRecord[] = [];
  private _version = 0;

  constructor(readonly maxSessions: number = 500) {}

  /**
   * Record the currently-active rule set as a session for the Bayesian model to learn from.
   *
   * Typical consumer usage: call this on a debounced timer (e.g., 5s of stable selection)
   * or on a meaningful UX event (e.g., "user clicked a result"). The model gets sharper as
   * more sessions accumulate.
   *
   * @param activeRuleIds - The active rule IDs to record
   */
  recordSession(activeRuleIds: readonly RuleId[]): void {
    this._recordedSessions.push({
      ruleIds: new Set(activeRuleIds),
      timestamp: Date.now(),
    });
    while (this._recordedSessions.length > this.maxSessions) {
      this._recordedSessions.shift();
    }
    this._version++;
  }

  /**
   * Increments on every `recordSession` and `clear`. `BayesianModel` retrains when it changes —
   * unlike `size`, it keeps moving once the buffer is full and the oldest session is evicted
   * for each new one.
   */
  get version(): number {
    return this._version;
  }

  /** Iterate session records oldest to newest. */
  *sessions(): IterableIterator<SessionRecord> {
    yield* this._recordedSessions;
  }

  /** Number of currently-retained sessions. */
  get size(): number {
    return this._recordedSessions.length;
  }

  /** Drop all sessions. */
  clear(): void {
    this._recordedSessions.length = 0;
    this._version++;
  }
}
```

### §8.3. Suggestion algorithm

<!-- excerpt: packages/core/src/suggestions/SuggestionEngine.ts#get-suggestions -->
<!-- prettier-ignore -->
```ts
/**
 * Suggest the top-k most-likely-next filters given the user's current selection.
 *
 * @param currentSelection - The currently-active rule IDs (excluded from suggestions)
 * @param k - Number of suggestions to return. Default 3.
 * @returns Top-k suggestions sorted by joint probability descending. Empty if no
 *   training data is available.
 */
getSuggestions(currentSelection: readonly RuleId[], k = 3): SuggestionResult[] {
  this._model.trainIfStale(this._tracker);

  if (this._model.trainedSessionCount === 0) {
    return [];
  }

  const selectionSet = new Set(currentSelection);
  const candidateScores = new Map<RuleId, number>();

  if (currentSelection.length === 0) {
    // Cold-start: rank by marginal popularity. No selection-set exclusion is needed here —
    // `selectionSet` is built from an empty `currentSelection`, so nothing is ever excluded.
    for (const candidateId of this._model.allKnownRules()) {
      const marginal = this._model.marginal(candidateId);

      /* v8 ignore next -- defensive: every rule from allKnownRules() has singleCount >= 1, so marginal is always > 0 */
      if (marginal > 0) {
        candidateScores.set(candidateId, marginal);
      }
    }
  } else {
    // Noisy-OR over the per-selection conditionals.
    // For each X in selection, walk P(Y | X) for every Y in its conditional table.
    // Combine into 1 - Π(1 - P(Y | X_i)) per candidate Y.
    //
    // Initialize each candidate's "miss probability" to 1.0; multiply by `(1 - P(Y|X))`
    // as we accumulate evidence. Final score is `1 - missProbability`.
    const missProbabilities = new Map<RuleId, number>();

    for (const selectedRuleId of currentSelection) {
      for (const [candidateRuleId, conditionalProb] of this._model.conditionalsFor(selectedRuleId)) {
        if (selectionSet.has(candidateRuleId)) {
          continue;
        }
        const currentMiss = missProbabilities.get(candidateRuleId) ?? 1;

        missProbabilities.set(candidateRuleId, currentMiss * (1 - conditionalProb));
      }
    }

    for (const [candidateRuleId, missProb] of missProbabilities) {
      candidateScores.set(candidateRuleId, 1 - missProb);
    }

    // Fill for candidates with no co-occurrence with the current selection — marginal
    // popularity, scaled below the weakest co-occurrence score so these only ever rank
    // after every evidence-backed candidate.
    if (candidateScores.size < k) {
      const weakestScore = Math.min(1, ...candidateScores.values());

      for (const candidateId of this._model.allKnownRules()) {
        if (selectionSet.has(candidateId) || candidateScores.has(candidateId)) {
          continue;
        }
        const marginal = this._model.marginal(candidateId);

        // marginal ≤ 1, so marginal × 0.01 × weakestScore < weakestScore: strictly below
        // every co-occurrence score, while keeping the fill ordered by popularity.
        /* v8 ignore next -- defensive: every rule from allKnownRules() has singleCount >= 1, so marginal is always > 0 */
        if (marginal > 0) {
          candidateScores.set(candidateId, marginal * 0.01 * weakestScore);
        }
      }
    }
  }

  // Sort descending; slice to top-k.
  const ranked: SuggestionResult[] = [];

  for (const [ruleId, probability] of candidateScores) {
    ranked.push({ probability, ruleId });
  }
  ranked.sort((a, b) => b.probability - a.probability);

  return ranked.slice(0, k);
}
```

`getSuggestions` combines by **noisy-OR** — `P(Y|S) ≈ 1 − Π(1 − P(Y|X_i))` — which treats each selected rule's
conditional as independent evidence for `Y` and stays sensible when selection rules are correlated ("Cabernet" and "red"
co-occur trivially). With an empty selection it ranks by marginal popularity. When a selection has fewer than `k`
co-occurring candidates, the remaining slots are filled by marginal popularity scaled below the weakest co-occurrence
score, so the fill always ranks after every evidence-backed candidate.

### §8.4. Obtaining the trio

```ts
import type { FilterEngine } from '@filter-enginez/core';

import { attachSuggestions } from '@filter-enginez/core/suggestions';

declare const engine: FilterEngine<unknown>;

const { bayesianModel, sessionTracker, suggestions } = attachSuggestions(engine);

sessionTracker.recordSession(engine.getActiveRuleIds()); // typically debounced
const next = suggestions.getSuggestions(engine.getActiveRuleIds(), 3);
```

`attachSuggestions(engine)` is idempotent per engine — every call returns the identical bag. Session recording stays the
consumer's job (the engine records nothing itself), which is why the tracker is handed back alongside the reader rather
than hidden behind it.

---

## §8a. Bloom Membership + Inverted Text Index

Two further structures sit beside the four named algorithms:

1. a **Bloom-filter primitive** (`lib/BloomFilter.ts`) powering a serializable membership pre-screen rule
   (`BloomMembershipRule`, the 15th rule), and
2. a **Roaring-backed inverted text index** (`internals/TextInvertedIndex.ts`) accelerating `TextSearchRule`'s
   whole-word `allWords` mode and `FuzzySearchRule` — the fifth acceleration axis (`acceleration.textIndex`).

They are independent: the text index works on exact postings and does not use the Bloom primitive.

### §8a.1. The Bloom-filter primitive + `BloomMembershipRule`

A Bloom filter answers _"is X possibly in set S?"_ with no false negatives, a tunable false-positive rate, O(k) probes,
and a compact fixed-size bitset — the classic space/precision trade for set membership.

- **`lib/BloomFilter.ts`** — an isomorphic, pure-JS primitive: `(m, k)` derived from a target false-positive rate +
  expected item count via `forCapacity`; `add` / `test` / `serialize` / `deserialize`. Bit indices come from
  Kirsch-Mitzenmacher double hashing over two `murmur3_32` seeds (the shared `lib/murmur3.ts`, also used by `MinHash`),
  and a runtime-neutral `lib/base64.ts` codec (no `btoa` / `Buffer`) backs the bitset serialization. `BloomFilter`,
  `SerializedBloomFilter`, and `BloomFilterOptions` are exported from the barrel.
- **`BloomMembershipRule` (the 15th rule)** — opt-in, registry-registered, serializable membership against a prebuilt
  set too large to ship inline ("is this id in this multi-million-element deny/allow list?"). Serializing the bitset
  instead of the raw set is the strongest isomorphic/edge story and rides the existing URL-state / worker-bridge /
  JSON-config round-trip. Because it can false-positive it is a _pre-screen_ — pair it with an exact check where a false
  positive would be incorrect, or accept the documented rate. It coerces primitive field values with `String(value)`
  (`null`, `undefined` and objects never match) and takes a prebuilt filter.

### §8a.2. The inverted text index

A **Roaring-backed inverted text index** answers whole-word and fuzzy queries with a candidate bitmap that composes with
the other rules' bitmaps in one native intersection. (A per-item token Bloom pre-screen does not serve this case:
substring matching with native `String.includes` is already faster than k probes per token.)

**The design** — `internals/TextInvertedIndex.ts` + `internals/textPlan.ts`, wired into
`BitmapIndex._buildBitmapForRule` beside the geo path (the `SpatialIndex` precedent). Per-field
`word -> RoaringBitmap32` and `trigram -> RoaringBitmap32` postings, built lazily and separately, invalidated on the
source-data version counter, living inside `BitmapIndex`. `compileTextPlan(rule)` returns one of three DISTINCT shapes
so a candidate can never be used unconfirmed:

- **`allWords`** (a new whole-word `TextSearchMode`, case-insensitive) is **authoritative** — an exact AND of the query
  words' postings, no confirm.
- **`FuzzySearchRule`** (single-field, strict-enough threshold) is a **candidate** — a trigram-overlap pre-filter via
  the provably-sound bound `minShared = D - 3e` with `e = maxFuseErrors(m, t)` (`internals/fuzzyTrigramBound.ts`,
  guarded by a Fuse-version-pinned fuzz test), then an exact Fuse confirm on the survivors.
- **everything else** is a **bypass** to the per-item predicate scan: substring / `tokenized` / exact (native
  `String.includes` wins), case-sensitive `allWords`, an empty or punctuation-only query, multi-key fuzzy, any fuzzy
  query whose sound bound proves nothing (`D − 3e ≤ 0`, which includes Fuse's default threshold of 0.4 for typical query
  lengths), and fuzzy with an option that changes what the query means: `ignoreDiacritics` (`café` matches `cafe`, which
  shares none of its accented trigrams), `useExtendedSearch` and `useTokenSearch`. The other Fuse options keep the bound
  sound — `ignoreLocation`, `location` and `distance` only add a non-negative location term to the score,
  `minMatchCharLength` only rejects matches, `isCaseSensitive` matches a subset of the lowercased comparison, and the
  norm options and `findAllMatches` never change which items match. A bypassed fuzzy rule's scan is one Fuse search over
  the whole collection (§4.3, `FuzzySearchRule`).

`acceleration.textIndex` is `'auto' | 'off' | 'on'`. `'auto'` engages at source data at or above
`TEXT_INDEX_AUTO_THRESHOLD` (500, aligned with the bitmap auto-threshold — below it a single scan is sub-millisecond and
the posting-build cost is not repaid); `'on'` engages at any size; `'off'` always uses the predicate scan. The index
serves the bitmap build, so it is in effect only while bitmaps are engaged (`acceleration.bitmap: 'on'` engages them at
any size). Measured on 2026-10-15 over the 150k synthetic wine tier (`benchmarks/RESULTS.md`): `allWords` 402×,
fuzzy@0.2 about 2.5×, fuzzy@0.4 1.0× (the bypass).

### §8a.3. Constraints both inherit

Both are isomorphic (pure JS, no browser globals). `BloomMembershipRule` registers via `ruleRegistry` with a custom
`serialize` / `deserialize` (the bitset is the config).

---

## §9. JSON Config + Rule Registry

### §9.1. `RuleRegistry`

<!-- excerpt: packages/core/src/rules/ruleRegistry.ts#register -->
<!-- prettier-ignore -->
```ts
/**
 * Registry mapping type names to rule classes.
 */
export class RuleRegistry {
  private readonly _entries = new Map<string, RuleClass>();

  constructor() {
    this._registerBuiltins();
  }

  /**
   * Register a custom rule class under a type name.
   *
   * @remarks
   * **`typeName` and `ruleClass.ruleTypeName` must agree, and the signature enforces it.** The
   * generic parameter binds the two: a class declaring `static override readonly ruleTypeName =
   * 'ContainsAllRule'` has the literal type `'ContainsAllRule'`, so registering it under any
   * other name is a **compile-time** error, and a subclass that forgot to declare the static
   * inherits the base's `string` — which is not assignable to the literal, so that is a
   * compile-time error too.
   *
   * **`NoInfer` is load-bearing, not decoration.** Without it TypeScript infers `RuleTypeName`
   * from BOTH arguments, so a class that never declared the static contributes its inherited
   * `string`, the parameter resolves to `string`, and every name argument satisfies it — the
   * check silently accepts exactly the case it exists to reject. Pinning inference to `typeName`
   * makes the class side a pure assignability check against the literal.
   *
   * The runtime check below covers what the type system cannot reach: JavaScript consumers, and
   * TypeScript consumers who cast. It exists because the failure it guards is otherwise silent
   * until a production build — see `./ruleTypeName.ts`.
   *
   * @param typeName - The wire name; must equal `ruleClass.ruleTypeName`
   * @param ruleClass - The rule class to revive under that name
   * @throws `RuleRegistryError` with code `REGISTRY_DUPLICATE` if already registered
   * @throws `RuleRegistryError` with code `REGISTRY_TYPE_NAME_MISMATCH` if the class's declared
   *   `ruleTypeName` is not `typeName`
   */
  register<RuleTypeName extends string>(
    typeName: RuleTypeName,
    ruleClass: { readonly ruleTypeName: NoInfer<RuleTypeName> } & RuleClass,
  ): void {
    if (this._entries.has(typeName)) {
      throw new RuleRegistryError(
        'REGISTRY_DUPLICATE',
        `Rule type '${typeName}' is already registered. Use a different type name or call unregister() first.`,
      );
    }
    if (ruleClass.ruleTypeName !== typeName) {
      throw new RuleRegistryError(
        'REGISTRY_TYPE_NAME_MISMATCH',
        `Rule class declares ruleTypeName '${String(ruleClass.ruleTypeName)}' but is being registered as `
        + `'${typeName}'. These must match: serialize() writes the class's ruleTypeName, and deserialize() `
        + `looks up the registry key, so a mismatch means rules serialize into a form nothing can revive.`,
      );
    }
    this._entries.set(typeName, ruleClass);
  }
```

<!-- excerpt: packages/core/src/rules/ruleRegistry.ts#deserialize -->
<!-- prettier-ignore -->
```ts
/**
 * Reconstruct a rule instance from its serialized form.
 *
 * **Three paths, checked in this order:**
 *
 *   1. **`CompositeRule`** — rebuilt by `_deserializeComposite`, which deserializes each
 *      nested child through the registry first (the generic path would leave a composite's
 *      `config.rules` as plain objects with no `action`).
 *   2. **Per-class `static deserialize(json)` hook** — when present on the rule class, it's
 *      called with the class as `this` and the result returned. Used by rules with
 *      non-JSON-safe config values: `RegexRule` (rebuild `RegExp` from `{ source, flags }`),
 *      `DateRangeRule` (rebuild `Date` instances from ISO strings), and the rules with numeric
 *      bounds — `RangeRule`, `NumericComparisonRule`, `GeoProximityRule`, `FuzzySearchRule` —
 *      which read the `null` JSON writes for `±Infinity` as an open bound. Custom subclasses
 *      can opt into this same hook pattern by adding their own static `deserialize` method.
 *   3. **Generic path** — fallback for rules whose config is already JSON-safe (most of the
 *      built-in catalog). Constructs the instance via `new ruleClass(field, config)` so
 *      class-field initializers (most importantly `action`) actually run, then overwrites
 *      `config` with the serialized payload to handle constructors that transform their
 *      input (e.g., `InSetRule` wraps `initialSet` in `{ set: [...initialSet] }`). A
 *      try/catch around the two-arg call covers rules whose second-arg shape is
 *      structurally incompatible with the serialized config (`InSetRule`'s `initialSet`
 *      expects an iterable, not an object); for those we fall back to single-arg
 *      construction and rely entirely on the post-construct config assignment.
 *
 * **Why the generic path constructs rather than using `Object.create`.**
 * `Object.create(ruleClass.prototype)` would give the correct prototype chain but no
 * instance fields — and `action` is declared as a class-field arrow function
 * (`override action: FilterRuleAction = (item, rule) => {...}`), not a prototype method, so
 * the instance would have `action === undefined`. Invoking the constructor runs the field
 * initializers; the overwriting `config` assignment handles constructors that transform
 * their input.
 *
 * @throws `RuleRegistryError` if the type is not registered
 */
deserialize(json: SerializedRule): FilterRule {
  const ruleClass = this.get(json.type);

  // Composite rules carry their children as nested `SerializedRule` objects (see
  // `CompositeRule.serialize`), not live instances. Rebuild each child through the registry
  // before constructing the parent — the generic path below only reconstructs the top-level
  // rule and would leave a composite's `config.rules` as plain objects with no `action`.
  if (ruleClass === CompositeRule) {
    return this._deserializeComposite(json);
  }

  // Per-class custom hook — checked via duck-typing for a `static deserialize` method. Called
  // with the class as `this`, so an inherited hook that constructs `new this(...)` revives a
  // registered subclass as itself.
  const customDeserialize = (ruleClass as unknown as {
    deserialize?: (this: RuleClass, json: SerializedRule) => FilterRule;
  }).deserialize;

  if (typeof customDeserialize === 'function') {
    return customDeserialize.call(ruleClass, json);
  }

  const field = json.field === '<function>' ? undefined : (json.field);
  const RuleClassCtor = ruleClass;

  let instance: FilterRule;

  try {
    // Common path — every built-in rule whose constructor accepts (field, config)
    // directly and has no hook: ValueRule, BooleanRule, TextSearchRule,
    // HierarchicalRule, etc.

    instance = new RuleClassCtor(field, json.config);
  } catch {
    // Fallback — a rule with no hook whose second constructor arg is structurally
    // incompatible with the serialized config, for example a consumer rule declared as
    // `(field, values: readonly string[])` that spreads its second arg: passing
    // `{ values: [...] }` throws "object is not iterable". (The built-ins of that shape,
    // such as `InSetRule`, have their own hooks.) Single-arg construction + post-construct
    // config assignment is correct for these.

    instance = new RuleClassCtor(field);
  }
  // Always overwrite config with the serialized payload — covers both the
  // constructor-transformed cases (InSetRule wrapping the array) AND any mismatch between
  // "what the constructor accepts" vs "what serialize() writes back out." Without this
  // assignment, the engine would see the constructor's default config, not the
  // consumer's intent.
  (instance as { config: unknown }).config = json.config;

  return instance;
}
```

Every registry failure throws `RuleRegistryError` with one of three codes: `REGISTRY_DUPLICATE` and
`REGISTRY_TYPE_NAME_MISMATCH` from `register`, `REGISTRY_UNKNOWN_TYPE` from `get` and therefore from `deserialize`.
`RuleRegistryErrorCode` is derived from `FilterEngineRuleErrorCode` (the `REGISTRY_*` members), and `RuleRegistryError`
extends `FilterEngineRuleError`, so `instanceof FilterEngineError` catches it alongside every other engine failure
(§2.5). A rule's own `static deserialize` hook reports a bad payload as `FilterEngineRuleError` with code
`RULE_INVALID_SERIALIZED_CONFIG`.

### §9.2. JSON config shape

**`config/FilterEngineConfig.ts`.** The config document is `FilterEngineConfig`. Rules are id-paired `SerializedRule`s.
The optional expression tree is its own `SerializedExpressionNode` shape — a leaf node references a top-level rule by
`ruleId` (so one rule can appear in multiple places in the tree without duplication) and composite nodes recurse via
`children`. `version` is an integer (`CURRENT_CONFIG_VERSION`, currently `1`), migrated forward by `ConfigMigrator`
(§9.4).

<!-- excerpt: packages/core/src/config/FilterEngineConfig.ts#config-document -->
<!-- prettier-ignore -->
```ts
/**
 * Serialized expression tree node — recursive `CompositeRule` shape for JSON round-trip.
 *
 * @remarks
 * A leaf node is `{ type: 'rule', ruleId }` — a reference to a rule defined in the top-level
 * `rules` array of the config (so the same rule can appear multiple places in the tree
 * without duplication). Composite nodes recurse via `children`.
 */
export type SerializedExpressionNode =
  | {
    readonly children: readonly SerializedExpressionNode[];
    readonly op: 'and' | 'not' | 'or';
    readonly type: 'composite';
  }
  | {
    readonly ruleId: RuleId;
    readonly type: 'rule';
  };

/**
 * The full engine configuration document.
 *
 * @example
 *   const config: FilterEngineConfig = {
 *     version: 1,
 *     rules: [
 *       { id: 'price-range', rule: { type: 'RangeRule', field: 'price', config: { min: 0, max: 100 } } },
 *       { id: 'in-stock', rule: { type: 'BooleanRule', field: 'inStock', config: true } },
 *     ],
 *     groups: [
 *       { id: 'commerce', displayName: 'Commerce', filterIds: ['price-range', 'in-stock'], composition: 'and' },
 *     ],
 *     // Optionally an expression tree — when present, switches engine to expression mode.
 *     expression: {
 *       type: 'composite',
 *       op: 'and',
 *       children: [
 *         { type: 'rule', ruleId: 'price-range' },
 *         { type: 'rule', ruleId: 'in-stock' },
 *       ],
 *     },
 *   };
 */
export interface FilterEngineConfig {
  /** Schema version — drives `ConfigMigrator` decisions. Current schema is `1`. */
  readonly version: number;

  /** Optional human-readable label for the config (devtools display + debugging). */
  readonly label?: string;

  /**
   * The rule definitions — each entry pairs a `RuleId` with its serialized form. An entry marked
   * `inline: true` is a leaf of `expression` that was never registered on the engine: `loadConfig`
   * resolves the expression's references to it but does not register it, so it stops filtering
   * when the expression is cleared, exactly as it did before export.
   */
  readonly rules: readonly {
    readonly id: RuleId;
    /**
     * `true` for an expression leaf that is not a registered rule. Ids of the form
     * `__inline_<n>` are reserved for these; an entry with such an id that the expression
     * references is read as inline even without the flag.
     */
    readonly inline?: boolean;
    readonly rule: SerializedRule;
  }[];

  /** Optional filter groups. Empty/omitted means no facet grouping. */
  readonly groups?: readonly SerializedFilterGroup[];

  /**
   * Optional explicit expression tree. When present, the engine enters expression mode and
   * evaluates this tree instead of implicitly ANDing every rule (flat-map mode).
   */
  readonly expression?: SerializedExpressionNode;

  /** Arbitrary consumer-defined metadata. Round-trips through serialization untouched. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}
```

> **Expression serialization has two independent planes — by design.** This config plane uses `SerializedExpressionNode`
> (ruleId references, so shared rules aren't duplicated). The worker-bridge + reactive-adapter _wire_ plane instead uses
> `CompositeRule.serialize()` — a self-contained recursive `SerializedRule` tree (§5). They share no code; both
> round-trip an expression, but only the config plane deduplicates via rule references. Neither goes through the other.

### §9.3. Serialization round-trip

**`config/exportConfig.ts` + `config/loadConfig.ts`.** Two free functions (not a `ConfigSerializer` class). The
contract: `loadConfig(engine, exportConfig(engine))` reproduces the engine's state — the same registered rules, the same
groups, the same expression, and so the same results for every item, before and after the expression is cleared. Three
things fall outside it: a function `field` is written as `'<function>'` and cannot be revived; a `PredicateRule` cannot
be exported at all (`serialize()` throws); and a lone-leaf expression comes back wrapped in `and(...)`.

**Inline rules stay inline.** An expression leaf that was never registered with `addRule` (built with `and(...)` and
passed straight to `setExpression`) has no id of its own, so the exporter mints one, `__inline_{n}`: one per distinct
rule instance, numbered in depth-first order and skipping any id a registered rule holds. Its entry in `rules` is marked
`inline: true`, and `resolveConfig` revives it for the expression without returning it among the rules to register. The
loaded engine therefore registers exactly the rules the exporting one did, and clearing the expression leaves no leaf
behind still filtering. The `__inline_<n>` form is reserved: an unmarked entry with such an id that the expression
references is read as inline too. `configRoundTripBehavior.test.ts` checks export → load → export for an identical
document, the same registered rules, and the same match sets with the expression set and cleared.

**Open numeric bounds.** JSON has no `Infinity`, `-Infinity` or `NaN`; `JSON.stringify` writes each as `null`. A
document that crossed JSON (a `?f=` URL, devtools persistence over `localStorage`, an HTTP request body) therefore holds
`null` wherever a rule held an open bound, and each rule with a numeric bound reads that `null` back as open in its
`static deserialize` hook:

| Rule                    | Key                     | A `null` revives as                                                     |
| ----------------------- | ----------------------- | ----------------------------------------------------------------------- |
| `RangeRule`             | `min` / `max`           | `-Infinity` / `Infinity`                                                |
| `NumericComparisonRule` | `value`                 | `Infinity` under `<`, `<=`, `==`, `!=`; `-Infinity` under `>` and `>=`  |
| `GeoProximityRule`      | `radiusKm`              | `Infinity`                                                              |
| `FuzzySearchRule`       | `threshold`, `distance` | `Infinity`                                                              |
| `DateRangeRule`         | `start` / `end`         | absent (an ISO string is how a set bound travels; `null` is never 1970) |

The worker bridge moves rules by structured clone, which carries the infinities themselves, and the same hooks keep
them. Two cases cannot survive JSON and are documented rather than encoded: a bound on the wrong side (a `RangeRule`
with `min: Infinity`, empty whatever its `max`) and a `NaN` bound both arrive as `null` and revive as the open bound for
their position. A bound that is neither a number nor `null` (a string, a missing key, a `NaN` that arrived by structured
clone) throws `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG`, naming the rule type and the key.
Equality values (`ValueRule`, `InSetRule`, `InSetofSetsRule`) are compared as written, so a `null` there is the value
`null`. The same hooks check the options with no open form: `FuzzySearchRule`'s other Fuse options (a finite number, a
boolean, or `'all'` / `'any'` for `tokenMatch`) and the `arrayMatch` of `InSetRule`, `InSetofSetsRule` and
`HierarchicalRule` (`'any'` or `'all'`). `packages/core/src/config/configRoundTripBehavior.test.ts` holds every
registered rule type to the same match set before and after the trip, through JSON and through structured clone.

- **`exportConfig(engine, options?)`** reads `getRules()` / `getGroups()` / `getExpression()`. Each registered rule
  serializes via `rule.serialize()`; the expression is walked by `serializeExpression()` into a
  `SerializedExpressionNode` tree. A leaf that matches a registered rule emits `{ type: 'rule', ruleId }`; an _inline_
  rule (created via `and(rule1, rule2)` without a prior `addRule`) gets a synthetic `__inline_{n}` id minted and is
  appended to the exported `rules`, marked `inline: true`, so the round-trip resolves without registering it.
- **`loadConfig(engine, rawConfig, options?)`** (and the preview-only `resolveConfig`) migrate the config forward when
  `version !== CURRENT_CONFIG_VERSION`, `deserialize` every rule into a `rulesById` map, rebuild groups, then
  reconstruct the expression via `buildExpression()` — resolving each leaf's `ruleId` against `rulesById` and recursing
  composites into real `CompositeRule`s (a lone top-level leaf is wrapped in `and(...)`). It dispatches `clearRules()`
  (skipped with `clearExisting: false`) → `addRule()` × n for every rule that is not inline → `addGroup()` × n →
  `setExpression()` (only when the document carries an expression) through the engine's public API so the action log
  captures a clean replay.

```ts
import {
  exportConfig,
  type FilterEngine,
  type FilterEngineConfig,
  loadConfig,
  resolveConfig,
  type ResolvedConfig,
} from '@filter-enginez/core';
import type { Wine } from '@filter-enginez/mock-data/wine';

declare const engine: FilterEngine<Wine>;
declare const restored: FilterEngine<Wine>;

// Capture rules, groups and the expression tree as a document at CURRENT_CONFIG_VERSION.
const config: FilterEngineConfig = exportConfig(engine, { label: 'Saved view' });
const stored = JSON.stringify(config);

// Preview without touching an engine: migrate, revive every rule, rebuild the expression.
const preview: ResolvedConfig = resolveConfig(JSON.parse(stored) as Record<string, unknown>);
console.log(preview.rules.size, preview.groups.length, preview.expression !== null);

// Apply: clearRules() → addRule() × n → addGroup() × n → setExpression(), via the public API.
loadConfig(restored, JSON.parse(stored) as Record<string, unknown>);
```

### §9.4. Versioning

The `version` field is the migration anchor. `ConfigMigrator.register(fromVersion, step)` adds the step that upgrades a
document from `fromVersion` to `fromVersion + 1`; `migrate(rawConfig)` applies the steps in order up to
`CURRENT_CONFIG_VERSION`. A document without a `version` is read as version 1; a gap in the chain, or a document newer
than the runtime, throws:

```ts
import { type ConfigMigrationStep, ConfigMigrator, type FilterEngine, loadConfig } from '@filter-enginez/core';
import type { Wine } from '@filter-enginez/mock-data/wine';

declare const engine: FilterEngine<Wine>;
declare const stored: Record<string, unknown>; // a persisted config document, any older version

// A step is keyed by the version it migrates FROM and yields `from + 1`. Keep it pure.
const fillThemeDefault: ConfigMigrationStep = (v1) => ({
  ...v1,
  version: 2,
  metadata: { theme: 'light', ...(v1['metadata'] as Record<string, unknown> | undefined) },
});

const migrator = new ConfigMigrator();
migrator.register(1, fillThemeDefault); // runs only once CURRENT_CONFIG_VERSION reaches 2

// Walks every step from `stored.version` up to CURRENT_CONFIG_VERSION, then stamps the version.
const migrated = migrator.migrate(stored);

// Or let loadConfig migrate on the way in (it skips the migrator when the version is current).
loadConfig(engine, stored, { migrator });
```

The current schema is version 1, so `defaultMigrator` (the instance `loadConfig` uses) has no steps registered and
passes version-1 documents through unchanged.

---

## §10. Devtools

`engine.devtools` is a `Devtools` coordinator built by every engine: the action log, time-travel, diff, replay, the
Redux DevTools bridge and optional persistence. `FilterEngine` calls `devtools.recordAction` after every action and
`devtools.init` once, at construction. `devtools: { enabled: false }` turns recording off entirely (§10.8).

### §10.1. Action log impl

A bounded FIFO array (§3.3) of `ActionLogEntry`s — the action, both snapshots, a timestamp and optional metadata.
`actionLogSize` defaults to 100; `Infinity` keeps everything. Entries are immutable; appending after a jump truncates
the entries past the cursor.

### §10.2. Snapshots

Captured by `store/snapshots.ts` — shallow clones of signal values (§3.4). In memory a snapshot shares the rule objects;
persistence, the Redux DevTools bridge and diff work on its plain-JSON form (`devtools/snapshotCodec.ts`: rules through
`serialize()`, revived through `ruleRegistry.deserialize()`).

### §10.3. Time-travel

<!-- excerpt: packages/core/src/devtools/TimeTravel.ts#jump-undo-redo -->
<!-- prettier-ignore -->
```ts
/**
 * Jump to a specific entry in the action log and restore its post-state.
 *
 * @param index - Target index. `-1` restores the pre-first-action state (engine reset
 *                to whatever it was at construction).
 * @throws `FilterEngineError` with code `DEVTOOLS_INDEX_OUT_OF_RANGE` if index is out of range
 */
jumpTo(index: number): void {
  if (index === -1) {
    // Restoring to before any action — use entry 0's `previousStateSnapshot`, which IS
    // the state captured immediately before the first dispatched action ran. That's
    // the canonical "pre-modification" state without needing a separate construction
    // snapshot tracked alongside the action log.
    const first = this._actionLog.get(0);

    if (first !== undefined) {
      this._beforeRestore?.();
      restoreSnapshot(this._store, first.previousStateSnapshot);
      this._actionLog.setCurrentIndex(-1);
      // Only notify when a snapshot was actually restored — an empty log is a true no-op.
      this._emitChange?.({ type: 'reset' });

      return;
    }
    this._actionLog.setCurrentIndex(-1);

    return;
  }
  const entry = this._actionLog.get(index);

  if (!entry) {
    throw new FilterEngineError(
      'DEVTOOLS_INDEX_OUT_OF_RANGE',
      `Cannot jumpTo index ${index} — out of range (action log has ${this._actionLog.size} entries)`,
    );
  }
  this._beforeRestore?.();
  restoreSnapshot(this._store, entry.nextStateSnapshot);
  this._actionLog.setCurrentIndex(index);
  this._emitChange?.({ type: 'reset' });
}

/** Step backward one action. No-op if already at -1. */
undo(): void {
  if (this.canUndo) {
    this.jumpTo(this._actionLog.currentIndex - 1);
  }
}

/** Step forward one action. No-op if already at the latest. */
redo(): void {
  if (this.canRedo) {
    this.jumpTo(this._actionLog.currentIndex + 1);
  }
}
```

### §10.4. Diff

Uses `microdiff` (~1KB), and **exports the wrapper rather than leaving consumers to write one**. `diff` compares a plain
view of each snapshot: `rules` becomes an object keyed by rule id holding each rule's `serialize()` output, `expression`
its serialized tree, and `capturedAt` is left out — so a rule change reads as an edit at
`['rules', '<ruleId>', 'config', …]`. A rule that cannot serialize is compared as the instance itself.

```ts
import { diff, type FilterEngine, type StateDiffEntry } from '@filter-enginez/core';
import type { Wine } from '@filter-enginez/mock-data/wine';

declare const engine: FilterEngine<Wine>;

// Any two snapshots: here, the state before and after the most recent action.
const latest = engine.devtools.actionLog.get(engine.devtools.currentIndex);
const edits: readonly StateDiffEntry[] = latest ? diff(latest.previousStateSnapshot, latest.nextStateSnapshot) : [];

// Or by action-log position: diffs the post-action states of entries 0 and 3.
const sinceFirst: readonly StateDiffEntry[] = engine.devtools.diff(0, 3);
```

`StateDiffEntry` is re-exported as `microdiff`'s own `Difference` type, so each edit carries `{ type, path, value }`
plus `oldValue` on the `CHANGE` / `REMOVE` variants — a discriminated union rather than one flat shape.

### §10.5. Replay

`devtools.replay(fromIndex, { startingFrom? })` re-applies logged actions through `Dispatcher.apply` — optionally after
restoring a starting snapshot — without re-logging them or emitting one event per action. Like a time-travel restore it
writes the store outside the dispatch funnel, so the engine drops its acceleration caches first and receives one
`{ type: 'reset' }` change event at the end.

<!-- excerpt: packages/core/src/devtools/Replay.ts#replay-class -->
<!-- prettier-ignore -->
```ts
/**
 * Action-log replay orchestrator.
 */
export class Replay<T> {
  constructor(
    private readonly _store: InternalStore<T>,
    private readonly _dispatcher: Dispatcher<T>,
    private readonly _actionLog: ActionLog,
    private readonly _emitChange?: TimeTravelEmit,
    private readonly _beforeRestore?: () => void,
  ) {}

  /**
   * Re-apply actions from `fromIndex` (inclusive) to the end of the action log.
   *
   * @param fromIndex - The starting index (0-based)
   * @param options - Optional `startingFrom` snapshot to restore before replay
   */
  replay(fromIndex: number, options: ReplayOptions = {}): void {
    this._beforeRestore?.();
    if (options.startingFrom) {
      restoreSnapshot(this._store, options.startingFrom);
    }
    for (let index = fromIndex; index < this._actionLog.size; index++) {
      const entry = this._actionLog.get(index);

      /* v8 ignore next 3 -- defensive: get(index) for an in-range index never returns undefined */
      if (entry === undefined) {
        continue;
      }
      this._dispatcher.apply(entry.action);
    }
    this._emitChange?.({ type: 'reset' });
  }
}
```

### §10.6. Redux DevTools bridge

Speaks the
[Redux DevTools Extension JSON-RPC](https://github.com/reduxjs/redux-devtools/blob/main/extension/docs/API/Methods.md):

<!-- excerpt: packages/core/src/devtools/ReduxDevtoolsBridge.ts#bridge-class -->
<!-- prettier-ignore -->
```ts
/**
 * Bridge to the Redux DevTools extension. Sends actions + state snapshots as if it were a
 * Redux store; the extension's UI scrubbing/diffing/replay panels work against the engine.
 */
export class ReduxDevtoolsBridge {
  private _connection: ReduxDevtoolsConnection | null = null;
  private readonly _onFailure: (cause: unknown) => void;

  /**
   * @param name - Display name shown in the DevTools extension's store-picker.
   *               Defaults to `'Filter EngineZ'`.
   * @param onFailure - Receives whatever the extension threw; the connection is closed first.
   */
  constructor(name = 'Filter EngineZ', onFailure: (cause: unknown) => void = () => undefined) {
    this._onFailure = onFailure;
    const extension = globalThis.__REDUX_DEVTOOLS_EXTENSION__;

    if (!extension) {
      return;
    }
    try {
      this._connection = extension.connect({ name });
    } catch (error) {
      this._onFailure(error);
    }
  }

  /**
   * Initialize the bridge with the engine's starting state. Call once at engine
   * construction.
   */
  init(initialState: EngineSnapshot | null): void {
    this._call((connection) => {
      connection.init(initialState === null ? null : forExtension(initialState, serializeSnapshot));
    });
  }

  /**
   * Forward an action + post-action state snapshot to the DevTools extension.
   */
  recordAction(action: Action, nextState: EngineSnapshot): void {
    this._call((connection) => {
      connection.send(
        forExtension(action, (input) => serializeAction(input) ?? { type: input.type }),
        forExtension(nextState, serializeSnapshot),
      );
    });
  }

  /**
   * Register a listener for DevTools extension messages (`DISPATCH` with a `JUMP_TO_STATE` /
   * `JUMP_TO_ACTION` payload when the user scrubs). `Devtools.init` subscribes and routes those
   * to `TimeTravel.jumpTo`. Does nothing when the extension is absent.
   *
   * @param listener - Callback invoked with each extension message
   */
  subscribe(listener: (message: unknown) => void): void {
    this._call((connection) => {
      connection.subscribe(listener);
    });
  }

  /** Disconnect from the extension (called on engine.destroy()). */
  disconnect(): void {
    this._call((connection) => {
      connection.unsubscribe?.();
    });
    this._connection = null;
  }

  /** True if the extension is present and the bridge is live. */
  get isConnected(): boolean {
    return this._connection !== null;
  }

  /**
   * Run one call against the live connection; on a throw, close the connection and report.
   *
   * @param use - The call to make.
   */
  private _call(use: (connection: ReduxDevtoolsConnection) => void): void {
    if (this._connection === null) {
      return;
    }
    try {
      use(this._connection);
    } catch (error) {
      this._connection = null;
      this._onFailure(error);
    }
  }
}
```

`FilterEngine` connects at construction (`bridgeToReduxDevtools`, default `true`) and calls `init` with the initial
state before applying any initial config, so the extension lists the config's actions after its initial state. Actions
and states are sent in plain-JSON form, so the extension's panels show each rule's type, field and config (a state
holding a `PredicateRule` is sent as a named placeholder). The bridge also subscribes to the extension: scrubbing sends
`DISPATCH` with `JUMP_TO_STATE` / `JUMP_TO_ACTION`, and `Devtools` routes it to `TimeTravel.jumpTo` — action 0 (the
initial state) to the state before the oldest retained entry, any other action to the log entry it was sent with, if the
log still holds it. Restores are not echoed back to the extension.

When the extension is not installed — including every non-browser runtime — the bridge does nothing: no errors, no
startup cost. When it is installed and throws — from `connect`, or from any later `init`, `send`, `subscribe` or
`unsubscribe` — the bridge disconnects and the failure is reported, never thrown into the engine action being recorded:
`devtools.onError` receives a `FilterEngineError` with code `DEVTOOLS_EXTENSION_FAILED` and the extension's error as
`cause`. Without an `onError`, the engine warns once through `console.warn`.

### §10.7. Persistence (cross-reload time-travel)

<!-- excerpt: packages/core/src/devtools/DevtoolsPersistence.ts#persistence-load-save -->
<!-- prettier-ignore -->
```ts
/**
 * Persists + rehydrates the engine's action log across page reloads.
 */
export class DevtoolsPersistence {
  private readonly _adapter: StorageAdapter;
  private readonly _debounceMs: number;
  private readonly _key: string;
  private readonly _maxPersistedEntries: number;
  private readonly _onSaveFailure: (cause: unknown) => void;
  private _saveTimeoutId: TimeoutHandle | null = null;

  /**
   * @param config - Where and how much to persist.
   * @param onSaveFailure - Receives a debounced save's failure, which has no caller to reject to.
   */
  constructor(config: DevtoolsPersistenceConfig, onSaveFailure: (cause: unknown) => void = () => undefined) {
    this._onSaveFailure = onSaveFailure;
    this._adapter = config.adapter;
    this._key = config.key;
    this._maxPersistedEntries = config.maxPersistedEntries ?? 500;
    this._debounceMs = config.debounceMs ?? 1000;
  }

  /**
   * Load the persisted action log, with every rule revived through the rule registry. Returns
   * an empty array if storage is empty or malformed; skips individual entries that cannot be
   * revived.
   */
  async load(): Promise<readonly ActionLogEntry[]> {
    const raw = await this._adapter.load(this._key);

    if (!raw || typeof raw !== 'object') {
      return [];
    }
    const entries = (raw as { entries?: unknown }).entries;

    if (!Array.isArray(entries)) {
      return [];
    }
    const revived: ActionLogEntry[] = [];

    for (const json of entries) {
      const entry = deserializeEntry(json);

      if (entry !== null) {
        revived.push(entry);
      }
    }

    return revived;
  }

  /**
   * Schedule a debounced save of the action log. Multiple calls within `debounceMs` collapse
   * into a single write; a failed write goes to `onSaveFailure`.
   */
  scheduleSave(entries: readonly ActionLogEntry[]): void {
    if (this._saveTimeoutId !== null) {
      clearTimeout(this._saveTimeoutId);
    }
    this._saveTimeoutId = setTimeout(() => {
      this._saveTimeoutId = null;
      this.flushNow(entries).catch(this._onSaveFailure);
    }, this._debounceMs);
  }

  /**
   * Save the action log immediately, bypassing the debounce. Used on engine destroy /
   * page-unload to ensure no in-flight writes are lost.
   */
  async flushNow(entries: readonly ActionLogEntry[]): Promise<void> {
    if (this._saveTimeoutId !== null) {
      clearTimeout(this._saveTimeoutId);
      this._saveTimeoutId = null;
    }
    const encoded: SerializedActionLogEntry[] = [];

    for (const entry of entries) {
      const json = serializeEntry(entry);

      if (json !== null) {
        encoded.push(json);
      }
    }

    await this._adapter.save(this._key, { entries: encoded.slice(-this._maxPersistedEntries) });
  }
```

`devtools.persistence: { adapter, key, maxPersistedEntries?, debounceMs? }` turns it on. Entries are written in their
plain-JSON form, so any `StorageAdapter` works — `LocalStorageAdapter` / `SessionStorageAdapter` (JSON, a few MB) or
`IndexedDBAdapter` (structured clone, larger quotas). Saves are debounced (default 1 s) and flushed on `destroy()`; at
most `maxPersistedEntries` (default 500) newest entries are kept. Entries that cannot be stored are skipped:
data-replacing actions (`setSourceData`, `setWorkingSet` — the items belong to the application) and entries holding a
`PredicateRule`.

On construction the engine starts loading the stored log; `await engine.devtools.ready` before scrubbing into it. Loaded
entries are revived through `ruleRegistry` (so custom rule classes must be registered first; unknown or malformed
entries are skipped) and placed ahead of the session's own entries, with the cursor moved along, so `undo()` walks back
into the previous session.

A storage failure — the load at construction, a debounced save, or the final save in `destroy()` — leaves the session's
log as it was and is reported rather than thrown: `devtools.onError` receives a `FilterEngineError` with code
`DEVTOOLS_PERSISTENCE_FAILED` and the adapter's error as `cause`; `ready` still resolves and `destroy()` still
completes. Without an `onError`, the engine warns once per code through `console.warn` — enough to notice a full quota
without a warning per action. Route it to your error reporter to see every failure:

```ts
import { createFilterEngine } from '@filter-enginez/core';
import { LocalStorageAdapter } from '@filter-enginez/core/storage/browser';

declare function reportError(error: Error): void;

const engine = createFilterEngine({
  devtools: {
    onError: (error) => {
      reportError(error); // error.code: 'DEVTOOLS_PERSISTENCE_FAILED' | 'DEVTOOLS_EXTENSION_FAILED'
    },
    persistence: { adapter: new LocalStorageAdapter('wine-app'), key: 'filter-history' },
  },
});
```

### §10.8. Turning devtools off in production

Devtools construction, from the `FilterEngine` constructor:

<!-- excerpt: packages/core/src/FilterEngine.ts#devtools-construction -->
<!-- prettier-ignore -->
```ts
constructor(options: FilterEngineOptions<T> = {}) {
  this.store = new InternalStore<T>(options.sourceData ?? []);
  this.dispatcher = new Dispatcher<T>(this.store);
  this.devtools = new Devtools<T>(
    this.store,
    this.dispatcher,
    options.devtools,
    (event) => {
      this._maybeWarmExclusionGraph();
      this._emit(event);
    },
    () => {
      this._clearAccelerationCaches();
    },
  );
```

`devtools: { enabled: false }` makes every engine action skip the snapshot capture and the action log, and constructs no
Redux DevTools connection and no persistence. Undo/redo then have nothing to restore, so enable devtools wherever the UI
offers them. The devtools classes stay in the bundle either way: `engine.devtools` is part of the engine's public
surface (the undo/redo bindings and the reactive adapters read it), so its module is imported unconditionally and the
switch is a runtime one. A typical setup passes `{ enabled: import.meta.env.DEV }` when undo/redo is a development aid
only.

---

## §11. Reactive Surface Adapters

### §11.1. `reactive-signals`

<!-- excerpt: packages/reactive-signals/src/createSignalsEngine.ts#subscribe-fan-out -->
<!-- prettier-ignore -->
```ts
// ─── The engine.subscribe fan-out loop ─────────────────────────────────
const unsubscribe = core.subscribe((event: ChangeEvent) => {
  if (isDisposed) {
    return;
  }
  batch(() => {
    // Always reflect the most recent event + (for rule mutations) the change metadata.
    lastChangeEventSignal.value = event;

    switch (event.type) {
      case 'expression':
        expressionSignal.value = core.getExpression();
        modeSignal.value = core.getExpression() !== null ? 'expression' : 'flat-map';
        resultsSignal.value = core.getResults();
        resultCountSignal.value = core.getResultCount();

        return;

      case 'reset':
        // A `reset` event covers any wholesale state change (RESET, RULES_CLEARED,
        // group add/remove). Re-read everything; cheaper than reasoning about exactly
        // which signals changed.
        activeRulesSignal.value = core.getRules();
        activeRuleIdsSignal.value = core.getActiveRuleIds();
        expressionSignal.value = core.getExpression();
        modeSignal.value = core.getExpression() !== null ? 'expression' : 'flat-map';
        groupsSignal.value = core.getGroups();
        resultsSignal.value = core.getResults();
        resultCountSignal.value = core.getResultCount();
        workingSetSignal.value = core.store.workingSet.value;
        lastChangeRuleIdSignal.value = core.store.lastChangeRuleId.value;
        lastChangeTimestampSignal.value = core.store.lastChangeTimestamp.value;

        return;

      case 'results':
        resultsSignal.value = core.getResults();
        resultCountSignal.value = core.getResultCount();

        return;
      case 'rule:added':
      case 'rule:changed':
      case 'rule:removed':
        activeRulesSignal.value = core.getRules();
        activeRuleIdsSignal.value = core.getActiveRuleIds();
        lastChangeRuleIdSignal.value = core.store.lastChangeRuleId.value;
        lastChangeTimestampSignal.value = core.store.lastChangeTimestamp.value;
        // Result set changes when rule set changes — re-read.
        resultsSignal.value = core.getResults();
        resultCountSignal.value = core.getResultCount();
        // Pre-populate per-rule signal on `rule:added` if eager mode is on.
        if (event.type === 'rule:added' && options.eagerPerRuleSignals) {
          buildRuleSignal(event.ruleId);
        }

        return;

      case 'sourceData':
        sourceDataSignal.value = core.getSourceData();
        // sourceData change cascades to results via the engine's own computeds — re-read.
        resultsSignal.value = core.getResults();
        resultCountSignal.value = core.getResultCount();
        workingSetSignal.value = core.store.workingSet.value;

        return;

      case 'workingSet':
        workingSetSignal.value = core.store.workingSet.value;
        resultsSignal.value = core.getResults();
        resultCountSignal.value = core.getResultCount();

        return;
    }
  });
});
```

### §11.2. `reactive-rxjs`

Every stream is a `BehaviorSubject` **seeded from live engine state**, so a subscriber attaching at any time receives
the current value immediately — which is what makes Angular's `| async` render on the first tick and
`toSignal(…, { requireSync: true })` legal. (A `fromEventPattern` stream would be cold and non-replaying: a late
subscriber would see nothing until the next engine change.)

<!-- excerpt: packages/reactive-rxjs/src/createRxJsEngine.ts#seeded-subjects-and-streams -->
<!-- prettier-ignore -->
```ts
const bufferSize = options.replayBufferSize ?? 1;

// ─── Underlying BehaviorSubjects — seeded from the engine's current state ──
const eventsSubject = new Subject<ChangeEvent>();
const resultsSubject = new BehaviorSubject<readonly T[]>(core.getResults());
const resultCountSubject = new BehaviorSubject<number>(core.getResultCount());
const sourceDataSubject = new BehaviorSubject<readonly T[]>(core.getSourceData());
const workingSetSubject = new BehaviorSubject<readonly T[]>(core.store.workingSet.value);
const activeRulesSubject = new BehaviorSubject<ReadonlyMap<RuleId, FilterRule>>(core.getRules());
const activeRuleIdsSubject = new BehaviorSubject<readonly RuleId[]>(core.getActiveRuleIds());
const expressionSubject = new BehaviorSubject<CompositeRule | null>(core.getExpression());
const groupsSubject = new BehaviorSubject<readonly FilterGroup[]>(core.getGroups());
const modeSubject = new BehaviorSubject<'expression' | 'flat-map'>(
  core.getExpression() !== null ? 'expression' : 'flat-map',
);
const lastChangeRuleIdSubject = new BehaviorSubject<RuleId | null>(core.store.lastChangeRuleId.value);
const lastChangeTimestampSubject = new BehaviorSubject<number | null>(core.store.lastChangeTimestamp.value);
const lastChangeEventSubject = new BehaviorSubject<ChangeEvent | null>(null);

// ─── Public `$`-streams — each derived via distinctUntilChanged + shareReplay ──
const events$ = eventsSubject.asObservable().pipe(shareReplay({ bufferSize, refCount: false }));
const results$ = resultsSubject.pipe(distinctUntilChanged(), shareReplay({ bufferSize, refCount: false }));
const resultCount$ = resultCountSubject.pipe(distinctUntilChanged(), shareReplay({ bufferSize, refCount: false }));
const sourceData$ = sourceDataSubject.pipe(distinctUntilChanged(), shareReplay({ bufferSize, refCount: false }));
const workingSet$ = workingSetSubject.pipe(distinctUntilChanged(), shareReplay({ bufferSize, refCount: false }));
const activeRules$ = activeRulesSubject.pipe(distinctUntilChanged(), shareReplay({ bufferSize, refCount: false }));
const activeRuleIds$ = activeRuleIdsSubject.pipe(distinctUntilChanged(), shareReplay({ bufferSize, refCount: false }));
const expression$ = expressionSubject.pipe(distinctUntilChanged(), shareReplay({ bufferSize, refCount: false }));
const groups$ = groupsSubject.pipe(distinctUntilChanged(), shareReplay({ bufferSize, refCount: false }));
const mode$ = modeSubject.pipe(distinctUntilChanged(), shareReplay({ bufferSize, refCount: false }));
const lastChangeRuleId$ = lastChangeRuleIdSubject.pipe(distinctUntilChanged(), shareReplay({ bufferSize, refCount: false }));
const lastChangeTimestamp$ = lastChangeTimestampSubject.pipe(distinctUntilChanged(), shareReplay({ bufferSize, refCount: false }));
const lastChangeEvent$ = lastChangeEventSubject.pipe(shareReplay({ bufferSize, refCount: false }));
```

**Surface parity.** `RxJsEngine<T>` is field-for-field equivalent to `SignalsEngine<T>` with a `$` suffix per stream,
plus the rxjs-only `events$`. `core` is the same `FilterEngine` instance passed in, so the **write path is identical
across both surfaces** — only reads differ. `dispose()` unsubscribes, completes the subjects, and clears the per-rule
cache, but does not destroy the engine.

`createRxJsEngineFromAsync(asyncEngine, options)` serves the worker/server tier, exposing a synthetic core shim whose
reads mirror the async engine and whose writes are sent to it. The shim has every public member of `FilterEngine`. The
synchronous queries that only the hosting thread can answer — `applyFiltersAndQuery()`, `simulate()`,
`getResultIndices()`, `computeResults()`, `getFilteredFieldValuesExcept()`, `precomputeExclusions()`, `snapshot()`,
`exportConfig()` — and the acceleration and store internals throw `MODE_WORKER_UNSUPPORTED`, naming the
`engine.asyncEngine` call to await instead. `destroy()` returns the async engine's teardown, and `isDestroyed` reports
it. The signals twin's shim is the same, member for member (`tests/tooling/asyncCoreShimParity.test.ts`).
`createRxJsEngineFromAsync` is exported from both the package root and the `./worker` subpath. (The signals twin,
`createSignalsEngineFromAsync`, is exported from `@filter-enginez/reactive-signals/worker` only, keeping that package's
root free of the worker-bridge dependency.)

---

## §12. React Bindings

### §12.1. `react-signals`

Uses `useSyncExternalStore` for concurrent-mode safety:

<!-- excerpt: packages/react-signals/src/hooks/useSignal.ts#use-signal -->
<!-- prettier-ignore -->
```ts
/**
 * Subscribe to a `ReadonlySignal` and return its current value.
 *
 * @typeParam V - The signal's value type
 * @param signal - The signal to subscribe to
 * @returns The signal's current value (auto-updated on signal mutation)
 */
export function useSignal<V>(signal: ReadonlySignalShape<V>): V {
  // Memoize the tuple by signal-identity so React's `useSyncExternalStore` sees stable
  // references across re-renders (avoids re-subscribing on every render).
  const [subscribe, getSnapshot, getServerSnapshot] = useMemo(
    () => signalToStoreTuple(signal),
    [signal],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Convenience helper paired with `useSignal` — `useSyncExternalStore`-friendly subscribe
 * + snapshot tuple for a signal. Exposed for consumers writing custom hooks against signals
 * not covered by the curated `use*` hook set.
 *
 * @typeParam V - The signal's value type
 * @param signal - The signal to wrap
 * @returns A `[subscribe, getSnapshot, getServerSnapshot]` tuple
 *
 * @remarks
 * The `subscribe` callback adapts the signal's `onChange(value)` callback shape to React's
 * argumentless `onChange()` callback shape — React just wants to know "something changed,"
 * not what the new value is.
 */
export function signalToStoreTuple<V>(
  signal: ReadonlySignalShape<V>,
): [
    subscribe: (onChange: () => void) => () => void,
    getSnapshot: () => V,
    getServerSnapshot: () => V,
] {
  const subscribe = (onChange: () => void): (() => void) => signal.subscribe(() => onChange());
  const getSnapshot = (): V => signal.value;
  const getServerSnapshot = (): V => signal.value;

  return [subscribe, getSnapshot, getServerSnapshot];
}
```

The context every hook reads is exported, for consumers writing their own hooks:

<!-- excerpt: packages/react-signals/src/FilterEngineContext.ts#filter-engine-context -->
<!-- prettier-ignore -->
```ts
/**
 * React context carrying a `SignalsEngine<unknown>` instance.
 *
 * @remarks
 * Typed as `SignalsEngine<unknown> | null` (rather than a generic) because React contexts
 * cannot be generic. The `use*` hooks downcast to the consumer's expected `SignalsEngine<T>`
 * via the hook's own type parameter — TypeScript users carry the `T` through their hook calls
 * (`useResults<Wine>()`) without the context having to know about it.
 *
 * Default value `null` — hooks throw a clear error if called outside a Provider.
 */
export const FilterEngineContext = createContext<SignalsEngine<unknown> | null>(null);
```

### §12.2. `react-rxjs`

The same shape as §12.1 — context, provider, the same curated hook set (`useFilterEngine`, `useResults`,
`useResultCount`, `useActiveRules`, `useRule`, `useExpression`, `useMode`, `useLastChange`, `useEngineBusy`,
`useSimulation`, `useUndoRedo`, `useExclusion`, `useSuggestedFilters`, `useSimilar`) — over Observables rather than
signals, plus a `./keyboard` subpath (`useUndoRedoKeyboard`).

**One internal primitive underneath everything.** Every public `use*` hook is built on `useObservable`, which is
`useSyncExternalStore` over an RxJS subscription. That choice buys the same three properties the signals binding gets:
tearing-safety under concurrent rendering, SSR-safety (`getServerSnapshot` returns the caller's `initialValue`, a value
the server render can always produce), and strict-mode-safety (a double render does not double-subscribe).

<!-- excerpt: packages/react-rxjs/src/hooks/useObservable.ts#use-observable -->
<!-- prettier-ignore -->
```ts
/**
 * Subscribe to an `Observable<V>` and return its current value. The component re-renders on
 * every emission.
 *
 * @typeParam V - The observable's value type
 * @param source - The Observable to subscribe to
 * @param initialValue - Value to return until the first emission lands
 * @returns The most recent emitted value
 */
export function useObservable<V>(source: Observable<V>, initialValue: V): V {
  // `initialValue` is intentionally omitted from the dependency array: it seeds the store
  // tuple only on first construction, and re-subscribing on a changed initial value would
  // needlessly tear down the live subscription. Re-subscription is keyed solely on `source`
  // identity. (The `react-hooks` plugin is not active for `.ts` files, so this carries no
  // suppression; the omission is deliberate and documented here.)
  const [subscribe, getSnapshot, getServerSnapshot] = useMemo(
    () => observableToStoreTuple(source, initialValue),
    [source],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Convenience helper — `useSyncExternalStore`-friendly subscribe + snapshot tuple for an
 * Observable + initial value. Exposed for consumers writing custom hooks.
 *
 * @typeParam V - The observable's value type
 * @param source - The Observable to wrap
 * @param initialValue - Value to return until the first emission lands
 * @returns A `[subscribe, getSnapshot, getServerSnapshot]` tuple
 *
 * @remarks
 * The internal `latestValue` closure variable is the bridge between RxJS's push-based
 * delivery and React's pull-based snapshot model. On subscribe, the value is captured into
 * the closure on every `next`; getSnapshot returns the most recently captured value.
 */
export function observableToStoreTuple<V>(
  source: Observable<V>,
  initialValue: V,
): [
    subscribe: (onChange: () => void) => () => void,
    getSnapshot: () => V,
    getServerSnapshot: () => V,
] {
  let latestValue: V = initialValue;
  const subscribe = (onChange: () => void): (() => void) => {
    const sub = source.subscribe((value) => {
      latestValue = value;
      onChange();
    });

    return (): void => sub.unsubscribe();
  };
  const getSnapshot = (): V => latestValue;
  const getServerSnapshot = (): V => initialValue;

  return [subscribe, getSnapshot, getServerSnapshot];
}
```

**The latest-value closure is the whole trick, and it depends on the replay contract.** An Observable has no synchronous
"current value" getter, which is exactly what `useSyncExternalStore`'s `getSnapshot` needs. A hot `shareReplay(1)`
stream, however, delivers its buffered value synchronously on `subscribe` — so the subscribe callback captures it into a
closure and `getSnapshot` reads it back.

That is why §11.2's replay contract is load-bearing rather than a nicety: **a cold or unbuffered Observable passed to
this hook yields `initialValue` on first render and only a real value on the first emission after mount.** Every
`$`-suffixed stream `createRxJsEngine` returns satisfies the contract; a consumer composing their own stream must
preserve it.

**Memoization is correctness, not optimization.** The closure holding `latestValue` is recreated per render unless the
store tuple is memoized — on `[source]` alone: `initialValue` only seeds the first snapshot, and re-subscribing when it
changed would tear down a live subscription for nothing. Without the memo, a caller passing a stable Observable would
still get a fresh subscription every render.

`useObservable` and `observableToStoreTuple` are exported from the package root for consumers writing custom hooks
against streams the curated set does not cover.

### §12.3. Keyboard handlers (browser-only sub-export)

The undo / redo binding is **one implementation in `core`**. `react-signals` and `react-rxjs` wrap it as
`useUndoRedoKeyboard`; Svelte, Vue, Angular and vanilla code call `attachUndoRedoKeyboard` directly from their own
lifecycle hooks.

<!-- excerpt: packages/core/src/keyboard/browser/undoRedoIntent.ts#undo-redo-intent -->
<!-- prettier-ignore -->
```ts
/**
 * Decide whether a keystroke is an undo, a redo, or neither.
 *
 * @remarks
 * Returning `null` rather than a no-op is what lets the caller decide whether to `preventDefault` —
 * a key this does not own must keep its browser behavior, or the shortcut swallows Cmd+Y, Cmd+Shift+Z
 * and every other binding on the page.
 *
 * @param event - The keystroke, or anything shaped like one.
 * @returns The intent, or `null` for a key this does not own.
 */
export function undoRedoIntent(event: UndoRedoKeyLike): UndoRedoIntent | null {
  // Checked FIRST, before the modifier test: a text field owns Cmd+Z whether or not this handler
  // would otherwise have claimed it, and reordering these makes the difference invisible in tests
  // that only ever pass a modifier.
  if (isEditableTarget(event.target)) {
    return null;
  }
  if (!event.metaKey && !event.ctrlKey) {
    return null;
  }
  // `key` is case-sensitive and Shift+Z reports an UPPERCASE 'Z'. Without this normalization a
  // lowercase-only comparison would make redo work on Windows (`Ctrl+Y`) but do nothing on macOS
  // (`Cmd+Shift+Z`).
  const key = event.key.toLowerCase();

  if (key === 'y') {
    return 'redo';
  }
  if (key !== 'z') {
    return null;
  }

  return event.shiftKey ? 'redo' : 'undo';
}
```

The wiring, which returns its teardown:

<!-- excerpt: packages/core/src/keyboard/browser/attachUndoRedoKeyboard.ts#attach-undo-redo-keyboard -->
<!-- prettier-ignore -->
```ts
/**
 * Bind undo / redo keyboard shortcuts, returning the teardown.
 *
 * @param target - The time-travel cursor to drive, e.g. `engine.core.devtools`.
 * @param options - Optional scope / `preventDefault` configuration.
 * @returns A function that removes the listener. Always call it — a second mount without it means
 *   every keystroke undoes twice.
 *
 * @example
 *   // Svelte
 *   $effect(() => attachUndoRedoKeyboard(engine.core.devtools));
 */
export function attachUndoRedoKeyboard(
  target: UndoRedoTarget,
  options?: AttachUndoRedoKeyboardOptions,
): () => void {
  const shouldPreventBrowserDefault = options?.preventBrowserDefault ?? true;
  // Annotated rather than inferred: without it the union widens to `… | HTMLElement` and the two
  // listener calls below have to resolve against HTMLElement's overload set.
  const scope: UndoRedoKeyboardScope = options?.scope ?? document.body;

  const onKeyDown = (event: KeyboardEvent): void => {
    const intent = undoRedoIntent(event);

    if (intent === null) {
      return;
    }
    if (shouldPreventBrowserDefault) {
      event.preventDefault();
    }
    if (intent === 'undo') {
      target.undo();

      return;
    }
    target.redo();
  };

  scope.addEventListener('keydown', onKeyDown);

  return (): void => {
    scope.removeEventListener('keydown', onKeyDown);
  };
}
```

Exported from `@filter-enginez/core/keyboard/browser`, alongside `./storage/browser` — the default core entry stays
isomorphic. `attachUndoRedoKeyboard` returns a teardown because that is the shape every reactivity system already holds:
`useEffect` returns it, Svelte's `$effect` returns it, Vue pairs `onMounted` / `onUnmounted`, Angular has `DestroyRef`,
and vanilla just calls it. The React hooks are four lines each around it.

**The split between intent and wiring is load-bearing.** Deciding what a keystroke means is pure, so it is tested as
plain function calls over the event shapes browsers actually send; wiring a listener is not. One such shape: a real
`Cmd/Ctrl+Shift+Z` reports `key: 'Z'` — `key` carries the _shifted_ character — so `undoRedoIntent` lower-cases `key`
before matching, and the tests construct `{ key: 'Z', shiftKey: true }`.

Behavior: `Cmd/Ctrl+Z` undo; `Cmd/Ctrl+Shift+Z` and `Cmd/Ctrl+Y` redo (the macOS and Windows spellings, accepted
together); keystrokes inside `<input>`, `<textarea>` or an editable `[contenteditable]` are ignored so those elements
keep their own undo stacks; `preventDefault` fires only for a keystroke this owns, so every other page binding survives;
and an optional `scope` narrows the listener to one subtree (default `document.body`).

---

## §12a. Non-React Bindings — Svelte, Vue, Angular

Three more binding packages exist alongside §12's React pair. They are documented together because the interesting thing
is what varies between them, and what does not.

**What never varies: the write path.** `SignalsEngine.core`, `RxJsEngine.core` and a bare engine are all the same
`FilterEngine<T>`, so `engine.core.addRule(id, rule)` is byte-identical in all five framework bindings. Only reads are
framework-shaped. Every binding below therefore exists to solve exactly one problem — getting engine _reads_ into the
framework's own reactivity — and nothing else.

### §12a.1. `svelte-signals`

The thinnest possible adapter, because a Filter EngineZ signal already satisfies Svelte's `Readable` contract. The
package is a `toStore` pass-through, `setContext`/`getContext` glue, and a `createEngineStores` bag.

**Gotcha, load-bearing:** hold the engine in `$state.raw`, never `$state`. Svelte's deep proxy wraps the engine object
and breaks its `@preact/signals-core` signals — filtering silently stops, with no error.

### §12a.2. `vue-signals`

Same shape over Vue 3. **Gotcha, and it is the exact analogue of Svelte's:** use `shallowRef`, never `ref`. Vue's deep
reactive proxy breaks the engine's signals the same way `$state` does. That two independent frameworks fail identically
is the useful signal here — any framework whose default reactivity deep-proxies assigned objects will break an engine
that holds its own signals, and the fix is always the shallow variant.

### §12a.3. `angular-rxjs`

**The smallest binding in the repo, by design.** Two `InjectionToken`s, three provider factories, two `inject` helpers,
and no wrapper type at all.

The other three bindings exist to bridge a framework reactivity primitive to `@preact/signals-core`. Angular needs no
such bridge: `reactive-rxjs` publishes `Observable`s, which Angular consumes natively through the `async` pipe, or
converts with `toSignal` at the call site. There is no impedance mismatch to absorb. What Angular _does_ need is a way
to get the engine into components without threading it through every `@Input` — which is dependency injection, and that
is the entire package.

<!-- excerpt: packages/angular-rxjs/src/provideFilterEngine.ts#filter-engine-di -->
<!-- prettier-ignore -->
```ts
/**
 * DI token holding the app's `RxJsEngine`.
 *
 * @remarks
 * Typed as `RxJsEngine<unknown>` because an `InjectionToken` cannot be generic — the item type is
 * recovered at the injection site via {@link injectFilterEngine}. This is the same erasure the Vue
 * and Svelte context bindings perform for the identical reason.
 */
export const FILTER_ENGINE = new InjectionToken<RxJsEngine<unknown>>('filter-enginez.RxJsEngine');

/**
 * Provide an already-booted engine to the application injector.
 *
 * @param engine - The engine, typically `createRxJsEngine(core)` over a booted core.
 * @returns A provider to spread into `bootstrapApplication`'s `providers` (or a route's).
 */
export function provideFilterEngine<T>(engine: RxJsEngine<T>): Provider {
  return { provide: FILTER_ENGINE, useValue: engine };
}

/**
 * Provide an engine produced by a factory, resolved lazily inside an injection context.
 *
 * @remarks
 * The counterpart to {@link provideFilterEngine} for the case where the engine isn't in hand at the
 * moment the providers array is written. The motivating case is Angular's route-resolver pattern: the
 * engine boot is asynchronous, resolvers may await, and the component then republishes the resolved
 * value into component-scoped DI:
 *
 * ```ts
 * providers: [
 *   provideFilterEngineFactory(() => inject(ActivatedRoute).snapshot.data['books'].engine),
 * ]
 * ```
 *
 * The factory runs in an injection context, so it may call `inject()` — which is the entire point.
 *
 * @param factory - Produces the engine; runs once per injector, inside an injection context.
 * @returns A provider to spread into a component's or route's `providers`.
 */
export function provideFilterEngineFactory<T>(factory: () => RxJsEngine<T>): Provider {
  return { provide: FILTER_ENGINE, useFactory: factory };
}

/**
 * Inject the application's engine, re-applying the item type erased by the token.
 *
 * @remarks
 * The cast is the price of `InjectionToken`'s invariance over generics; it is safe because
 * {@link provideFilterEngine} is the only supported way to populate the token, and it accepts a
 * correctly-typed `RxJsEngine<T>`.
 *
 * Must be called from an injection context (a field initializer, constructor, or inside
 * `runInInjectionContext`).
 *
 * @returns The engine, typed to `T`.
 */
export function injectFilterEngine<T>(): RxJsEngine<T> {
  return inject(FILTER_ENGINE) as RxJsEngine<T>;
}
```

`InjectionToken` cannot be generic, so the token is declared over `unknown` and `injectFilterEngine<T>()` re-applies the
item type — the same erasure the Vue and Svelte context bindings perform, for the same reason.

**`provideFilterEngineFactory` exists for Angular's async-boot problem.** DI providers are synchronous; booting an
engine is not. Angular's idiom for that tension is the **route resolver**, which may return a promise and blocks
activation until it settles. So the engine boots in a resolver and the page republishes it into component-scoped DI
through a factory that runs inside an injection context. The consequence worth naming: by the time any component
constructs, `injectFilterEngine()` is guaranteed to return a live engine — no boot flags, no null checks, no loading
branch in every consumer.

**Why the Angular example app is zoneless.** `AsyncPipe` calls `markForCheck()` itself on each emission and `toSignal`
produces a real signal, so both read paths announce their own changes. `zone.js` would be ~30KB inferring what is
already being told, and its absence matters more under the Comlink worker tier, where zone-patched round-trips are a
well-known source of redundant change detection.

---

## §13. Redux Bridge

A read-only Redux mirror of engine state, plus a middleware that forwards Redux actions to the engine. Only the bridge
writes the mirror (enforced by `@filter-enginez/no-direct-mirror-mutation`, §17.2).

### §13.1. Slice

<!-- excerpt: packages/redux-bridge/src/createFilterEngineSlice.ts#create-filter-engine-slice -->
<!-- prettier-ignore -->
```ts
/**
 * Create a Redux slice that mirrors a `FilterEngine`'s public state.
 *
 * @typeParam T - The item type the underlying engine operates over
 * @param name - The slice name (becomes the action type prefix and the slice key in the
 *   combined reducer)
 * @param options - Optional configuration
 * @returns A slice with `name`, `reducer`, `actions`, `getInitialState`
 *
 * @example
 *   import { configureStore } from '@reduxjs/toolkit';
 *   import { createFilterEngineSlice } from '@filter-enginez/redux-bridge';
 *
 *   const filterSlice = createFilterEngineSlice<Wine>('filters');
 *   const store = configureStore({ reducer: { [filterSlice.name]: filterSlice.reducer } });
 *
 *   attachEngineToStore(store, engine, { slice: filterSlice });
 */
export function createFilterEngineSlice<T = unknown>(
  name: string,
  options: CreateFilterEngineSliceOptions = {},
): FilterEngineSlice<T> {
  const shouldIncludeResults = options.includeResults ?? true;
  // RTK infers the state type from `initialState`; we tell it the type via the explicit
  // generic on `createSlice<...>` rather than typing the inline reducer params (which
  // produces a `WritableDraft<T>` vs `readonly T[]` mismatch with our generic `T`).
  const rtkSlice = createSlice({
    initialState: INITIAL_MIRROR_STATE as FilterEngineMirrorState<T>,
    name,
    reducers: {
      // Object.assign onto an Immer draft is the canonical "shallow-merge into state"
      // pattern. Cast through `unknown` to bridge Immer's Draft<T> back to T for the
      // Object.assign call; the runtime behavior is identical regardless.
      stateUpdated(state, action: PayloadAction<FilterEngineMirrorStateUpdate<T>>): void {
        Object.assign(state as unknown as FilterEngineMirrorState<T>, action.payload);
      },
    },
  });

  return {
    _includeResults: shouldIncludeResults,
    actions: {
      stateUpdated: rtkSlice.actions.stateUpdated,
    },
    getInitialState: rtkSlice.getInitialState,
    name: rtkSlice.name,
    reducer: rtkSlice.reducer,
  };
}
```

### §13.2. Middleware

<!-- excerpt: packages/redux-bridge/src/createFilterEngineMiddleware.ts#create-filter-engine-middleware -->
<!-- prettier-ignore -->
```ts
/**
 * Build the forward-action-intercepting middleware for an engine.
 *
 * @typeParam T - The item type the engine operates over.
 * @param options - The engine to forward to + an optional routing `prefix`.
 * @returns A Redux middleware.
 *
 * @example
 *   const middleware = createFilterEngineMiddleware({ engine });
 *   const store = configureStore({
 *     reducer: { filters: filterSlice.reducer },
 *     middleware: (getDefault) => getDefault().concat(middleware),
 *   });
 *
 *   // Dispatch consumer intents as Redux actions:
 *   store.dispatch(forwardToEngine('addRule', { ruleId: 'price', rule: priceRule }));
 *   // The middleware routes this to engine.addRule(...) and SWALLOWS the action — it never
 *   // reaches the reducer. The mirror update comes from engine.subscribe via attachEngineToStore.
 */
export function createFilterEngineMiddleware<T>(
  options: CreateFilterEngineMiddlewareOptions<T>,
): Middleware {
  const { engine, prefix = FORWARD_ACTION_PREFIX_DEFAULT } = options;
  const matchPrefix = `${prefix}/forward/`;

  return (_api: MiddlewareApi) => (next: (action: unknown) => unknown) => (action: unknown): unknown => {
    // Only intercept actions whose type sits under our prefix's forward namespace; everything
    // else passes through untouched (including this engine's mirror `stateUpdated` action,
    // other engines' forward intents, and ordinary app actions).
    if (!isForwardAction(action) || !action.type.startsWith(matchPrefix)) {
      return next(action);
    }

    const envelope = extractEnvelope<T>(action);

    if (envelope === undefined) {
      // A `<prefix>/forward/*` action with no envelope is malformed — pass it through rather
      // than throwing, so a misconfigured dispatch surfaces as a reducer-level no-op (visible
      // in DevTools) instead of a hard crash inside middleware.
      return next(action);
    }

    switch (envelope.method) {
      case 'addGroup':
        engine.addGroup(envelope.payload.group);

        return;
      case 'addRule':
        engine.addRule(envelope.payload.ruleId, envelope.payload.rule);

        return; // SWALLOW — mirror update comes from engine.subscribe via attachEngineToStore.
      case 'clearRules':
        engine.clearRules();

        return;
      case 'removeGroup':
        engine.removeGroup(envelope.payload.groupId);

        return;
      case 'removeRule':
        engine.removeRule(envelope.payload.ruleId);

        return;
      case 'reset':
        engine.reset();

        return;
      case 'setExpression':
        engine.setExpression(envelope.payload.expr);

        return;
      case 'setSourceData':
        engine.setSourceData(envelope.payload.items);

        return;
      case 'setWorkingSet':
        engine.setWorkingSet(envelope.payload.items);

        return;
      default:
        // Unknown forward method — pass through. Allows consumers to define their own
        // `<prefix>/forward/customMethod` actions that other middleware handles.
        return next(action);
    }
  };
}
```

### §13.3. `attachEngineToStore`

<!-- excerpt: packages/redux-bridge/src/attachEngineToStore.ts#per-event-mirror-dispatch -->
<!-- prettier-ignore -->
```ts
/**
 * Build the partial update payload for a given change event. Per-event narrowing keeps
 * the Redux DevTools action log readable (you can see which rule changed without hunting
 * through a full-state diff).
 */
const partialFor = (event: ChangeEvent): FilterEngineMirrorStateUpdate<T> => {
  version++;
  const base = { version };

  switch (event.type) {
    case 'expression':
      return {
        ...base,
        mode: engine.getExpression() !== null ? 'expression' : 'flat-map',
        resultCount: engine.getResultCount(),
        ...(shouldIncludeResults ? { results: [...engine.getResults()]} : {}),
      };
    case 'reset':
      // Wholesale event — full snapshot is the safest payload. Clear the tracked
      // last-change first so the snapshot reflects the post-reset "nothing changed yet"
      // state rather than carrying a stale rule id forward.
      lastChangeRuleId = null;
      lastChangeTimestamp = null;

      return fullSnapshot();
    case 'results':
    case 'sourceData':
    case 'workingSet':
      return {
        ...base,
        resultCount: engine.getResultCount(),
        ...(shouldIncludeResults ? { results: [...engine.getResults()]} : {}),
      };
    case 'rule:added':
    case 'rule:changed':
    case 'rule:removed':
      // Derive last-change from the event itself rather than the engine's internal store.
      lastChangeRuleId = event.ruleId;
      lastChangeTimestamp = Date.now();

      return {
        ...base,
        activeRuleIds: [...engine.getActiveRuleIds()],
        resultCount: engine.getResultCount(),
        ...(shouldIncludeResults ? { results: [...engine.getResults()]} : {}),
        lastChangeRuleId,
        lastChangeTimestamp,
      };
  }
};

// Initial sync — populate the mirror with the engine's current state.
if (shouldSyncOnAttach) {
  store.dispatch(slice.actions.stateUpdated(fullSnapshot()));
}

// Subscribe to engine events and dispatch a per-event partial update.
const unsubscribe = engine.subscribe((event) => {
  store.dispatch(slice.actions.stateUpdated(partialFor(event)));
});

return unsubscribe;
```

---

## §14. URL State Router

`<FilterEngineUrlSync>` two-way-binds an engine to one query parameter (`paramKey`, default `f`) through react-router's
`useLocation` / `useNavigate`:

- **Engine → URL.** On every engine change event, debounced (`debounceMs`, default 150; `0` writes synchronously), the
  component exports the config (`asyncConfig.exportConfig()` for worker-backed engines), encodes it with the chosen
  serializer and navigates with `historyMode` (default `'replace'`, so filter ticks do not pile up history). Every
  engine change bumps a token, which discards an async export the change has made stale. The subscription and its
  pending write outlive location changes: a write reads the current location from a ref when it runs.
- **URL → Engine.** On every `location.search` change it decodes the parameter and calls `engine.loadConfig`, unless the
  location is one of the component's own writes arriving or the engine already holds that state (below). A decode
  failure is reported to `onError` and, with `tolerateMalformedUrls` (default `true`), leaves the engine as it was.
- **Across routes (opt-in).** Route navigations are the app's own. With `routeChangeMode` set, a navigation to another
  pathname whose URL lacks the parameter gets the current one re-attached, so filter state is retained across routes
  served by the same engine: `'replace'` folds it into the navigation's own history entry, so Back returns to the
  previous route in one step; `'push'` adds a second entry. Unset (the default) leaves the URL as the app wrote it — the
  right choice when routes host different engines.

<!-- excerpt: packages/url-state-router/src/FilterEngineUrlSync.tsx#url-sync-effects -->
<!-- prettier-ignore -->
```tsx
// ─── Engine → URL ──────────────────────────────────────────────────────
useEffect((): (() => void) => {
  const writeUrl = async (): Promise<void> => {
    // Worker-backed engines export across a postMessage round-trip; an engine change landing
    // mid-export bumps the token and discards this now-stale write. The sync path (no
    // `asyncConfig`) hits no `await`, so it still runs through to `navigate` synchronously.
    const token = writeTokenRef.current;
    const config = asyncConfig ? await asyncConfig.exportConfig() : engine.exportConfig();

    if (token !== writeTokenRef.current) {
      return;
    }
    const serialized = serializer.encode(config);

    rememberWrite(pendingWritesRef.current, serialized);
    engineStateRef.current = serialized;
    currentParamRef.current = serialized;
    const { pathname, search: currentSearch } = locationRef.current;
    const search = new URLSearchParams(currentSearch);

    search.set(paramKey, serialized);
    void navigateRef.current({ pathname, search: search.toString() }, { replace: historyMode === 'replace' });
  };

  const off = engine.subscribe(() => {
    writeTokenRef.current += 1;
    engineStateRef.current = null;
    if (writeTimerRef.current !== null) {
      clearTimeout(writeTimerRef.current);
    }
    if (debounceMs <= 0) {
      void writeUrl();

      return;
    }
    writeTimerRef.current = setTimeout(() => {
      writeTimerRef.current = null;
      void writeUrl();
    }, debounceMs);
  });

  return (): void => {
    if (writeTimerRef.current !== null) {
      clearTimeout(writeTimerRef.current);
    }
    off();
  };
}, [asyncConfig, engine, serializer, paramKey, debounceMs, historyMode]);

// ─── URL → Engine ──────────────────────────────────────────────────────
useEffect((): void => {
  const params = new URLSearchParams(location.search);
  const serialized = params.get(paramKey);

  if (!serialized) {
    return;
  }
  // One of our own writes arriving — in order, or late, after a newer one (see "Own writes").
  // A POP is the user's history navigation, even to a value we wrote, so it is never skipped here.
  const pending = pendingWritesRef.current;
  const pendingIndex = pending.indexOf(serialized);

  if (pendingIndex !== -1) {
    pending.splice(pendingIndex, 1);
    if (navigationType !== NavigationType.Pop) {
      return;
    }
  }
  // The engine already holds this state; loading it again would change nothing.
  if (serialized === engineStateRef.current) {
    return;
  }

  try {
    const config = serializer.decode(serialized);

    engine.loadConfig(config);
    engineStateRef.current = serialized;
    currentParamRef.current = serialized;
  } catch (err) {
    /* v8 ignore next -- defensive: the built-in serializers always throw Error; the non-Error branch is only reachable via a custom serializer that throws a non-Error */
    const error = err instanceof Error ? err : new Error(String(err));

    onError?.(error);
    if (!shouldTolerateMalformedUrls) {
      throw error;
    }
  }
}, [location.search, navigationType, engine, serializer, paramKey, shouldTolerateMalformedUrls, onError]);
```

Origin tracking keeps two things. `pendingWritesRef` lists the parameter values the component has navigated to whose
locations have not rendered yet (at most `PENDING_WRITES_REMEMBERED`, 16); a value leaves the list when it arrives. An
app that navigates inside a React transition can render an older write's location after a newer one, so the last value
written is not enough to recognize an own write: the older value would look external, be loaded, and drop the newer
change. A listed value arriving through `PUSH` or `REPLACE` is that late commit, and is not loaded. A `POP` (Back,
Forward, a reload) is the user's, even when it lands on a value the component wrote, so it is never skipped as an own
write. `engineStateRef` holds the value the engine is known to hold: set by every write and load, and cleared by every
engine change until the next write, so it never vouches for a state the engine has left. A location carrying that value
has nothing to load, whichever way it arrived. Everything else loads: Back and Forward, a pasted link, an in-app link to
any `?f=`.

A third ref, `currentParamRef`, holds the parameter that describes the engine's current state, whichever direction it
came from; `routeChangeMode` re-attaches that value when a navigation drops the parameter, and lists it as a pending
write so its arrival is not loaded over a newer change still inside the debounce window.

---

## §15. Worker Bridge

### §15.1. Comlink wrapper

`wrapInWorker` takes **one** options object, including a **pre-spawned `worker`**: the
`new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' })` call has to stay at the consumer's call
site, because that is the form bundlers statically analyze to emit a worker chunk. See
[`docs/guides/worker_offload.md`](./guides/worker_offload.md) for the consumer-facing version;
`tests/tooling/docblockWrapInWorkerOptions.test.ts` holds every `wrapInWorker` example in the repo to the declared
option set.

<!-- excerpt: packages/worker-bridge/src/wrapInWorker.ts#options-and-ready-handshake -->
<!-- prettier-ignore -->
```ts
const {
  eagerly,
  factoryCallbacks,
  factoryName,
  factoryOptions,
  terminateOnDestroy: shouldTerminateOnDestroy = true,
  worker,
} = options;

// Before any message crosses: a worker-side rejection then arrives as the same
// `FilterEngineError` subclass, with its `code` and `cause`, instead of a plain `Error`.
installErrorTransferHandler();
let isDestroyed = false;

// `messageerror` fires when a postMessage payload fails to be structured-cloned at the worker
// boundary; nothing else reports it, so it is logged.
worker.addEventListener('messageerror', (ev: unknown) => {
  const data = (ev as { data?: unknown }).data;

  console.error('[wrapInWorker] worker messageerror event (cloning failed):', data ?? ev);
});

// ─── Wait for the worker-ready handshake ────────────────────────────────
// The worker's `exposeFilterEngineWorker` posts a `{__filterEnginezWorkerReady: true}`
// sentinel after Comlink's `expose` has wired its message listener. We MUST NOT send
// any postMessage to the worker before this arrives — early messages get silently
// dropped (observed under Vite `?worker` dev mode). Wait for the sentinel before
// instantiating Comlink's wrap or calling init. A worker that fails to load or evaluate
// fires `error` instead and never posts the sentinel, so `error` before the sentinel
// rejects with `WORKER_LOAD_FAILED` and terminates the worker, rather than waiting forever.
await new Promise<void>((resolve, reject) => {
  const settle = (): void => {
    worker.removeEventListener('message', readyHandler);
    worker.removeEventListener('error', loadFailureHandler);
  };
  const readyHandler = (ev: unknown): void => {
    const data: unknown = (ev as { data?: unknown }).data;

    /* v8 ignore next 4 -- defensive: the handshake filter's false branches (a non-sentinel
       message arriving before this listener removes itself) are unreachable in-harness —
       the ready sentinel is the only message the worker posts pre-removal. */
    if (data && typeof data === 'object' && (data as Record<string, unknown>)['__filterEnginezWorkerReady'] === true) {
      settle();
      resolve();
    }
  };
  const loadFailureHandler = (ev: unknown): void => {
    const message = (ev as { message?: unknown }).message;

    settle();
    worker.terminate();
    reject(new FilterEngineError(
      'WORKER_LOAD_FAILED',
      `wrapInWorker: the worker failed before its ready handshake${typeof message === 'string' ? ` (${message})` : ''}. `
      + 'Check that the worker file loads and calls exposeFilterEngineWorker.',
      { cause: ev },
    ));
  };

  worker.addEventListener('message', readyHandler);
  worker.addEventListener('error', loadFailureHandler);
});

// After the handshake, an `error` event is an error the running worker did not catch outside any
// call (a throw inside a call rejects that call through Comlink). Logged so it is visible.
worker.addEventListener('error', (ev: unknown) => {
  const message = (ev as { message?: unknown }).message;

  console.error('[wrapInWorker] worker error event:', message ?? ev, ev);
});

// Wrap the worker endpoint as a Comlink proxy onto the `WorkerHostedEngine<T>` surface.
// The cast bridges our structural Worker declaration to Comlink's `Endpoint` type at this
// single edge point.

const proxy = wrap<WorkerHostedEngine<T>>(worker);
```

**The ready handshake is load-bearing.** `exposeFilterEngineWorker` posts a `__filterEnginezWorkerReady` sentinel once
Comlink's listener is wired, and a message posted to a worker before its module has attached a listener is dropped
(Vite's `?worker` dev mode shows it), so `wrapInWorker` sends nothing until the sentinel arrives. A worker that fails to
load or evaluate never posts it and fires `error` instead, so an `error` before the sentinel rejects the `wrapInWorker`
promise with a `FilterEngineError` (code `WORKER_LOAD_FAILED`, the event as `cause`) and terminates the worker, rather
than leaving the caller waiting. After the handshake, `error` events (an error the worker did not catch outside any
call) and `messageerror` events (a payload that failed to clone) are logged to the console.

**Typed factories.** `exposeFilterEngineWorker` is generic over the map from factory name to item type and infers it, so
a worker registers a `WorkerEngineFactory<Wine>` and a `WorkerEngineFactory<Listing>` side by side as written
(`WorkerEngineFactories<ItemTypes>`). Only own property names count as registered factories, so `init` with a name such
as `toString` rejects with `WORKER_FACTORY_NOT_FOUND`.

### §15.2. Auto-engagement algorithm

`shouldEngageWorker(itemCount, policy)` is advisory: the consumer calls it and decides whether to `wrapInWorker`. The
policy is its own parameter — `AccelerationOptions` governs the in-process acceleration stack and has nothing to do with
workers — and `boolean` is accepted as shorthand for `'always'` / `'never'`.

<!-- excerpt: packages/worker-bridge/src/autoEngagement.ts#should-engage-worker -->
<!-- prettier-ignore -->
```ts
/**
 * Decide whether to engage the worker for a given source data size + consumer policy.
 *
 * @remarks
 * Policy resolution order:
 *
 *   1. `boolean` is normalized: `true` → `'always'`, `false` → `'never'` (so the rest of the
 *      function has a unified shape to switch over).
 *   2. `'never'` → always `false`. End of story.
 *   3. `'always'` → always `true`, even when `Worker` is undefined. The actual
 *      `wrapInWorker(...)` call will then throw a clear error — which is the right outcome,
 *      since the consumer explicitly asked for a worker in an environment that doesn't have one.
 *   4. `'auto'` or `number` → check `Worker` availability first (return `false` if absent),
 *      then compare `sourceDataLength` to the threshold (`DEFAULT_AUTO_THRESHOLD` for `'auto'`,
 *      the literal value for a numeric policy).
 *
 * @param sourceDataLength - Item count of the current source data
 * @param policy - Consumer's worker-engagement policy
 * @returns `true` if the worker should be used, `false` to run on the main thread
 *
 * @example
 *   const useWorker = shouldEngageWorker(wines.length, 'auto');
 *   const engine = useWorker
 *     ? await wrapInWorker<Wine>({ worker: new WineWorker(), factoryName: 'wineEngine' })
 *     : createFilterEngine<Wine>({ sourceData: wines });
 */
export function shouldEngageWorker(
  sourceDataLength: number,
  policy: WorkerEngagementPolicy,
): boolean {
  // Normalize boolean shorthands into their string-policy equivalents so the switch below
  // only has to reason about the canonical four shapes.
  const normalizedPolicy: Exclude<WorkerEngagementPolicy, boolean>
    = policy === true ? 'always'
      : policy === false ? 'never'
        : policy;

  if (normalizedPolicy === 'never') {
    return false;
  }
  if (normalizedPolicy === 'always') {
    return true;
  }

  // 'auto' and numeric thresholds both require `Worker` to actually be present at runtime;
  // without it we silently fall back to main-thread execution (the engine still works, it
  // just runs in the main event loop instead of offloading).
  if (typeof Worker === 'undefined') {
    return false;
  }

  if (normalizedPolicy === 'auto') {
    return sourceDataLength >= DEFAULT_AUTO_THRESHOLD;
  }

  // Numeric threshold — engage when source data size meets or exceeds the consumer's number.
  return sourceDataLength >= normalizedPolicy;
}
```

**`'always'` skipping the `Worker`-availability check is intentional.** `'auto'` and numeric policies fall back to the
main thread when `Worker` is undefined (Node, edge runtimes, jsdom); `'always'` returns `true` so the subsequent
`wrapInWorker` throws a real construction error. The consumer asked for a worker in an environment without one, and a
clear throw beats a silent downgrade.

**`DEFAULT_AUTO_THRESHOLD` (50,000) is a reasoned estimate** of where a postMessage round trip stops costing more than
the main-thread work it removes. The benchmark suite times in-process work only, so it is not a measured crossover; pass
a numeric policy to use a threshold measured on your own data.

### §15.3. Rule serialization registry integration

There is no worker-specific registration call. **One registry serves all four transports** — JSON config, URL state, the
worker bridge, and devtools snapshots — so a rule registered once is revivable everywhere:

```ts
import { FilterRule, ruleRegistry } from '@filter-enginez/core';

// Your custom rule, declaring its wire name as a literal.
declare class ContainsAllRule extends FilterRule {
  static override readonly ruleTypeName = 'ContainsAllRule';
  config: unknown;
}

// Run this on the main thread AND in the worker module.
ruleRegistry.register('ContainsAllRule', ContainsAllRule);
```

**Register on BOTH threads.** The worker needs it so `loadConfig` / `addRule` can revive the rule there; the main thread
needs it because the reactive adapters mirror the worker's rule map back and rehydrate through
`ruleRegistry.deserialize`. Missing the worker side fails loudly. Missing the main-thread side **keeps filtering
working** — the worker is doing it — while the rule is silently omitted from the mirror with one `console.warn` per rule
id, so any UI driven off that mirror shows a rule that is not there. See
[`docs/guides/worker_offload.md`](./guides/worker_offload.md).

There is deliberately no worker-specific registration helper: the single shared registry is the design, and the step
that matters is registering on the _second thread_.

### §15.4. Subscription proxy

`facade.subscribe(listener)` returns `Promise<Unsubscribe>`: the facade wraps the listener in Comlink's `proxy()` and
registers it with the worker-side engine, which calls it across the boundary for every change event. Events arrive in
their wire form (`toWireEvent`): rules as `SerializedRule`s, and the `results` / `sourceData` / `workingSet` events
without their item arrays (`next` and `previous` are empty — read the data through the facade, or through the
transferred indices). The reactive adapters (`createSignalsEngineFromAsync`, `createRxJsEngineFromAsync`) rehydrate the
rules through `ruleRegistry` and keep a synchronous mirror, which is what most consumers subscribe to.

---

## §16. Storage Adapters

One small interface backs devtools persistence (§10.7). Methods return `MaybePromise<T>`: the memory, `localStorage` and
`sessionStorage` adapters answer synchronously, `IndexedDBAdapter` asynchronously, and callers `await` either.

<!-- excerpt: packages/core/src/storage/StorageAdapter.ts#storage-adapter -->
<!-- prettier-ignore -->
```ts
/**
 * A value returned either synchronously or as a `Promise`. Lets synchronous adapters
 * (`MemoryStorageAdapter`, `localStorage` / `sessionStorage`) return values directly — without
 * pretending to be `async` — while I/O-backed adapters (`IndexedDBAdapter`, network, filesystem)
 * return a `Promise`. Callers simply `await` the result, which is valid for both.
 */
export type MaybePromise<T> = Promise<T> | T;

/**
 * The three-method contract every storage adapter implements.
 *
 * Methods may be synchronous or asynchronous (see `MaybePromise`): sync backends return values
 * directly; I/O-backed backends return a `Promise`. Callers always `await` the result.
 */
export interface StorageAdapter {
  /**
   * Load a value by key.
   *
   * @param key - The storage key
   * @returns The stored value, or `null` if not present
   */
  load(key: string): MaybePromise<unknown>;

  /**
   * Save a value under a key, replacing any existing value.
   *
   * @param key - The storage key
   * @param value - The value to store. Adapters are responsible for serialization
   *                (typically JSON.stringify for browser/IndexedDB; arbitrary for memory).
   */
  save(key: string, value: unknown): MaybePromise<void>;

  /**
   * Remove a stored value by key. Idempotent — removing a non-existent key is a no-op.
   *
   * @param key - The storage key
   */
  remove(key: string): MaybePromise<void>;
}
```

The isomorphic default, from the core entry:

<!-- excerpt: packages/core/src/storage/MemoryStorageAdapter.ts#memory-storage-adapter -->
<!-- prettier-ignore -->
```ts
/**
 * In-memory implementation of `StorageAdapter`. Stores values in a private `Map`.
 *
 * @example
 *   const engine = createFilterEngine({
 *     persistence: {
 *       adapter: new MemoryStorageAdapter(),
 *       key: 'wine-filters',
 *     },
 *   });
 */
export class MemoryStorageAdapter implements StorageAdapter {
  private readonly _store = new Map<string, unknown>();

  load(key: string): unknown {
    return this._store.has(key) ? this._store.get(key) : null;
  }

  remove(key: string): void {
    this._store.delete(key);
  }

  save(key: string, value: unknown): void {
    this._store.set(key, value);
  }
}
```

Browser sub-exports (`@filter-enginez/core/storage/browser`) — `LocalStorageAdapter`, `SessionStorageAdapter` (the same
shape over `sessionStorage`) and `IndexedDBAdapter`:

<!-- excerpt: packages/core/src/storage/browser/LocalStorageAdapter.ts#local-storage-adapter -->
<!-- prettier-ignore -->
```ts
/**
 * Persist via `window.localStorage` with a configurable namespace prefix.
 *
 * @example
 *   const engine = createFilterEngine({
 *     persistence: {
 *       adapter: new LocalStorageAdapter('my-app'),
 *       key: 'wine-filters',
 *     },
 *   });
 */
export class LocalStorageAdapter implements StorageAdapter {
  constructor(private readonly _namespace: string) {}

  load(key: string): unknown {
    const raw = localStorage.getItem(this._scopedKey(key));

    if (raw === null) {
      return null;
    }
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  remove(key: string): void {
    localStorage.removeItem(this._scopedKey(key));
  }

  save(key: string, value: unknown): void {
    localStorage.setItem(this._scopedKey(key), JSON.stringify(value));
  }

  private _scopedKey(key: string): string {
    return `${this._namespace}:${key}`;
  }
}
```

---

## §17. ESLint Plugin

### §17.1. `no-browser-api-in-core`

<!-- excerpt: packages/eslint/src/plugin/rules/no-browser-api-in-core.ts#default-lists-and-options -->
<!-- prettier-ignore -->
```ts
/**
 * The default set of forbidden browser globals.
 */
export const DEFAULT_FORBIDDEN_GLOBALS: readonly string[] = [
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'history',
  'navigator',
  'XMLHttpRequest',
  'HTMLElement',
  'KeyboardEvent',
  'MouseEvent',
  'CustomEvent',
];

/**
 * The default `allowedSubpaths` patterns — file paths matching these are exempt from the rule
 * because they're already gated behind browser-only sub-exports.
 */
export const DEFAULT_ALLOWED_SUBPATHS: readonly string[] = [
  '**/storage/browser/**',
  '**/browser/**',
  '**/keyboard/**',
];

/**
 * The rule's options shape.
 */
export interface NoBrowserApiInCoreOptions {
  /** Additional globals to forbid (consumer-specific). Appended to the default set. */
  readonly extraGlobals?: readonly string[];
  /** Glob patterns matching files exempt from the rule. Overrides the default if set. */
  readonly allowedSubpaths?: readonly string[];
}
```

Inside `create`, the options resolve against those defaults, and a file under an allowed subpath is skipped whole:

<!-- excerpt: packages/eslint/src/plugin/rules/no-browser-api-in-core.ts#resolve-options-and-skip -->
<!-- prettier-ignore -->
```ts
// Resolve the rule options against the defaults — `context.options[0]` is the user-passed
// object or `undefined`. The shape is `NoBrowserApiInCoreOptions` per the schema above.
const userOptions = (context.options[0] ?? {}) as NoBrowserApiInCoreOptions;
const extraGlobals = userOptions.extraGlobals ?? [];
const allowedSubpaths = userOptions.allowedSubpaths ?? DEFAULT_ALLOWED_SUBPATHS;

// Build the forbidden-globals set once per file invocation. A Set gives O(1) membership
// checks against the per-Identifier-node walks below.
const forbiddenGlobals = new Set<string>([...DEFAULT_FORBIDDEN_GLOBALS, ...extraGlobals]);

// File-level skip: if the file lives under one of the allowed sub-paths (e.g.,
// `core/src/storage/browser/`), the rule is a no-op for the entire file.
const filename = context.filename;

if (globMatchesAny(filename, allowedSubpaths)) {
  return {};
}
```

`URL` is deliberately absent from the forbidden list: it is a global in Node, Workers and Deno as well as the browser,
so the isomorphic packages may use it. Both lists are exported from `@filter-enginez/eslint/plugin` —
`DEFAULT_FORBIDDEN_GLOBALS`, and the subpath list as `DEFAULT_NO_BROWSER_API_ALLOWED_SUBPATHS` — so a consumer adapts
the rule instead of forking it: `extraGlobals` is appended to the forbidden list, while `allowedSubpaths` replaces the
default list, so extending it means spreading the exported default into the new one. Each rule's `meta.docs.url` points
at its section of `packages/eslint/README.md`.

### §17.2. `no-direct-mirror-mutation`

Reports every syntactic route to the redux-bridge mirror's `stateUpdated` action outside the bridge: importing it,
`*.actions.stateUpdated` member access, a `{ type: '<slice>/stateUpdated' }` literal for each name in `sliceNames`
(default `['filters']`), and a `stateUpdated` reducer declared in `createSlice`. Files under `allowedSubpaths` are
skipped.

<!-- excerpt: packages/eslint/src/plugin/rules/no-direct-mirror-mutation.ts#member-and-type-string-visitors -->
<!-- prettier-ignore -->
```ts
/**
 * Pattern A — `*.actions.stateUpdated` member access. The most common direct-dispatch
 * shape in consumer code: `store.dispatch(filtersSlice.actions.stateUpdated(...))`.
 * Reported on the `.stateUpdated` property itself for precise editor underlining.
 */
MemberExpression(node: ESTree.MemberExpression): void {
  if (isActionsStateUpdatedAccess(node)) {
    context.report({
      data: { suggestedMethod: 'addRule / setExpression / setSourceData' },
      messageId: 'directMutation',
      node: node.property,
    });
  }
},

/**
 * Pattern B — string-action dispatch shape: `{ type: 'filters/stateUpdated', ... }`.
 * Matches any `type:` property in an object literal whose value is one of the
 * configured `${sliceName}/stateUpdated` strings. Catches the un-typed dispatch path
 * (`store.dispatch({ type: 'filters/stateUpdated', payload })`).
 */
Property(node: ESTree.Property): void {
  const keyName = getPropertyKeyName(node);

  if (keyName !== 'type') {
    return;
  }
  const value = node.value;

  if (value.type !== 'Literal') {
    return;
  }
  if (typeof value.value !== 'string') {
    return;
  }
  if (!forbiddenActionTypeStrings.has(value.value)) {
    return;
  }
  context.report({
    data: { suggestedMethod: 'addRule / setExpression / setSourceData' },
    messageId: 'directMutation',
    node: value as unknown as ESTree.Node,
  });
},
```

### §17.3. `filter-rule-naming-convention`

For classes whose direct superclass is `FilterRule` (or `BaseFilterRule` / `AbstractFilterRule`): the name ends in
`Rule`, and the file path matches `rulesDirectoryGlob` (default `**/rules/**`). Both checks can be switched off
(`requireRuleSuffix`, `requireRulesDirectory`).

<!-- excerpt: packages/eslint/src/plugin/rules/filter-rule-naming-convention.ts#check-class -->
<!-- prettier-ignore -->
```ts
/**
 * Shared handler for both class-declaration and class-expression nodes. Runs both
 * configured checks (suffix + location) against the class name and the file path.
 *
 * @internal
 */
function checkClass(node: ESTree.ClassDeclaration | ESTree.ClassExpression): void {
  if (!isFilterRuleSubclass(node)) {
    return;
  }
  // Anonymous class expressions have no `id`; skip — they can't violate a naming rule
  // because they have no name to violate.
  const id = node.id;

  if (id === null || id === undefined) {
    return;
  }
  const className = id.name;

  if (shouldRequireRuleSuffix && !className.endsWith('Rule')) {
    // Suggest a name — strip a trailing `Filter` if present (a common typo) and
    // append `Rule`. `PriceFilter` → `PriceRule`, `Color` → `ColorRule`.
    const stripped = className.replace(/Filter$/u, '');
    const suggested = `${stripped}Rule`;

    context.report({
      data: { className, suggested },
      messageId: 'missingSuffix',
      node: id as unknown as ESTree.Node,
    });
  }

  if (shouldRequireRulesDirectory && !globMatchesPath(filename, rulesDirectoryGlob)) {
    context.report({
      data: { className },
      messageId: 'outsideRulesDirectory',
      node: id as unknown as ESTree.Node,
    });
  }
}
```

### §17.4. Recommended config

The plugin (`@filter-enginez/eslint/plugin`, registered under the `@filter-enginez` prefix) ships two presets:
`recommended` (`no-direct-mirror-mutation` at `error`) and `strict` (adds `filter-rule-naming-convention` at `warn`).
`no-browser-api-in-core` is in neither, because which files must stay isomorphic is a per-project decision; this
repository enables it through the `nodeIsomorphic` flat config from `@filter-enginez/eslint/config`, which seven
packages use. The same subpath ships the `base` and `react` configs the rest of the repository lints with.

<!-- excerpt: packages/eslint/src/plugin/configs.ts#build-configs -->
<!-- prettier-ignore -->
```ts
/**
 * Factory that builds the preset objects, parameterized over the plugin instance. The barrel
 * calls these immediately after constructing the plugin object so consumers see a fully-
 * wired `configs.recommended` / `configs.strict` on the plugin export.
 *
 * @param pluginInstance - The plugin object itself (with its `rules` map)
 * @returns The preset bundle
 */
export function buildConfigs(pluginInstance: Readonly<Record<string, unknown>>): {
  readonly recommended: FlatConfigPreset;
  readonly strict: FlatConfigPreset;
} {
  return {
    recommended: {
      name: '@filter-enginez/recommended',
      plugins: { '@filter-enginez': pluginInstance },
      rules: {
        '@filter-enginez/no-direct-mirror-mutation': 'error',
      },
    },
    strict: {
      name: '@filter-enginez/strict',
      plugins: { '@filter-enginez': pluginInstance },
      rules: {
        '@filter-enginez/filter-rule-naming-convention': 'warn',
        '@filter-enginez/no-direct-mirror-mutation': 'error',
        // no-browser-api-in-core stays project-scoped — the path globs vary per repo
      },
    },
  };
}
```

---

## §17a. `@filter-enginez/brand` — Canonical Assets Package

The single source for every branded asset across the project — every example app and the docs site — so the dual-accent
contract and the canonical mark stay version-coherent everywhere they appear.

> **This package lives in the examples repository,
> [`filter-enginez-examples`](https://github.com/mlilli/filter-enginez-examples), not in this one.** It is unpublished
> and React-bound, and its only consumers are the example apps. Every path in this section — `packages/brand/`,
> `docs/branding/design-system/`, the `tests/tooling/` guards and the `pnpm sync:brand-assets` script — is relative to
> that repository's root.

### §17a.1. Scope

**What ships in `@filter-enginez/brand`:**

- `Mark.tsx` — the canonical Round 06 logomark (Variant A · 7u baseline chamfer · 10u right-side flare · three crescent
  arcs · breathing synapse · primary/subdued/animated/no-rings prop matrix)
- `Wordmark.tsx` — `FILTER ENGINEZ` in Orbitron with the highlighted Z (cyan + glow)
- `loaders/SynapticOrbit.tsx`, `loaders/NeuralCluster.tsx`, `loaders/BrainSynapse.tsx` — the three canonical loaders
  with their disambiguated UX roles (see §17a.4)
- `tokens.css` — copy of `docs/branding/design-system/colors_and_type.css` (single source of truth: the design-system
  folder is the _authored_ source, the package is the _consumed_ source)
- `fonts/` — Inter, JetBrains Mono, Orbitron variable TTFs, served via `@font-face` from the package

**Browser-only.** Mark/Wordmark/loaders use SVG + CSS with no DOM-API calls, but they import React, so the package is
browser-bound, not isomorphic-core-adjacent.

### §17a.2. Source-of-truth flow

```text
docs/branding/design-system/    ← the authored design system (the DESIGN source of truth)
  ├── colors_and_type.css         tokens authored here
  ├── assets/logomark/Mark.jsx
  ├── assets/loaders/index.html   (extracted SVGs + CSS)
  └── ui_kits/filter-engine/      (reference impl — informs but doesn't ship)
                                          │
                                          │  (rewritten to our standards:
                                          │   strict TS, tabs, JSDoc/TSDoc,
                                          │   descriptive names, named exports)
                                          ▼
packages/brand/src/             ← @filter-enginez/brand (the CONSUMED source of truth)
  ├── Mark.tsx
  ├── Wordmark.tsx
  ├── loaders/*.tsx
  ├── tokens.css                  (design-system :root block, verbatim + layered
  │                                element defaults this package owns — see below)
  └── fonts/                      (bundled)
                                          │
                                          ▼
packages/examples-react-rtk/    │   packages/examples-react-plain/
                                │   (and any future docs / marketing surface)
```

When the design system updates, the design-system folder updates first; the brand package's TSX is regenerated to match.

**`tokens.css` is two things.** Its `:root` block is the design system's, declaration for declaration and in order —
pinned by `tests/tooling/brandTokens.test.ts`. Everything BELOW that block is owned by this package and is deliberately
absent upstream:

- the semantic element styles are wrapped in **`@layer base`**. Unlayered, they beat every Tailwind utility in the two
  React example apps regardless of specificity (CSS Cascade 5 ranks unlayered author styles above every layer), so
  unlayered, `h3 { font-size: var(--text-lg) }` would silently override `<h3 className="text-xs">`. Guarded by
  `tests/tooling/cascadeLayers.test.ts`.
- **`color-scheme: dark`**, without which the four non-React example apps render light-mode native form controls.
- **`cursor: pointer` / `not-allowed`** on checkboxes and radios, a normalization that belongs beside the focus ring.

All three address problems that exist only downstream of the design system — `@layer base` in particular solves a
Tailwind cascade collision that two of the six example apps have. Pushing them upstream would encode a consumer's build
choice in the delivered design system, so the split is intentional. The **raw logomark assets** under `src/assets/`
follow the opposite rule: they ARE byte-equal to their design-system sources, generated by `pnpm sync:brand-assets` and
pinned by `tests/tooling/brandAssets.test.ts`.

### §17a.3. Dual-accent semantic contract — load-bearing, not decorative

The highest-impact decision in the design system. Two accents with disjoint semantic roles:

- **Cyan (`--accent` `#22D3EE`)** = **data / identity / what.** Filter chips, result counts, links, focus rings,
  selected states, primary CTAs, filter-chip indicator dots, the C · Brain Synapse loader.
- **Phosphor (`--engine` `#F97316`)** = **activity / computation / when.** Devtools time-travel cursor, "computing"
  indicators, recompute states, undo/redo press feedback, the B · Neural Cluster loader.

**Never use them interchangeably.** Reaching for phosphor means _the engine is firing right now_; cyan refers to the
data being filtered. Temperature-paired (warm + cool), semantically disjoint. Components that violate the contract —
phosphor on a result-count badge, cyan on a "computing" spinner — are design-system violations.

**Legacy references:** CRT monochrome amber-phosphor terminals (1980s); Mass Effect trilogy's amber-on-cyan in-game HUD;
Tron Legacy's blue-on-orange light cycle palette. The temperature pairing is the through-line.

### §17a.4. The three canonical loaders

|       | Name               | Theme                         | Use for                                                                                                                    | Don't use for                                                                                                                                                       |
| ----- | ------------------ | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | **Synaptic Orbit** | Themed (acid / phosphor swap) | Ambient / passive — page load, idle background, route transitions, dataset switching                                       | Short blocking spinners (<2s) — rhythm has no time to read                                                                                                          |
| **B** | **Neural Cluster** | Themed (acid / phosphor swap) | Active computation — query running, filter rebuild, indexing, "processing your data"                                       | Ambient / idle states — implies real work, feels anxious when used for nothing                                                                                      |
| **C** | **Brain Synapse**  | Locked brand cyan             | The signature dataset-load moment — initial dataset fetch, dataset switch (full-screen), cold-start splash, marketing hero | Spaces narrower than 480px · ambient idle (use A) · active recompute (use B) · anything that recurs frequently — this is the rare "we're fetching your data" moment |

All three are square-aspect SVG + CSS, GPU-only animation (`transform`, `opacity`, `filter` only), respect
`prefers-reduced-motion: reduce` (freeze with glow lit). Source:
`docs/branding/design-system/assets/loaders/index.html`.

### §17a.5. Voice + copy conventions

Inherited from the design-system README:

- Direct, technical, sentence-case UI labels — "Clear all", "Filter by region", "237 results"
- Numbers always in JetBrains Mono with `font-variant-numeric: tabular-nums`
- No emoji in product UI
- No first-person ("I think you'll like…" is wrong; "Suggested next filters: Pinot Noir (P=0.78)" is right)
- Status copy is calm — "Couldn't load data. Retry?" not "Oops! Something went wrong!"

These conventions are encoded in JSDoc on the relevant components so consumers writing custom React components against
the brand package stay coherent.

---

## §17b. The Supporting Packages — and the Subpath Firewall

`mock-data` carries datasets rather than engine logic. It shares this chapter with a pattern rather than with other
packages: the **subpath firewall**, which explains a lot of otherwise-arbitrary-looking export maps.

**The problem: an import graph is transitive, so a barrel is a liability.** A package authored against React, or MSW, or
`@preact/signals-core`, cannot be consumed by anything that must avoid those dependencies — not because the code is
unusable, but because importing the barrel drags the whole graph along. The failures are not type errors; they are
runtime explosions in an environment the author never considered, or silent bundle bloat nobody measures.

**The tool: a narrow subpath that terminates before the contaminated file.** A firewalled package exposes entry points
scoped tightly enough that the module graph beneath them stays clean, and documents the constraint at the file it
protects. In this repository:

| Package     | Contaminant                               | Firewall                                   | Protects                       |
| ----------- | ----------------------------------------- | ------------------------------------------ | ------------------------------ |
| `mock-data` | MSW → `localStorage`; corpus loaders' I/O | `./books`, `./wine`, `./wine/generator`, … | Worker bundles, Node processes |

The same boundary shows up again in the test harness: `vitest.config.ts` splits packages into a `node` project and a
`jsdom` project along very nearly this line. The examples repository applies the same tool twice more, where the
contaminant is React (and, one level down, `@preact/signals-core`): `react-ui`'s `./bounds` and `examples-shared`'s
React-free `-core` / `-domain` subpaths (§17b.2, §17b.3).

### §17b.1. `mock-data`

Three datasets (real estate, wine, books) plus the MSW handlers that serve both the example apps in development and the
test suites. Isomorphic; runs in the `node` vitest project.

**Handlers are quarantined, and the root barrel is not safe.** The per-dataset barrels deliberately do not re-export
their handler arrays: MSW depends on `localStorage` through its cookie-store module, so pulling a handler into a Web
Worker bundle throws `Failed to create a CookieStore` at module-evaluation time — before any test or app code runs.
`./books`, `./wine` and `./real-estate` are therefore worker-safe data subpaths, while `./handlers` is the only
MSW-tainted entry. **Note that the root `.` barrel re-exports `allHandlers` and is tainted too**, which is why a Node
consumer such as the examples repository's `examples-server` imports only the Node-safe subpaths.

**Two tiers, sized to demonstrate something.** `DEFAULT_TIER_SIZE` is a uniform 10,000, generated at module load from a
seed (wine prefers a 10k sample of a locally imported real corpus when one exists). The full tiers are books 100k, wine
150k (`FULL_WINE_TIER_SIZE`) and real estate **exactly 50,000** — chosen to just trip `worker-bridge`'s
`DEFAULT_AUTO_THRESHOLD` of 50,000. The full tier _is_ the worker-engagement demo, so the sizes are a design decision
rather than an arbitrary "bigger". Books and real estate write theirs to gitignored JSON
(`pnpm regen:mock-data --full`). Wine's is generated rather than stored, in about a second, so a demo builds it inside
the Web Worker that hosts the engine: `./wine/generator` is a subpath with no loaders, no MSW and no top-level `await`,
and `tests/tooling/wineGeneratorWorkerSafe.test.ts` walks its import graph to keep it that way.

**The wine generator samples statistics, never records.** Its tables (`wine/generate-origins.ts`,
`wine/generate-profile.ts`) are aggregate counts measured from the Kaggle "Wine Reviews" dataset: every origin leaf and
varietal and the 9,663 pairings between them, the score histogram, the price-by-score curve with country and varietal
leans, vintage ages and descriptor frequencies per varietal. Origin and varietal are not drawn per record. The generator
apportions exactly `FULL_WINE_TIER_SIZE` records across the pairings by largest remainder and deals them out in a seeded
shuffle, so at full size every share is exact and the rarest pairing still appears, while record `i` depends only on the
seed and `i` — the default tier is the full tier's first 10,000 records. Everything from seed to field value uses
correctly rounded arithmetic only (`wine/generate-math.ts` replaces `Math.exp`, `Math.log` and the normal quantile),
because engines may disagree in the last bit of those functions and Node and Safari must produce the same wines.

**Determinism from ~6 lines rather than a dependency.** A seeded Mulberry32 PRNG makes two runs byte-identical, which is
what lets snapshots be stable and "the wine at index 42" be a citable reference. `seedrandom` and `faker` were rejected
on install cost. The `_generation/` prefix marks build-time-only code that no barrel re-exports.

**`handler-factory.ts` collapses 15 near-identical functions** (3 datasets × 5 handlers: list, filter config, slow,
fail, by id) into one generic `createDatasetHandlers<T>`. It is exported publicly so a downstream app can add a fourth
dataset on the same pattern. Handler ORDER is load-bearing: `/filter-config` must be registered before `/:id`, or MSW
resolves "filter-config" as an id.

**Gotcha worth knowing before touching the full tier.** `loadFullBooks` uses a variable-path dynamic import with an
inline `/* @vite-ignore */`, and both halves are load-bearing — the variable path stops TypeScript statically resolving
a multi-megabyte JSON file (which OOMs the compiler), and the comment stops Vite bundling it (which OOMs the dev
optimizer). A missing full corpus 404s with `DATASET_NOT_GENERATED` and the regen command rather than crashing.

### §17b.2. The Presentation Tier — `ui-styles` + `react-ui`

These two packages live in the examples repository,
[`filter-enginez-examples`](https://github.com/mlilli/filter-enginez-examples), and are not part of the engine.
`ui-styles` is the framework-agnostic component CSS every example app shares, and `react-ui` is the prop-driven React
component layer over it; both are unpublished. Their design — including `react-ui`'s import-free `./bounds` firewall and
the two-bounds model behind the range slider — is documented in their source in that repository.

### §17b.3. `examples-shared`

This package also lives in the examples repository,
[`filter-enginez-examples`](https://github.com/mlilli/filter-enginez-examples). It holds the dataset-domain and site
code the example apps share, and is the largest application of the subpath firewall described at the top of §17b: it has
no root export, only narrow subpaths, so that the non-React apps can reuse its React-free `-core` / `-domain`
orchestration without importing React. Its export map and module docblocks are the reference.

## §18. The Design Patterns Chapter (Where Each Pattern Lives)

This section maps each design pattern the engine uses to specific files in the codebase.

### Bridge (GoF Structural)

- **Engine ↔ Reactive surface**: `packages/core/src/FilterEngine.ts` is the abstraction;
  `packages/reactive-signals/src/createSignalsEngine.ts` and `packages/reactive-rxjs/src/createRxJsEngine.ts` are
  independent implementations.
- **React binding ↔ Reactive surface**: `packages/react-signals/src/hooks/*.ts` bridges React to the signals surface;
  `packages/react-rxjs/src/hooks/*.ts` bridges to RxJS.
- **Rule ↔ Evaluator**: `packages/core/src/internals/BitmapIndex.ts` (`tryComputeResults`, installed as the store's
  results accelerator) chooses between bitmap and predicate evaluation, with `internals/textPlan.ts` making the
  equivalent index-vs-scan choice for text rules; the rule classes don't know which.

### Adapter (GoF Structural)

- `packages/reactive-signals/src/createSignalsEngine.ts` adapts the core's `subscribe()` callback API into
  `@preact/signals-core` signals.
- `packages/reactive-rxjs/src/createRxJsEngine.ts` does the same for RxJS Observables, as `BehaviorSubject`s seeded from
  live engine state.

### Facade (GoF Structural)

- `packages/core/src/FilterEngine.ts` — one class fronting the multi-module composition (`InternalStore`, `Dispatcher`,
  `BitmapIndex`, `ExclusionGraph`, `SimulationCache`, `Devtools`); `createFilterEngine.ts` is its factory function.
- Every `packages/*/src/index.ts` is a facade barrel exporting the public surface and hiding internals.

### Composite (GoF Structural)

- `packages/core/src/rules/CompositeRule.ts` — `and(...)`, `or(...)`, `not(...)` form recursive trees.
- Evaluator in `packages/core/src/composition/ExpressionEvaluator.ts`.

### Proxy (GoF Structural)

- `packages/worker-bridge/src/wrapInWorker.ts` — returns a Comlink proxy that exposes the engine's API while the actual
  engine runs in a worker.

### Strategy (GoF Behavioral)

- `packages/core/src/storage/StorageAdapter.ts` — pluggable persistence (memory, localStorage, sessionStorage,
  IndexedDB, custom).
- `packages/core/src/internals/BitmapIndex.ts` — bitmap vs predicate strategy selection (`shouldUseBitmap`,
  `tryComputeResults`); `createAccelerationStack.ts` maps the `acceleration` options onto it.
- `packages/core/src/internals/textPlan.ts` — inverted-index vs linear-scan selection per text query.
- `packages/url-state-router/src/serializers.ts` — `json-base64`, `compact` and `human-readable` URL serializers, plus
  `createTaggedSerializer`.

### Observer (GoF Behavioral)

- `packages/core/src/FilterEngine.ts` `subscribe(callback)` is the canonical Observer.
- Subscribers live in a plain `Set` and are notified synchronously after each action and each time-travel restore.

### Command (GoF Behavioral)

- `packages/core/src/store/Action.ts` — `Action` records are commands; replayable, serializable, time-travelable.
- `packages/core/src/devtools/Replay.ts` re-applies commands.

### Memento (GoF Behavioral)

- `packages/core/src/store/snapshots.ts` — `EngineSnapshot` is the memento.
- `TimeTravel.jumpTo()` in `packages/core/src/devtools/TimeTravel.ts` restores via the memento.

### Template Method (GoF Behavioral)

- `packages/core/src/rules/FilterRule.ts` — `getFieldValue()` is the template; subclasses override `action`.

### Specification (Evans, DDD)

- The entire `packages/core/src/rules/` directory IS the Specification pattern. `FilterRule` is the specification,
  `CompositeRule` is the composite specification, Boolean operators compose specifications.

### Event Sourcing (Fowler)

- `packages/core/src/devtools/ActionLog.ts` + `packages/core/src/store/snapshots.ts` — state is the function of (initial
  state, log of actions). Replay reconstructs.

### Registry (Fowler)

- `packages/core/src/rules/ruleRegistry.ts` — `RuleRegistry` singleton mapping type names to classes. Powers JSON
  config, worker serialization, URL state, devtools persistence — one infrastructure, four use cases.

### Inversion of Control / Dependency Injection (Fowler)

- `createFilterEngine(options)` receives the source data, `devtools` (including the persistence `StorageAdapter`), an
  initial `config` and the `acceleration` strategy — none hard-coded. `attachSimilarity(engine, config)` receives the
  similarity configuration the same way. Consumers inject what they need.

### Lazy Initialization (Fowler)

- `BitmapIndex.getBitmap()` (`packages/core/src/internals/BitmapIndex.ts`) — built on first access.
- `ExclusionGraph`'s private `_ensureBuilt()` — same.
- `SimilaritySearch`'s private `_ensureIndexBuilt()` — same.
- `SpatialIndex`'s private `_ensureBuilt()` — same.

### Memoization (LRU) (Classical CS)

- `packages/core/src/lib/LRUCache.ts` — a doubly-linked-list LRU.
- `packages/core/src/internals/SimulationCache.ts` — uses LRUCache for memoized simulation results.

### Publish-Subscribe (Distributed systems)

- `packages/core/src/FilterEngine.ts.subscribe()` — fan-out to multiple subscribers.

### Iterator (GoF Behavioral)

- `packages/core/src/lib/LRUCache.ts` `Symbol.iterator` and `forEach`.
- `packages/core/src/devtools/ActionLog.ts` exposes iteration.
- `engine.getRules()` returns a `ReadonlyMap`, iterable as `[RuleId, FilterRule]` pairs.

### Factory Method (GoF Creational)

- `packages/core/src/rules/factories.ts` (`range()`, `inSet()`, …) and `packages/core/src/composition/factories.ts`
  (`and()`, `or()`, `not()`) each construct the appropriate rule class with consumer-friendly ergonomics.

### Functional Lens (FP / Optics)

- `packages/core/src/rules/FilterRule.ts` `FieldExtractor` type + `getFieldValue()` method.
- Four forms: a path string, an array of fallback paths, a function, or `undefined` for the item itself.

### Mediator (GoF Behavioral)

- `packages/core/src/FilterEngine.ts` mediates between `InternalStore`, `Dispatcher`, `BitmapIndex`, `ExclusionGraph`,
  `SimulationCache` and `Devtools` (which owns persistence). None of those subsystems directly know about each other.
  Similarity and suggestions are not colleagues: `attachSimilarity` binds to the store through a structural target, and
  `attachSuggestions` uses the engine only as an identity key.

### Interpreter (GoF Behavioral)

- `packages/core/src/rules/CompositeRule.ts` + `packages/core/src/composition/ExpressionEvaluator.ts` — the grammar is
  `(and | or | not) of rules`, the tree-walking evaluator is the interpreter.

### Explicitly Avoided: Signal/Slot

- We use Observer + Pub-Sub. The Qt-style Signal/Slot pattern has GUI-event-bus connotations that don't fit a data
  engine.

### Explicitly Avoided: Singleton

- `createFilterEngine()` returns fresh instances; nothing instantiates engine state at module load, so tests and pages
  can hold as many independent engines as they need.
- The one near-exception is `ruleRegistry` (a module-level singleton). Justified because it's a _type registry_ (no
  per-instance state), and consumers register their custom rule types once at app boot. Not a state singleton.

---

## §19. Performance and Benchmarks

- `benchmarks/` at the repo root: the private `@filter-enginez/benchmarks` package, never published
- standalone `tsx` + `tinybench`, deliberately decoupled from the Vitest runner so a test-runner upgrade cannot perturb
  the numbers. `tsx` runs with `benchmarks/tsconfig.runtime.json`, which clears the base config's `paths`: `tsx` applies
  them at runtime, and the type-only `rbush` mapping would load core's stub in place of the package
- a cell that throws or ends without samples fails the run, and nothing is written
- a generic cartesian-product matrix over the five acceleration axes, run against the tiered wine corpus, each tier
  named by its size: the 10k default tier and the 150k synthetic full tier, or, where the real corpus has been imported
  locally, its stratified 10k sample and all 129,907 reviews (`130k`)
- results written to `benchmarks/RESULTS.md` + `results.json` (`pnpm --filter @filter-enginez/benchmarks bench:write`);
  [filterenginez.com/how-it-works](https://filterenginez.com/how-it-works), built in
  [`filter-enginez-examples`](https://github.com/mlilli/filter-enginez-examples), runs the `simulate-per-option`
  workload live in the browser over the 10k tier

**`filter-intersection` measures `engine.computeResults()` against a fresh `applyFiltersAndQuery({})` predicate pass**,
never the memoized `getResultIndices()`, which would read a cached array and measure nothing.

### §19.1. Scenarios

| Scenario                                                              | What it measures                                                                | Corpus    |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------- |
| `filter-intersection`                                                 | Results via the bitmap AND vs a predicate pass                                  | 10k, full |
| `simulate-per-option`                                                 | `simulate()` over 40 options of one field, two standing rules                   | 10k, full |
| `similarity-find`                                                     | Top-k similar items (MinHash + LSH)                                             | 10k, full |
| `bayesian-suggest`                                                    | Top-3 suggestions from a synthetic session history (independent of corpus size) | 10k, full |
| `geo-radius-query`                                                    | "Within X km of Y" — R-tree vs haversine scan                                   | 10k, full |
| `text-search-query`                                                   | Whole-word `allWords` — inverted index vs scan                                  | 10k, full |
| `fuzzy-search-strict`                                                 | Fuzzy search at t=0.2 — trigram candidates vs a per-item Fuse probe             | 10k, full |
| `fuzzy-search-loose`                                                  | Fuzzy search at t=0.4 — guardrail that the bypass costs nothing                 | 10k, full |
| `replay-action-log-50`, `replay-action-log`, `replay-action-log-5000` | Replaying 50, 500 and 5000 logged actions                                       | 10k, full |

### §19.2. Configurations tested

The matrix is **2⁵ = 32 cells** over the five acceleration-stack optimizations, each toggled via the nested
`acceleration` construction option (§2.2):

1. Roaring Bitmaps — `acceleration.bitmap` (`'on' | 'off'`)
2. Mutual Exclusion Graph — `acceleration.exclusionGraph` (`'lazy' | 'off'`; `'eager'` answers queries identically to
   `'lazy'`)
3. Memoized Simulation Cache — `acceleration.simulationCache` (`true | false`)
4. R-tree Spatial Index — `acceleration.spatialIndex` (`'auto' | 'off'`)
5. Inverted Text Index — `acceleration.textIndex` (`'auto' | 'off'`)

Each scenario declares the axes that apply to it, so degenerate cells collapse (the R-tree axis applies only to
`geo-radius-query`, the text axis only to the text scenarios). Worker offload is not an axis: it moves work off the main
thread rather than making it faster, so there is no in-process cell to time (§15.2).

### §19.3. Output

`RESULTS.md` has one Markdown table per scenario and tier: each cell's mean, its 95% relative margin of error, the
sample count, a bar scaled to the slowest cell, and the cell's mean as a multiple of the fastest cell's. `results.json`
holds the same figures unrounded, with the run's `generatedAt` timestamp. An excerpt of the run of 2026-10-15:

```markdown
### Filter intersection — 10k

| Cell         |      Mean | ± 95% CI | Samples | Relative                                 |
| :----------- | --------: | -------: | ------: | :--------------------------------------- |
| `bitmap:on`  | 0.0220 ms |    ±3.2% |   45545 | `█░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░` 1.0×  |
| `bitmap:off` | 0.9234 ms |    ±0.6% |    1083 | `████████████████████████████████` 42.1× |
```

---

## §20. TypeScript Strategy

### §20.1. Generics flow

The `T` type parameter flows from `createFilterEngine<T>` through `InternalStore<T>` through the various internal
classes to the rule actions. Public-facing methods and result types like `getResults(): readonly T[]`,
`SimulationResult<T>` and `SimilaritySearch<T>.findSimilar(item: T)` preserve `T` for consumer ergonomics.

The challenge: rule classes are untyped at the engine level (the engine holds `Map<RuleId, FilterRule>` not
`Map<RuleId, FilterRule<T>>`) because rules can target different item shapes when composed. Rules carry their own
field-extractor + predicate, which together encode any type narrowing needed.

### §20.2. Exported types

All exported types live in `packages/core/src/types.ts` or alongside their classes. Naming conventions:

- Class names are PascalCase (`FilterRule`, `RangeRule`)
- Type aliases are PascalCase (`RuleId`, `ChangeEvent`)
- Function names are camelCase (`createFilterEngine`, `range`, `inSet`)
- Enumerations are string-literal unions (`AccelerationMode = 'auto' | 'bitmap' | 'predicate'`), and constants are
  UPPER_SNAKE (`CURRENT_CONFIG_VERSION`, `AUTO_BITMAP_THRESHOLD`)

### §20.3. Declaration maps

`tsconfig.base.json` sets `declarationMap: true` and `sourceMap: false`. Declaration maps let editors jump between
packages inside this repository; neither kind of map is published (§22.3).

### §20.4. `tsconfig` project references

Root `tsconfig.json` is a solution file: it owns no files and references each package's composite **build** config.

```json
{
  "files": [],
  "references": [
    { "path": "./packages/core/tsconfig.build.json" },
    { "path": "./packages/reactive-signals/tsconfig.build.json" },
    { "path": "./packages/angular-rxjs/tsconfig.build.json" },
    { "path": "./packages/reactive-rxjs/tsconfig.build.json" },
    { "path": "./packages/react-signals/tsconfig.build.json" },
    { "path": "./packages/react-rxjs/tsconfig.build.json" },
    { "path": "./packages/svelte-signals/tsconfig.build.json" },
    { "path": "./packages/vue-signals/tsconfig.build.json" },
    { "path": "./packages/redux-bridge/tsconfig.build.json" },
    { "path": "./packages/url-state-router/tsconfig.build.json" },
    { "path": "./packages/worker-bridge/tsconfig.build.json" },
    { "path": "./packages/eslint/tsconfig.build.json" },
    { "path": "./packages/mock-data/tsconfig.build.json" }
  ]
}
```

Each package's `tsconfig.build.json` declares its own references on the build configs of the workspace packages it
depends on. `tsc --build` walks the graph + incrementally rebuilds only what changed. Day-to-day typechecking runs each
package's own `tsconfig.json` (which includes tests) with `--noEmit`.

---

## §21. Testing Strategy

### §21.1. Per-package testing

Every package runs off the ROOT `vitest.config.ts`, which partitions packages into a `node` project and a `jsdom`
project (the two React bindings, `url-state-router` and `worker-bridge`); no package carries its own Vitest config.
Tests are co-located as SIBLINGS: `packages/<name>/src/**/<Module>.test.ts` sits directly beside `<Module>.ts`. There is
not a single `__tests__/` directory in the repo, and the only top-level test tree is `tests/tooling/` — a third Vitest
project for repo-level invariants that belong to no single package. The example apps' own suites, Playwright included,
live in the examples repository (§21.4).

### §21.2. Coverage policy

The policy:

- 100% of public API surface
- 100% of business-logic branches
- Genuinely unreachable defensive paths (`typeof window === 'undefined'` guards, exhaustive-switch throws) carry a
  `/* v8 ignore … -- reason */` comment stating why

CI fails if measured coverage drops below 100%. The thresholds are global aggregates over `packages/*/src`, not per
file, so `vitest.coverage.config.ts` excludes whole files (each with its reason) rather than tolerating a partly covered
module in scope.

### §21.3. MSW integration

`@filter-enginez/mock-data` exports MSW handlers, built by the public `createDatasetHandlers<T>` factory.
`handler-factory.test.ts` exercises the factory end-to-end through `msw/node`'s `setupServer` against a small synthetic
dataset. The example apps register the same handlers with `setupWorker` in development, so the responses the engine's
tests assert are the ones the apps are served.

### §21.4. E2E

This repository has no browser end-to-end suite. The Playwright tests that drive the example apps end-to-end — filter UI
rendered from the loaded JSON config, URL state round-trips, undo/redo via keyboard, cross-reload time-travel and the
rest — live with those apps in [`filter-enginez-examples`](https://github.com/mlilli/filter-enginez-examples), which
builds against packed tarballs of these packages.

### §21.5. Worker-bridge testing

`worker-bridge` tests run in the `jsdom` project with no real `Worker`: `src/test-support/workerHarness.ts` connects
`wrapInWorker` and `exposeFilterEngineWorker` over an in-process `MessageChannel`, so the Comlink round trip, transfers
and lifecycle are exercised end-to-end in CI. Parity tests confirm the engine API behaves the same main-thread and
worker-bridged.

---

## §22. Build and Distribution

### §22.1. Per-package build

Every package builds with the TypeScript compiler alone — `tsc --build tsconfig.build.json` — emitting ES modules and
declarations into `dist/`, one output file per source module (so consumers' bundlers tree-shake at module granularity).
There is no bundler step: each package's `exports` map points at `dist/` through `publishConfig`, which `pnpm pack`
applies, and `scripts/pack-engine-tarballs.sh` checks the packed result. One deliberate exception:
`@filter-enginez/eslint`'s `./config` subpath ships its flat configs as authored JavaScript (`src/config/**/*.js`),
since ESLint loads them directly. The build graph follows the `tsconfig.build.json` project references listed in §20.4.

Every package's manifest declares `"sideEffects": false`: no module does anything at import time beyond defining what it
exports, so a bundler drops every module an app does not import. An app that imports only `FilterEngineConfigError` from
`@filter-enginez/core` bundles under 1 kB of the package; fuse.js and rbush come in only with the engine code that uses
them, and roaring-wasm (about 231 kB of inline WebAssembly in its browser build) only with
`initializeBitmapAcceleration()`, which loads it through `import()` (§6.1).
[`tests/tooling/sideEffectFreePackages.test.ts`](../tests/tooling/sideEffectFreePackages.test.ts) keeps the declaration
true: it reads every module each package's `exports` reach and fails on a top-level statement whose effect could reach
outside its module, apart from a short list of reviewed ones that touch only their own module's bindings.

### §22.2. ESM-only

All packages ship ESM only. Reasoning:

- Modern bundlers (Vite, esbuild, Rollup, webpack 5+) all consume ESM natively
- Dropping CJS halves the dist surface
- Tree-shaking is more reliable with ESM
- Node 24.18+, the supported floor, loads ESM natively — including `require()` of ESM from CommonJS

### §22.3. Source maps + declaration maps

Neither ships. The published `files` allow-lists carry `dist/**/*.js` and `dist/**/*.d.ts` (plus the eslint package's
authored `src/config/**/*.js`), and the TypeScript sources the maps would point into are not published. JavaScript
source maps are switched off in `tsconfig.base.json` so no `sourceMappingURL` comment dangles in a published file (it
would make consumers' dev servers warn on every module); `pack-engine-tarballs.sh` fails if one appears. Declaration
maps are still emitted for in-repo editor navigation between packages, and stay out of the tarballs.

### §22.4. Bundle-size budgets

[`.size-limit.json`](../.size-limit.json) holds one budget per published entry, and `pnpm size` (or `pnpm size:json`)
measures them against `dist/`. **CI runs it as a blocking gate**, after the build.

Every figure is **gzipped**, and every figure but one is **marginal** — the engine, the framework and every third-party
dependency are `ignore`d per entry, so each budget measures the package's own code. Without that convention
`react-signals` would be measuring React. The exception is `core without bitmaps`, which measures what an app pays for
`createFilterEngine` with two rules, every dependency included: it pins that roaring-wasm stays out of an app that never
calls `initializeBitmapAcceleration()` (§6.1), a saving the marginal `core` entry cannot see because it ignores
roaring-wasm either way.

| Entry                                      | Budget  |
| ------------------------------------------ | ------- |
| `core` (default entry)                     | 19.5 kB |
| `core without bitmaps` (with dependencies) | 32 kB   |
| `core/storage/browser`                     | 2 kB    |
| `core/keyboard/browser`                    | 1 kB    |
| `reactive-signals`                         | 3 kB    |
| `reactive-rxjs`                            | 3.5 kB  |
| `react-signals`                            | 4 kB    |
| `react-rxjs`                               | 4 kB    |
| `svelte-signals`                           | 3 kB    |
| `vue-signals`                              | 3 kB    |
| `angular-rxjs`                             | 3 kB    |
| `redux-bridge`                             | 4 kB    |
| `url-state-router`                         | 3 kB    |
| `worker-bridge`                            | 5 kB    |

Each budget sits at the measured size rounded up to the next 0.5 kB, so a regression shows as soon as it crosses the
nearest half kilobyte. `core` measures about 19.1 kB: the error hierarchy (§2.5), the on-demand load of roaring-wasm
(§6.1), filter groups composed into every evaluation path, bitmap-backed results, the devtools snapshot codec with
cross-reload persistence, devtools failure reporting, the rules' revival of open bounds and checking of options from
JSON (§9.3), array-valued membership and its facet counts, `FuzzySearchRule`'s Fuse option passthrough with its
per-collection index (§4.3), and the R-tree's cap geometry (§6.2) are all in its default entry. `core without bitmaps`
measures about 31.7 kB: about 18.3 kB of core and the rest its dependencies (zod, fuse.js, rbush, `@preact/signals-core`
and microdiff). The same app with `initializeBitmapAcceleration()` added measures about 126 kB when its bundler inlines
roaring-wasm, and stays near 32 kB when the bundler splits code and fetches roaring-wasm as its own chunk.
`reactive-rxjs` measures about 3.0 kB, most of it the worker-backed adapter and its `engine.core` shim, which answers
every public `FilterEngine` member (§11.2). `tests/tooling/sizeLimitBudgets.test.ts` holds this table to
`.size-limit.json`.

`similarity/` and `suggestions/` sit behind their own subpaths (§2.4) so that `core`'s default entry carries neither;
`angular-rxjs` is the smallest binding because Angular consumes `Observable`s natively, leaving only DI to plumb.

---

## Appendix A — Cross-References

| Topic                  | Where this doc covers it                                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Architectural pillars  | §1 (deep-dive)                                                                                                                                |
| 13-package layout      | §2 (core); §11-§12a, §13-§17 (per package); §17b.1 (`mock-data`). §17a and §17b.2-§17b.3 cover packages that live in the examples repository. |
| Public API contract    | §2.2 (exact types)                                                                                                                            |
| Rule catalog           | §4 (impl details)                                                                                                                             |
| CompositeRule algebra  | §5 (evaluator impl)                                                                                                                           |
| Four cool algorithms   | §6-8a (per algorithm impl)                                                                                                                    |
| Devtools               | §10 (impl details)                                                                                                                            |
| Reactive adapters      | §11 (impl outline)                                                                                                                            |
| React bindings         | §12 (impl outline)                                                                                                                            |
| Redux bridge           | §13 (impl outline)                                                                                                                            |
| Worker bridge          | §15 (impl outline)                                                                                                                            |
| URL state router       | §14 (impl outline)                                                                                                                            |
| Storage adapters       | §16 (interfaces + built-ins)                                                                                                                  |
| ESLint plugin          | §17 (rule impls)                                                                                                                              |
| Mock data              | §17b.1 (package); §21.3 (MSW in tests)                                                                                                        |
| Examples               | The [`filter-enginez-examples`](https://github.com/mlilli/filter-enginez-examples) repository — out of scope here                             |
| Performance            | §19 (impl + reporting)                                                                                                                        |
| Implementation cadence | §1.6 (deep-dive)                                                                                                                              |
| 22-pattern inventory   | §18 (per-pattern file mapping)                                                                                                                |

---

## Appendix B — File-Path Index

There is no repository-wide file index: a hand-maintained list across every package would fall out of date silently,
since no gate can fail on a stale prose list. Structure is documented where it stays true:

- **Per-package structure** lives in the chapter for that package (§2.1 for `core`, §17b.1 for `mock-data`, and so on).
  Narrower scope, adjacent to the prose explaining it, so the two change together.
- **The dependency graph** is `pnpm-workspace.yaml` plus each package's `tsconfig.build.json` `references` array —
  machine-readable, and the build fails when it is wrong.
- **The public surface** of each package is its `exports` map. That is the contract consumers actually bind to; a file
  list is an implementation detail they should not be reading.
- **File-level intent** belongs in the file, as a `@packageDocumentation` docblock. Those are reviewed in the same diff
  as the code they describe, which is the only mechanism in this repo that reliably keeps description and reality
  together.

---

## Living Document Notes

This document evolves with the code, and when the two disagree **the code wins** and this document is fixed. For its
code blocks the disagreement cannot go unnoticed: an excerpt that no longer matches its region, or an example that no
longer compiles, fails `tests/tooling/docCodeBlocks.test.ts` (§0.1). Prose is kept true the same way any review keeps it
true — by changing it in the same diff as the code it describes.
