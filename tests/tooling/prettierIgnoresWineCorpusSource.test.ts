/**
 * Prettier must never be handed the wine corpus **where it lives** — `packages/mock-data`.
 *
 * @remarks
 * The corpus needs two ignore rules, one in each repository:
 *
 * - **this file** — the corpus at its SOURCE, `packages/mock-data/src/**\/*.json`. `mock-data` is an
 *   engine package, so this rule and its guard live here.
 * - **`prettierIgnoresWineCorpusLinks.test.ts`** in the examples repository — the corpus where
 *   `pnpm link:wine-corpus` puts it, under each vertical's `public/` or `static/`. Those are example
 *   apps, so that rule and its guard live there.
 *
 * 🔴 **Neither rule implies the other.** `packages/mock-data` is not under any `public/` or `static/`
 * directory, so the `**\/`-rooted link globs do not reach it; and the source rule does not reach a
 * hard link in an app's static directory. Deleting either one re-opens the same crash from a different
 * direction. The two repositories cannot see each other, so each guard states the dependency in prose
 * — strictly weaker than an assertion, and the honest cost of two repositories.
 *
 * ## The failure both rules prevent
 *
 * `prettier --write .` over a tree holding the corpus loads a 116 MB `data-real-full.json` into the
 * V8 heap and dies with SIGABRT — reported as `Abort trap: 6`, with no filename anywhere in the
 * output, so the failing `lint:fix` task gives no hint of the cause.
 *
 * ## Why a config assertion rather than a run
 *
 * Proving Prettier skips the file by running it needs the corpus present — it is gitignored, so the
 * check would silently pass on any machine without it, which is the exact shape of a guard that stops
 * guarding. Asserting the ignore rule is true everywhere.
 *
 * ⚠ The `.prettierignore` parser is duplicated between the two guards deliberately. It is five lines,
 * and the two guards live in different repositories, which cannot share a `support/` module. The DRY
 * three-strikes rule is about code that lives together.
 *
 * @packageDocumentation
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The ignore rule covering the corpus at its source. */
const SOURCE_PATTERN = 'packages/mock-data/src/**/*.json';

describe('.prettierignore covers the wine corpus at its source', () => {
	const patterns = readFileSync(resolve(REPO_ROOT, '.prettierignore'), 'utf8')
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith('#'));

	it('parses some patterns at all, so the cases below have subjects', () => {
		// The vacuity guard. A parser that returned nothing — a renamed ignore file, a comment syntax
		// change — makes every `toContain` below fail loudly rather than pass, but the count is still
		// worth asserting: it distinguishes "the rule is missing" from "the file is unreadable".
		expect(patterns.length, '.prettierignore parsed to zero patterns — has it moved?').toBeGreaterThan(5);
	});

	it('ignores the generated datasets where mock-data keeps them', () => {
		// Matched as a whole pattern rather than by substring, so a narrower entry cannot satisfy it.
		expect(patterns).toContain(SOURCE_PATTERN);
	});

	it('does NOT rely on the linked-copy globs to cover the source', () => {
		// The property the two-repository layout threatens. `packages/mock-data` sits under neither
		// `public/` nor `static/`, so if someone deletes the source rule believing the `**/`-rooted link
		// globs cover it, nothing else in THIS repo would notice — the guard that knows about those
		// globs lives in the examples repo.
		const linkGlobs = patterns.filter((pattern) => pattern.includes('data-real-full'));

		expect(
			linkGlobs.some((pattern) => pattern.includes('mock-data')),
			'the linked-copy globs do not cover the source tree — both rules are required',
		).toBe(false);
	});
});
