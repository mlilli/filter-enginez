# Guide — Predictive Disable (never reach zero results)

> **Audience:** consumers building a filter UI on top of `@filter-enginez/core`. This guide is framework-agnostic — the
> engine primitives are plain method calls; a React example is included at the end, but the same approach applies to
> Vue, Svelte, Angular, Solid, or vanilla DOM.

---

## What this is

In a multi-filter UI, a user can narrow filters until **nothing matches** — a dead end. _Predictive disable_ prevents
that: every candidate a user could pick is checked ahead of time, and any option that would empty the result set is
**disabled** (a chip greys out, a checkbox locks, a slider's empty zone dims). The user can never paint themselves into
a zero-result corner.

Filter EngineZ gives you everything you need to build this in **one engine call per filter change**, computed in a
single pass over the working set — no per-candidate fan-out.

---

## The two primitives

| Method                               | Use it for                                                                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `engine.applyFiltersAndQuery(query)` | Chip-style facets (`inSet` / `inSetOfSets` / `containsAll`) and range sliders, in one pass. Returns per-candidate `wouldBeEmpty` + projected counts, and filtered-except-self bounds/histograms. |
| `engine.getResults()`                | Single-value toggles the query doesn't model (boolean / exists / predicate / Bloom membership / etc.).                                                                                           |

Both are **isomorphic** (Node, browser, edge, worker) and both are cheap: `applyFiltersAndQuery` does a single
working-set pass; `getResults()` is memoized by the signal graph until the rules, groups, expression or working set
change.

Both assume the flat-map filter is a conjunction — every rule must pass — which is the normal shape of a facet panel.
While an expression is set, or a filter group with `composition: 'or'` spans two or more registered rules,
`applyFiltersAndQuery` returns the results with empty `chipGroups` and `fields`, because per-facet projections are not
defined for a composed filter.

---

## 1. Chip facets — `inSet`, `inSetOfSets` and `containsAll`

Build a `FilterBundleQuery` with one `chipGroups` entry per facet. Each entry names the `ruleId` the facet toggles, the
`field` the constructed rule tests, and the `candidates` to check.

```ts
import type { FilterEngine } from '@filter-enginez/core';
import type { Book } from '@filter-enginez/mock-data/books';

declare const engine: FilterEngine<Book>;
declare function setChipDisabled(ruleId: string, value: string, disabled: boolean): void;

const bundle = engine.applyFiltersAndQuery({
  chipGroups: [
    // Simple membership: "selecting this candidate" = add this one value to an InSetRule.
    { kind: 'inSet', ruleId: 'genre', field: 'genre', candidates: ['fiction', 'biography', 'fantasy'] },

    // Grouped / hierarchical membership: each candidate carries the SET of leaf values selecting
    // it would imply (a super-group, a tree node, a country → its regions, …). Backs InSetofSetsRule
    // and HierarchicalRule.
    {
      kind: 'inSetOfSets',
      ruleId: 'genre-groups',
      field: 'genre',
      candidates: [
        { value: 'Speculative', leafIds: ['fantasy', 'science-fiction'] },
        { value: 'Nonfiction', leafIds: ['biography', 'history', 'science'] },
      ],
    },
  ],
});

// The response mirrors the query order. Each candidate carries `wouldBeEmpty` + `projectedCount`.
for (const group of bundle.chipGroups) {
  for (const candidate of group.candidates) {
    setChipDisabled(group.ruleId, candidate.value, candidate.wouldBeEmpty);
    // candidate.projectedCount → optional "(1,204)" count badge on the chip.
  }
}
```

`wouldBeEmpty` answers _"if I added this candidate to its rule, keeping every OTHER active rule, would the result be
empty?"_ It is computed against the current rule set, so it is **automatically bidirectional**: pick a value in facet A
and the conflicting values in facet B disable, and vice versa.

**Always leave a selected candidate clickable** even if `wouldBeEmpty` is `true` for its neighbors — the user must be
able to deselect to escape. (The `ChipToggleGroup` component in the examples repository's `react-ui` package does this:
`disabled = wouldBeEmpty && !isSelected`.)

---

## 2. Range sliders — filtered-except-self bounds

Request a `fields` entry per numeric slider. The engine returns the tight `{ min, max }` over the items that pass
**every other rule except this slider's own** (so dragging the slider doesn't shift its own limits), plus a pre-bucketed
histogram (`bucketCount` buckets, default 12).

```ts
import type { FilterEngine } from '@filter-enginez/core';
import type { Book } from '@filter-enginez/mock-data/books';

declare const engine: FilterEngine<Book>;

const baselineMin = 0;
const baselineMax = 2000;
const bundle = engine.applyFiltersAndQuery({
  fields: [{ ruleId: 'page-count', fieldKey: 'pageCount', baselineMin, baselineMax, bucketCount: 24 }],
});

const [field] = bundle.fields;
// `bounds.min` / `bounds.max` are `null` when nothing passes the other rules — fall back to baseline.
const available =
  field === undefined || field.bounds.min === null || field.bounds.max === null
    ? { min: baselineMin, max: baselineMax }
    : { min: field.bounds.min, max: field.bounds.max };

// Constrain the slider's draggable range (and dim the outside) to `available` so a drag can't land
// the handles where no data exists. (`field.histogram` → { bucketEdges, counts } for a bar overlay.)
```

Constraining **drag** to the available zone is what keeps sliders from reaching zero. Note that a free-typed value in a
numeric text input can still fall outside the zone (the engine simply returns nothing for it) — that residual is a
deliberate UX choice; clamp the text input too if you want it airtight.

---

## 3. Single-value toggles — use `getResults()`

`applyFiltersAndQuery` models the `inSet` / `inSetOfSets` / `containsAll` shapes. Single-value toggles (`BooleanRule`,
`ExistsRule`, `PredicateRule`, `BloomMembershipRule`, `RegexRule`, …) don't fit that mold — but the check is a
one-liner. Turning a toggle **on** ANDs its rule with the current results, so the result is empty **iff none of the
current results already pass that rule**:

```ts
import { bool, exists, type FilterEngine, type FilterRule } from '@filter-enginez/core';
import type { Book } from '@filter-enginez/mock-data/books';

declare const engine: FilterEngine<Book>;
declare function setToggleDisabled(toggleId: string, disabled: boolean): void;

function wouldToggleEmpty<T>(engine: FilterEngine<T>, candidateRule: FilterRule): boolean {
  const results = engine.getResults();
  return !results.some((item) => candidateRule.action(item, candidateRule));
}

setToggleDisabled('in-print', wouldToggleEmpty(engine, bool('isInPrint', true)));
setToggleDisabled('has-rating', wouldToggleEmpty(engine, exists('averageRating')));
```

An **already-active** toggle is never reported empty (its results all pass it), so the user can always turn it back off.

---

## 4. Recompute on every change

Predictive-disable data is only correct for the current rule set, so recompute it whenever the engine changes. Subscribe
once:

```ts
import type { FilterEngine } from '@filter-enginez/core';

declare const engine: FilterEngine;
declare function refreshExclusionData(): void;

const unsubscribe = engine.subscribe(() => {
  refreshExclusionData(); // re-run applyFiltersAndQuery + the toggle checks, update your controls
});
```

(React/Vue/etc. bindings expose this as a `lastChange` hook — see the framework example below.)

---

## 5. Main thread vs. worker

- **Main thread:** call `engine.applyFiltersAndQuery(query)` synchronously; the result is ready immediately.
- **Worker bridge:** call `asyncEngine.applyFiltersAndQuery(query)` — it returns a `Promise`, and the response's typed
  arrays (result indices, histogram counts) are transferred zero-copy. Guard against a stale in-flight response when
  filter changes arrive faster than the worker answers.

Either way it is **one round-trip** per filter change, where a `simulate()` call per candidate would cost one per chip —
which is why `applyFiltersAndQuery` exists.

---

## 6. Boundaries

- **Free-text search can't be predictive-disabled** — an arbitrary query may or may not match; there are no discrete
  candidates to check. Leave text/fuzzy/regex inputs always enabled.
- **Probabilistic rules keep the guarantee, not the intent.** `BloomMembershipRule` is a pre-screen with tunable false
  positives. The disable check uses the **same** rule instance that gets applied, so never-zero still holds exactly —
  but a Bloom toggle may stay _enabled_ and surface a few false-positive rows rather than disabling. If a false positive
  would be user-visibly wrong, pair the Bloom rule with an exact check (e.g. `and(bloomMembership(...), range(...))`).
- **Selected options stay clickable** so the user can always back out (see §1).

---

## React reference implementations

Two worked examples ship in the examples repository,
[`filter-enginez-examples`](https://github.com/mlilli/filter-enginez-examples) (paths relative to its root):

- **Books — `packages/examples-shared/src/books/filterBundle.tsx`** — the simpler, main-thread version. A
  `BooksBundleContext` distributes one synchronous `applyFiltersAndQuery` result; `useBooksChipExclusion(ruleId)`
  reshapes a chip group into the `ExclusionMap` the `ChipToggleGroup` consumes; `useBooksFieldBounds(ruleId)` feeds a
  slider's `available` zone; and `useToggleWouldBeEmpty` is the `getResults().some(...)` check for the boolean / exists
  / Bloom toggles. Start here.
- **Wine — `packages/examples-shared/src/wine/filters/filterBundle.tsx`** — the fuller version: worker-bridge offload
  with a stale-fetch guard, plus per-slider histograms and a hierarchical `inSetOfSets` origin picker.

The engine surface these build on is documented in [`../architecture.md`](../architecture.md) (§2
`applyFiltersAndQuery`, §19 performance) and the query / response shapes in `packages/core/src/queryBundle.ts`.
