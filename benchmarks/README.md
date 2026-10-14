# @filter-enginez/benchmarks

The tinybench performance suite for Filter EngineZ. Private, never published — it exists to keep the acceleration-stack
claims honestly measured.

See [`docs/architecture.md`](../docs/architecture.md) §19 (performance + benchmark methodology).

## Running

```bash
pnpm bench                     # run all scenarios + tiers, print the report to stdout
pnpm --filter @filter-enginez/benchmarks bench:write   # also write RESULTS.md + results.json
```

**The committed `RESULTS.md` is a full default run** (all scenarios, the 10k tier and the full tier) — regenerate it
with `bench:write` on real, quiet hardware; a shared/throttled machine (CI runner, container) produces numbers not worth
committing.

Optional flags narrow or speed up a run (pass them through after `bench` / the `tsx src/run.ts` entry):

```bash
tsx src/run.ts --tiers=10k                 # only the 10k default tier — never loads the full tier
tsx src/run.ts --scenarios=filter-intersection,geo-radius-query
tsx src/run.ts --tiers=10k --time=100 --warmup=50   # a fast smoke (default: 1000ms / 150ms per cell)
```

`--tiers=10k` is what makes a quick CI or low-memory sanity run practical: it never generates the 150k full tier (or,
where the real corpus has been imported locally, parses its ~116MB JSON). The full tier is named by its size in the
report: `150k` for the synthetic wines, `130k` for the real corpus.

The runner is standalone [`tsx`](https://github.com/privatenumber/tsx) + `tinybench` — decoupled from the Vitest test
runner so a test-runner upgrade can't perturb the numbers.

## Shape

The harness is a **generic cartesian product over registered acceleration axes**, so the matrix grows without rework as
axes are added:

- Axes: `bitmap`, `exclusionGraph`, `simulationCache`, `spatialIndex`, `textIndex` (2⁵ = 32 cells). Worker offload is
  not an axis: it moves work off the main thread rather than making it faster, so it has no in-process cell to time.

Each scenario declares its **applicable axes**, so degenerate cells collapse (the R-tree axis applies only to
`geo-radius-query`).

## Scenarios

| Scenario                 | Measures                                                            | Status |
| ------------------------ | ------------------------------------------------------------------- | ------ |
| `filter-intersection`    | Predicate path vs Roaring-Bitmap intersection                       | live   |
| `simulate-per-option`    | The disable-empty-options simulate hot path                         | live   |
| `similarity-find`        | MinHash + LSH top-k similar lookup                                  | live   |
| `bayesian-suggest`       | Bayesian co-occurrence top-3 suggestions                            | live   |
| `geo-radius-query`       | "Within X km of Y" — R-tree vs haversine scan                       | live   |
| `text-search-query`      | Whole-word `allWords` via the Roaring inverted text index vs scan   | live   |
| `fuzzy-search-strict`    | Typo-tolerant search (t=0.2) — trigram candidate pre-filter vs Fuse | live   |
| `fuzzy-search-loose`     | Default-threshold fuzzy (t=0.4) — guardrail that the bound bypasses | live   |
| `replay-action-log-50`   | Action-log replay of 50 actions                                     | live   |
| `replay-action-log`      | Action-log replay of 500 actions                                    | live   |
| `replay-action-log-5000` | Action-log replay of 5000 actions                                   | live   |

> `filter-intersection` measures `engine.computeResults()` (the Roaring-Bitmap path) against a fresh
> `engine.applyFiltersAndQuery({})` predicate pass — **never** the memoized `getResultIndices()`, which would read a
> cached array and measure nothing. See the scenario source for the full rationale.

## Why there's no exclusion-graph scenario

`exclusionGraph:lazy` vs `off` reads **flat** in `simulate-per-option`, and a dedicated scenario would too — ~1.0×
(within 1%) even when every simulated option is mutually exclusive with a standing rule. Two structural reasons:

1. **`lazy` never fires the short-circuit in a simulate loop.** `SimulationCache` gates the exclusion check on
   `exclusionGraph.isReady`, which is `false` until the graph is built — and only `eager` (or an explicit
   `precomputeExclusions()` / a direct `areExclusive` call) builds it. A pure `lazy` + simulate workload never
   self-builds, so `lazy` is behaviorally identical to `off` there.
2. **Even `eager` gains nothing measurable.** `wouldExcludeAll` rebuilds the candidate rule's bitmap (the O(N) cost) for
   a not-yet-active hypothetical, and the bitmap path it would replace _also_ short-circuits on an empty intersection —
   so the win is an AND-chain tail the candidate build dwarfs.

The exclusion graph's genuine payoff is its **direct-query API** — `engine.exclusionGraph.areExclusive(a, b)` /
`getExclusions(id)` for "grey out incompatible filters," O(1) after one build — which the on/off axis matrix can't
express (`off` declines rather than computing a slow answer). So the suite ships no exclusion-graph scenario: a cell
would read ~1.0× and imply the layer is worthless, when it's simply not a _simulate_ speedup. See the note on
`ExclusionGraph.wouldExcludeAll`.
