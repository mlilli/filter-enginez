/**
 * @fileoverview The `coverage.exclude` list for the root Vitest config.
 *
 * @remarks
 * ### Why this is its own file
 *
 * Keeping it out of `vitest.config.ts` keeps that file under its 500-line `max-lines` cap. The
 * repo's standards are explicit that the answer to `max-lines` is to split the file, not to disable
 * the rule — and the separation is not merely mechanical: this list is a DOCUMENT. Its entries carry their
 * reasoning about why individual modules are or are not measured, it is edited on its own schedule,
 * and a tooling guard reads it as text. The runtime config around it is configuration only.
 *
 * ⚠ **The `.config.ts` suffix is load-bearing, not decorative.** The shared ESLint preset's
 * `allowDefaultProject` admits exactly `*.config.js`, `*.config.mjs`, `*.config.ts` and
 * `eslint.config.js` at the repo root — no package tsconfig includes root tooling files, so a
 * root-level TypeScript file named anything else fails typed linting with "not found in any
 * project". Renaming this to, say, `vitest-coverage-exclude.ts` would break `pnpm lint` in a way
 * whose message points at the type system rather than at the filename.
 *
 * 🔴 **A tooling guard parses this file as TEXT**, not by importing it —
 * `coverageExclusionsResolve.test.ts`, through `tests/tooling/support/coverageExclusions.ts`, which
 * asserts that every entry below still matches a real path. It strips comment lines first, because a
 * block that narrows a blanket exclusion quotes the glob it replaced, and a matcher over the raw file
 * picks those up. If this file is ever renamed, that reader is the thing to change with it.
 *
 * @packageDocumentation
 */

/** Paths the V8 coverage provider must not measure. See each block for its rationale. */
export const COVERAGE_EXCLUDE: readonly string[] = [
	'**/*.d.ts',
	'**/*.test.{ts,tsx}',
	'**/dist/**',
	// Import-only test scaffolding (controllable fakes + the react-signals render
	// harness) — ships no runtime behavior; excluded under the whole-file coverage
	// exception.
	'**/fakeAsyncEngine.ts',
	'**/test-support/**',
	// Pure type-declaration modules — interfaces / type aliases only, zero runtime
	// statements to execute (their contents erase at compile time). The V8 provider
	// otherwise reports them as 0% because it can't attribute any covered line to
	// them; excluded under the whole-file coverage exception.
	'**/worker-bridge/src/FilterEngineAsync.ts',
	'**/worker-bridge/src/WorkerHostedEngine.ts',
	// ─── mock-data: procedural generators + dynamic-import data loaders ─────────────
	// WHY EXCLUDED (whole-file coverage exception):
	//   1. The domain *generators* (`<dataset>/generate.ts` and wine's `generate-*.ts` modules)
	//      synthesize fixture corpora. The seeded RNG they lean on (`_generation/random.ts`) IS
	//      unit-tested; the corpus-shaping code above it is held to a statistical contract
	//      instead (wine's `generate.test.ts`: determinism, every leaf and varietal present,
	//      distributions within tolerance of the measured targets), which line coverage does
	//      not measure.
	//   2. The `<dataset>/data.ts` + `wine/corpusLoaders.ts` loaders are environment-dependent
	//      dynamic-import glue: their branches hinge on which gitignored / on-demand JSON files
	//      exist on a given machine, and the full-tier paths would load 100MB+ corpora.
	//      Deterministic 100% would require mocking the runtime module system for little value
	//      over the handler-factory tests that already exercise the served data end-to-end.
	'**/mock-data/src/*/generate.ts',
	'**/mock-data/src/*/generate-*.ts',
	'**/mock-data/src/*/data.ts',
	'**/mock-data/src/wine/corpusLoaders.ts',
	// The per-dataset `handlers.ts` are thin wiring: `createDatasetHandlers({ basePath,
	// loadDefaultRecords: () => <records>, loadFilterConfig: () => <config>, loadFullRecords })`.
	// All the CRUD / pagination / lazy-loader logic lives in `handler-factory.ts`, which IS
	// unit-tested end-to-end (`handler-factory.test.ts`, absolute basePath + fake loaders). The
	// real handlers use RELATIVE basePaths (`/api/books`), which MSW's Node `setupServer` passes
	// through (no `location` to resolve), so their trivial loader arrows can't be invoked from a
	// Node unit test — they're exercised in the browser (dev + e2e), same category as the
	// `data.ts` loaders excluded above. `datasets.test.ts` still asserts the wiring is present.
	'**/mock-data/src/*/handlers.ts',
	'node_modules/**',
];
