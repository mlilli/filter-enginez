/**
 * Read entries out of the `coverage.exclude` list in `vitest.coverage.config.ts`.
 *
 * @remarks
 * ### Why this is a module rather than inline in its one guard
 *
 * `coverageExclusionsResolve.test.ts` reads the list two ways — the entries naming one package, and
 * the whole list — and the extraction carries a non-obvious workaround rather than just lines (see
 * {@link excludedGlobsFor}), and a workaround belongs in one place. The examples repository carries
 * the same reader for its own per-package guards.
 *
 * ⚠ A non-spec module under `tests/tooling/` is safe there: the tooling vitest project includes only
 * `tests/tooling/**\/*.test.ts`, so it is not collected as a suite, while `tests/tooling/tsconfig.json`
 * includes `**\/*.ts`, so it is still typechecked and typed-linted.
 *
 * @packageDocumentation
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root, resolved from this module's own location. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * The file holding the literal `coverage.exclude` list.
 *
 * @remarks
 * The list lives in its own module rather than inline in `vitest.config.ts`, which keeps that file
 * under the 500-line `max-lines` cap. Named as a constant rather than inlined at the two read
 * sites because a rename must change exactly one thing — and because a guard reading the WRONG file
 * finds no globs, asserts over an empty list, and passes having compared nothing. That is the same
 * vacuity failure the guards themselves are written to avoid, one level up.
 */
export const EXCLUSION_LIST_FILE = 'vitest.coverage.config.ts';

/**
 * Every `coverage.exclude` entry naming the given package, in the order they appear.
 *
 * @remarks
 * Read as TEXT rather than by importing the config, matching `vitestTimeouts.test.ts`. Importing it
 * would drag Vitest's own config machinery into a filesystem test, and the thing being asserted is
 * a property of the literal list a human edits.
 *
 * 🔴 **Comment lines are dropped first, and that is not tidiness.** A block in that list that narrows
 * a blanket exclusion quotes the glob it replaced, to explain what changed. A matcher run over the
 * raw file picks those quotations up and fails every assertion against a correct config.
 *
 * @param packageDirectory - Unscoped package directory name, e.g. `mock-data`.
 * @returns The matching globs with their `**\/` prefix stripped, in file order.
 */
export function excludedGlobsFor(packageDirectory: string): readonly string[] {
	const source = readFileSync(resolve(REPO_ROOT, EXCLUSION_LIST_FILE), 'utf8');
	const code = source
		.split('\n')
		.filter((line) => !line.trim().startsWith('//'))
		.join('\n');
	const pattern = new RegExp(String.raw`'\*\*\/(${packageDirectory}\/[^']+)'`, 'gu');

	// `flatMap` over an explicit undefined check rather than `.map(([, path]) => path)`: under
	// `noUncheckedIndexedAccess` a capture group is `string | undefined`, and a non-null assertion is
	// a lint error here.
	return [...code.matchAll(pattern)].flatMap(([, path]) => (path === undefined ? [] : [path]));
}

/**
 * An array-element line: indentation, one single-quoted glob, a comma, nothing else.
 *
 * @remarks
 * 🔴 **Anchored on the whole LINE rather than on a quoted substring, and that is the load-bearing
 * detail.** A generic `'([^']+)'` over this file matches apostrophes in the surrounding prose —
 * `package's`, `config's` — and reports sentence fragments as exclusion entries.
 * {@link excludedGlobsFor} escapes it by requiring a `**\/` prefix; this one cannot, because the
 * whole point is to see entries that have no such prefix.
 *
 * Requiring the quote to follow only whitespace also rejects a commented-out glob, since those lines
 * begin `//`.
 */
const ARRAY_ELEMENT_LINE = /^\s*'([^']+)',\s*$/u;

/**
 * Every `coverage.exclude` entry, verbatim and unstripped, in the order they appear.
 *
 * @remarks
 * The whole-list companion to {@link excludedGlobsFor}, which answers a different question: that one
 * asks what a given package excludes, this one asks whether the list as a whole still describes the
 * tree. A per-package check sees only the package it names; a stale entry for any other package is
 * invisible to it.
 *
 * ⚠ **Returns the glob AS WRITTEN**, including any `**\/` prefix, because the caller feeds it to a
 * glob engine. `excludedGlobsFor` strips the prefix because its callers compare against tree paths.
 * The two are not interchangeable and the difference is the whole reason both exist.
 *
 * @returns The globs, in file order.
 */
export function allExcludedGlobs(): readonly string[] {
	return readFileSync(resolve(REPO_ROOT, EXCLUSION_LIST_FILE), 'utf8')
		.split('\n')
		.flatMap((line) => {
			const matched = ARRAY_ELEMENT_LINE.exec(line);

			return matched?.[1] === undefined ? [] : [matched[1]];
		});
}
