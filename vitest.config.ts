/**
 * @fileoverview Root Vitest configuration for the Filter EngineZ monorepo.
 *
 * Plain Vitest 4 — **no Cloudflare** pool (`@cloudflare/vitest-pool-workers`,
 * workerd / miniflare). Filter EngineZ is an isomorphic TypeScript *library*
 * monorepo, not a Workers app, so tests run in plain Node (isomorphic packages)
 * and jsdom (browser packages).
 *
 * ## Two projects, split by runtime
 *
 * Vitest 4 removed the `vitest.workspace.*` file in favor of `test.projects`.
 * We define two projects, partitioned by the package's runtime target:
 *
 *   - **node**  — the isomorphic packages + the Node tooling package. No DOM.
 *   - **jsdom** — the browser-only packages (React bindings + URL-state router
 *                 + worker bridge).
 *
 * Each project `extends: true` so it inherits the root-level test options
 * (coverage, `clearMocks`, `passWithNoTests`) defined below.
 *
 * ## No prior build needed
 *
 * Every package's `exports["."]` points at its TypeScript source (`./src/...`),
 * so cross-package imports in tests resolve to source and Vitest transpiles them
 * on the fly — there is no `dist` dependency, hence no Turborepo `^build` gate on
 * the test run. Run from the repo root with `vitest run` (see the `test` scripts
 * in the root `package.json`).
 *
 * ## Coverage — V8
 *
 * `@vitest/coverage-v8`. The Node + jsdom pools expose the V8 inspector protocol
 * the V8 provider needs (a Cloudflare Workers pool cannot, which is the usual reason
 * to fall back to Istanbul), and Vitest 4's V8 provider uses AST-aware remapping
 * (`ast-v8-to-istanbul`) for branch-accurate coverage without source
 * instrumentation — so V8 is both faster and the modern default. Defensive
 * unreachable branches use a `v8 ignore` comment + rationale.
 *
 * 🔴 **The thresholds below ARE armed — 100% on branches, functions, lines and statements.**
 *
 * 🔴 **They are GLOBAL aggregates with no `perFile`, and that is the part worth carrying.** One
 * uncovered branch anywhere in the include set turns the whole run red and names no file — the
 * symptom points at the repo rather than at the module. That is why `vitest.coverage.config.ts`
 * excludes whole files, each with its reason at the site, rather than tolerating a partly covered
 * module in scope: anything included must already be at exactly 100%, and a newly included module is
 * a risk to the aggregate rather than only to itself.
 *
 * The `coverage.exclude` list itself lives in `vitest.coverage.config.ts`, which keeps this file
 * under the 500-line `max-lines` cap, and the separation is not merely mechanical: that list is a
 * DOCUMENT — almost all of its length is reasoning about why individual
 * modules are or are not measured — while what remains here is configuration. A tooling guard
 * parses it as text; see its own header before renaming it.
 */

import { defineConfig } from 'vitest/config';

import { COVERAGE_EXCLUDE } from './vitest.coverage.config.js';

/** Isomorphic + Node-tooling packages — tests run under the plain Node runtime. */
const NODE_TEST_PACKAGES: readonly string[] = [
	'angular-rxjs',
	'core',
	'eslint',
	'mock-data',
	'reactive-rxjs',
	'reactive-signals',
	'redux-bridge',
	'svelte-signals',
	'vue-signals',
];

/** Browser-only packages — tests run under jsdom. */
const BROWSER_TEST_PACKAGES: readonly string[] = [
	'react-rxjs',
	'react-signals',
	'url-state-router',
	'worker-bridge',
];

/**
 * Build a Vitest `include` glob that scopes to the `*.test.{ts,tsx}` files under
 * the `src/` of the supplied workspace packages.
 *
 * @remarks
 * 🔴 **A ONE-NAME LIST MUST NOT BECOME A BRACE GROUP.** `packages/{examples-server}/…` matches NOTHING:
 * picomatch — the matcher behind Vitest's `include` — treats a brace group without a comma as literal
 * text, and Vitest only complains when EVERY project finds no files. So a project whose list shrinks to
 * one entry would run zero tests and report success — a live case for any one-package project, such
 * as the examples repository's `node` project. Verified against picomatch directly —
 * `{examples-server}` false, `{examples-server,x}` true.
 *
 * @param packageNames - Unscoped package directory names under `packages/`
 * @returns One glob covering those packages' test files
 */
const buildPackageTestGlob = (packageNames: readonly string[]): string =>
	packageNames.length === 1
		? `packages/${packageNames[0] ?? ''}/src/**/*.test.{ts,tsx}`
		: `packages/{${packageNames.join(',')}}/src/**/*.test.{ts,tsx}`;

export default defineConfig({
	test: {
		// Reset spies / mocks / stubs between tests so one test's mock can't leak
		// into the next — the usual first source of flakiness in a fresh suite.
		clearMocks: true,
		coverage: {
			exclude: COVERAGE_EXCLUDE,
			include: ['packages/*/src/**/*.{ts,tsx}'],
			provider: 'v8',
			reporter: ['text', 'html', 'lcov', 'json'],
			reportOnFailure: true,
			reportsDirectory: 'coverage',
			thresholds: {
				branches: 100,
				functions: 100,
				lines: 100,
				statements: 100,
			},
		},
		/**
		 * Hook budget, raised for the same reason as {@link testTimeout} below.
		 *
		 * @remarks
		 * Set alongside `testTimeout` deliberately: the natural fix for a slow body-level `await` is to
		 * hoist it into `beforeAll`, and with the default 5s hook budget that move would trade one
		 * flake for an identical one a line higher up.
		 */
		hookTimeout: 30_000,
		// A filtered run that leaves a project with no matching test file must not fail.
		passWithNoTests: true,
		projects: [
			{
				extends: true,
				test: {
					environment: 'node',
					include: [buildPackageTestGlob(NODE_TEST_PACKAGES)],
					name: 'node',
				},
			},
			{
				extends: true,
				test: {
					environment: 'jsdom',
					include: [buildPackageTestGlob(BROWSER_TEST_PACKAGES)],
					name: 'jsdom',
				},
			},
			{
				// Repo-level invariants that belong to no single package — they assert relationships BETWEEN
				// packages, between a package and the toolchain, or between the docs and the code: the publish
				// surface of every package, license declarations, override bounds, links in the markdown, and
				// rule serialization through a real minifier. No package-local suite can see that class of bug,
				// because each one is a property of how the pieces fit together.
				//
				// These run under plain Node because they read the filesystem. That is precisely why they cannot live
				// inside the packages they describe: the browser-only packages carry no Node types, and widening one
				// to place a test would let any browser-only source file import `node:fs` unremarked.
				//
				// Deliberately outside `coverage.include` (which scopes to `packages/*/src`): these assert facts about
				// configuration, so there is no product code here for them to cover.
				extends: true,
				test: {
					environment: 'node',
					include: ['tests/tooling/**/*.test.ts'],
					name: 'tooling',
				},
			},
		],
		/**
		 * Per-test budget. Vitest's default is 5s; this repo needs more, for a measured reason.
		 *
		 * @remarks
		 * ### The flake this exists to kill
		 *
		 * Measured against suites in the examples repository
		 * (https://github.com/mlilli/filter-enginez-examples), which keeps the identical budget. The corpora those suites import are generated and owned by
		 * this repo's `mock-data`, so any engine suite that loads one inherits the same exposure; the
		 * floor is kept here for that reason rather than re-derived.
		 *
		 * `examples-shared`'s `about/benchmark/benchmarkWorkload.test.ts` "resolves the bundled wine
		 * corpus" times out intermittently under a full-suite run. It calls `loadWineCorpus()`, which is a DYNAMIC
		 * `import('@filter-enginez/mock-data/wine')` — and that barrel pulls
		 * `wine/data-real-default.json`, **8.6 MB**. Measured on 2026-07-27: 2144ms in isolation,
		 * 1911ms with the corpus already transformed. Against a 5s budget that is a 2.3x margin, which
		 * a 278-file parallel run competing for CPU eats without difficulty. It is not a cold-cache
		 * one-off; it is a structurally slow test with an inadequate margin.
		 *
		 * ### Why global rather than a third argument on that one test
		 *
		 * Because the exposure is structural, not local. Four suites import multi-megabyte corpora
		 * (`benchmarkWorkload`, `wineEngine`, `smartFilters`, `wineCorpusLoader`), and the wine corpora
		 * run 8.6 MB / 100 MB / 116 MB. Today only `benchmarkWorkload` is exposed, because the other
		 * three import at MODULE TOP LEVEL — that cost lands in file-import time and counts against no
		 * test's budget. The moment any of them moves a corpus load into a test body or a `beforeAll`,
		 * it inherits the identical flake. A per-test number would fix one site and leave the class open.
		 *
		 * ### Why 30s and not 6s
		 *
		 * A timeout costs wall-clock only when it FIRES. Sizing this to barely clear today's
		 * measurement would mean re-tuning it the next time a corpus grows — and `regen:mock-data:full`
		 * exists precisely to grow them. 30s clears the largest plausible corpus parse with room, and
		 * still fails a genuinely hung test in well under the time a human waits before checking.
		 *
		 * Pinned by `tests/tooling/vitestTimeouts.test.ts`, so a later tidy-up cannot quietly restore
		 * the default and reintroduce the flake.
		 */
		testTimeout: 30_000,
	},
});
