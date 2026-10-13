/**
 * Every `coverage.exclude` glob still matches something on disk.
 *
 * @remarks
 * Most of this repository's list names individual modules — the `worker-bridge` type-only files and
 * the `mock-data` generators and loaders — and nothing else asserts that those paths still exist.
 *
 * A stale exclusion is silent in the direction that matters. It never fails; it simply stops
 * excluding the thing it was written for, and the next module to land on that path is excluded by
 * accident — measured at nothing, reported as covered, with a line in a config file as the only
 * evidence anybody ever intended otherwise.
 *
 * ### Why a real glob engine and not a prefix check
 *
 * The obvious cheap version takes each glob's leading non-wildcard segment and asserts the directory
 * exists. It is not sufficient, for the reason that applies to every stand-in measurement: **a proxy
 * for coverage is not coverage.** A prefix check cannot see whether a glob with a wildcard
 * TAIL matches anything, and that is exactly where staleness hides. The nearest example is live:
 * `**\/mock-data/src/*\/generate-data.ts` matches exactly ONE file where its three siblings match
 * three each, so it is one rename away from matching nothing while its static prefix stays perfectly
 * valid.
 *
 * `node:fs`'s `globSync` is the right instrument: a real engine, zero new dependencies (so no
 * `pnpm install` is needed to run this guard) — and it handles `**`, `*`,
 * `[A-Z]` classes and `{ts,tsx}` braces, all four of which this list uses.
 */

import { globSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { allExcludedGlobs, excludedGlobsFor, REPO_ROOT } from './support/coverageExclusions.js';

/**
 * Trees the walk deliberately does not enter.
 *
 * @remarks
 * `node_modules` for speed — it is 45 full-tree walks otherwise — and the rest because they are
 * generated. A guard whose verdict depends on whether somebody has run a build lately is a guard
 * that gets disabled the first time it is wrong.
 */
const SKIPPED_TREES = /(?:^|\/)(?:\.angular|\.git|\.svelte-kit|\.turbo|coverage|dist|node_modules)(?:\/|$)/u;

/**
 * Entries exempt from the "matches something" rule, and the reason each is.
 *
 * @remarks
 * Both name a tree {@link SKIPPED_TREES} refuses to enter, so asserting on them would be asserting
 * on the walk's own configuration. They are also the only two entries in the list that name
 * generated or vendored output rather than product source — on a fresh clone with no build run,
 * neither exists at all.
 *
 * Kept as an explicit roster rather than derived from {@link SKIPPED_TREES}, so that an entry
 * quietly renamed into exemption fails the case below instead of inheriting it.
 */
const STRUCTURAL_ENTRIES = ['**/dist/**', 'node_modules/**'] as const;

/**
 * How many files a glob matches under the repo root.
 *
 * @param glob - The glob, as written in the list.
 * @returns The match count.
 */
function matchCount(glob: string): number {
	return globSync(glob, { cwd: REPO_ROOT, exclude: (path) => SKIPPED_TREES.test(path) }).length;
}

/** A fixture in the shape of the real file, including the two shapes that fool a naive parser. */
const PARSER_FIXTURE = [
	'/**',
	" * The package's exclusion list. Note the config's own apostrophes, which are prose.",
	' */',
	'export const COVERAGE_EXCLUDE: readonly string[] = [',
	"\t'**/real/one.ts',",
	"\t// '**/commented/out.ts',",
	"\t'**/real/two.ts',",
	'];',
].join('\n');

describe('the coverage-exclusion list', () => {
	it('parses array entries only — not prose, not commented-out globs', () => {
		// 🔴 The negative control. A generic `'([^']+)'` over the real file matches `package's` and
		// `config's` in the docblocks and reports sentence fragments as entries. Asserted here against
		// the same two shapes rather than trusted to the anchoring being obviously correct.
		const parsed = PARSER_FIXTURE.split('\n').flatMap((line) => {
			const matched = /^\s*'([^']+)',\s*$/u.exec(line);

			return matched?.[1] === undefined ? [] : [matched[1]];
		});

		expect(parsed).toEqual(['**/real/one.ts', '**/real/two.ts']);
	});

	it('is read consistently by both readers', () => {
		// The vacuity guard, and deliberately NOT a count — a number in a test is a number somebody has
		// to keep true, and this list is edited every time a module changes hands. Tying the whole-list
		// reader to the per-package one instead means a parser that silently starts returning nothing
		// fails here, and the assertion stays honest as the list grows. `mock-data` is the package with
		// the most entries of its own, so it is the one least likely to empty out for a good reason.
		const all = allExcludedGlobs();
		const mockData = excludedGlobsFor('mock-data');

		expect(mockData.length, 'the per-package reader must still find entries').toBeGreaterThan(0);
		for (const stripped of mockData) {
			expect(all, `${stripped} is missing from the whole-list read`).toContain(`**/${stripped}`);
		}
	});

	it('has every entry matching at least one real path', () => {
		// THE guard. An entry matching nothing has stopped excluding whatever it was written for, and
		// the next module to land on that path is excluded by accident.
		const stale = allExcludedGlobs()
			.filter((glob) => !STRUCTURAL_ENTRIES.some((exempt) => exempt === glob))
			.filter((glob) => matchCount(glob) === 0);

		expect(
			stale,
			'coverage exclusions matching nothing — delete them, or fix the path they were meant to name',
		).toEqual([]);
	});

	it('reports a knowingly absent path as matching nothing', () => {
		// The other half of the control above: the guard asserts an empty list, and an empty list is
		// also what a glob engine that silently fails produces. This shows it can say no.
		expect(matchCount('**/mock-data/src/no-such-directory/never.ts')).toBe(0);
		expect(matchCount('**/mock-data/src/wine/corpusLoaders.ts')).toBe(1);
	});

	it('still names each structurally exempt entry', () => {
		// An exemption that outlives the entry it exempts is a hole. If `**\/dist\/**` is ever renamed,
		// this fails rather than letting the roster quietly cover nothing.
		for (const exempt of STRUCTURAL_ENTRIES) {
			expect(allExcludedGlobs(), `${exempt} is exempt but no longer in the list`).toContain(exempt);
		}
	});

	it('has no duplicate entries anywhere in the list', () => {
		// A duplicate spanning two packages' blocks is the likely kind, since the blocks are edited
		// months apart by different changes.
		const all = allExcludedGlobs();
		const duplicates = all.filter((glob, index) => all.indexOf(glob) !== index);

		expect(duplicates, 'the same glob listed twice').toEqual([]);
	});
});
