/**
 * No file a published package ships names a non-permissive license.
 *
 * @remarks
 * ## Why this exists
 *
 * Every `@filter-enginez/*` package is Apache-2.0 and bundles no third-party code. A supply-chain license scanner,
 * though, reads the TEXT of a tarball, and a package whose `NOTICE.md`, README or compiled comments name a
 * non-permissive license reads to it as a package that carries one — even when the sentence says the opposite
 * ("that dataset is CC BY-NC-SA 4.0, and none of it is distributed"). The repository does have such a sentence to
 * write: `mock-data` can import a real third-party wine corpus for local development, and its license is not
 * permissive. The root `NOTICE.md` says so in a part marked repository-only, which `scripts/sync-licenses.mjs`
 * leaves out of the package copies; this guard holds every shipped file to the same rule.
 *
 * ## What it reads
 *
 * For each package: `package.json`, `README.md`, and the `LICENSE.md` and `NOTICE.md` copies as
 * `scripts/lib/license-copies.mjs` produces them (the copies themselves are gitignored and absent from a fresh
 * clone). In place of `dist`, which does not exist when the tests run on a fresh clone, it reads the non-test
 * source the build compiles: the build keeps comments, so a comment in `dist` is a comment in `src`.
 *
 * ## Vacuity
 *
 * Every pattern is checked against a sample that must match and, for GPL, one that must not (`LGPL`). The root
 * `NOTICE.md` must still trip the CC pattern, so a pattern that silently stopped matching the one sentence this
 * guard exists for would fail here rather than pass everything. And the walk must find the packages and their files.
 *
 * @packageDocumentation
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { nonTestSourceFiles } from './support/packageSources.js';
import { REPO_ROOT } from './support/repoFiles.js';

/** A non-permissive license name, as it may be written. */
interface LicenseTerm {
	/** What it names, for the failure message. */
	readonly label: string;
	/** How it is written, case-insensitive, at word boundaries. */
	readonly pattern: RegExp;
	/** A string the pattern must match, so the pattern is known to work. */
	readonly sample: string;
}

/** The license names no packed file may carry. */
const NON_PERMISSIVE_TERMS: readonly LicenseTerm[] = [
	{ label: 'Creative Commons NonCommercial', pattern: /\bCC[\s-]?BY[\s-]NC/iu, sample: 'licensed CC BY-NC-SA 4.0' },
	{ label: 'Creative Commons NonCommercial', pattern: /\bnon-?commercial\b/iu, sample: 'NonCommercial-ShareAlike' },
	// `\b` before GPL keeps LGPL out: its `L` is a word character, so there is no boundary before the `G`.
	{ label: 'GNU GPL / AGPL', pattern: /\bA?GPL(?:v\d|\b)/iu, sample: 'AGPL-3.0-only' },
	{ label: 'Server Side Public License', pattern: /\bSSPL\b|\bserver side public license\b/iu, sample: 'SSPL-1.0' },
	{ label: 'Business Source License', pattern: /\bBUSL\b|\bbusiness source license\b/iu, sample: 'BUSL-1.1' },
	{ label: 'Commons Clause', pattern: /\bcommons clause\b/iu, sample: 'with the Commons Clause' },
];

/** The copies `sync-licenses.mjs` writes into each package. */
const LICENSE_FILES = ['LICENSE.md', 'NOTICE.md'] as const;

/** `scripts/lib/license-copies.mjs`, the transformation the release applies to each root license file. */
const { packageCopyOf } = (await import(pathToFileURL(resolve(REPO_ROOT, 'scripts/lib/license-copies.mjs')).href)) as {
	readonly packageCopyOf: (body: string, name: string) => string;
};

/** One file a package ships, as the guard reads it. */
interface PackedFile {
	/** Where it comes from, relative to the repo root, for the failure message. */
	readonly label: string;
	/** Its text. */
	readonly text: string;
}

/**
 * The text of every file one package ships.
 *
 * @param directory - The package directory, absolute.
 * @returns Its packed files, with `dist` represented by the source it is compiled from.
 */
function packedFiles(directory: string): readonly PackedFile[] {
	const at = (path: string): string => relative(REPO_ROOT, path);
	const ownFiles = ['package.json', 'README.md']
		.map((name) => join(directory, name))
		.filter((path) => existsSync(path))
		.map((path) => ({ label: at(path), text: readFileSync(path, 'utf8') }));
	const copies = LICENSE_FILES.map((name) => ({
		label: `${at(directory)}/${name} (the copy of the root ${name})`,
		text: packageCopyOf(readFileSync(resolve(REPO_ROOT, name), 'utf8'), name),
	}));
	const sources = nonTestSourceFiles(join(directory, 'src'))
		.map((path) => ({ label: `${at(path)} (compiled into dist)`, text: readFileSync(path, 'utf8') }));

	return [...ownFiles, ...copies, ...sources];
}

/**
 * Every non-permissive license name in a text.
 *
 * @param text - The text.
 * @returns `line N: "match" (label)` for each hit.
 */
function findTerms(text: string): readonly string[] {
	return text.split('\n').flatMap((line, index) =>
		NON_PERMISSIVE_TERMS.flatMap(({ label, pattern }) => {
			const match = pattern.exec(line);

			return match === null ? [] : [`line ${String(index + 1)}: "${match[0]}" (${label})`];
		}),
	);
}

/** Each publishable package directory. */
const PACKAGES = readdirSync(resolve(REPO_ROOT, 'packages'), { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => resolve(REPO_ROOT, 'packages', entry.name))
	.filter((directory) => (JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { private?: boolean }).private !== true);

describe('license names in packed files', () => {
	it.each(NON_PERMISSIVE_TERMS.map((term) => [term.sample, term] as const))('a pattern matches "%s"', (_sample, term) => {
		expect(term.pattern.test(term.sample)).toBe(true);
	});

	it('does not read LGPL as GPL', () => {
		expect(findTerms('LGPL-2.1-or-later, and TextBypassPlan')).toStrictEqual([]);
	});

	it('flags the root NOTICE, whose repository-only part names the wine dataset\'s license', () => {
		// The positive control: the one sentence this guard exists for is still caught where it legitimately lives.
		expect(findTerms(readFileSync(resolve(REPO_ROOT, 'NOTICE.md'), 'utf8'))).not.toStrictEqual([]);
	});

	it('finds the packages and their files', () => {
		expect(PACKAGES.length, 'publishable packages').toBeGreaterThanOrEqual(13);
		expect(PACKAGES.flatMap(packedFiles).length, 'files read across the packages').toBeGreaterThan(250);
	});

	it.each(PACKAGES.map((directory) => [relative(REPO_ROOT, directory), directory] as const))('%s ships none', (_label, directory) => {
		const findings = packedFiles(directory).flatMap((file) => findTerms(file.text).map((hit) => `${file.label} ${hit}`));

		expect(
			findings,
			'These files ship in the package and name a non-permissive license, which a license scanner reads as the '
			+ 'package carrying it. Reword them without the name (say what the terms mean for this project), or, in a '
			+ 'root license file, wrap the part in <!-- repository-only:start --> … <!-- repository-only:end -->.',
		).toStrictEqual([]);
	});
});
