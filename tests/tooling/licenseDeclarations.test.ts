/**
 * Every package declares the same license, and `LICENSE.md` is the text it names.
 *
 * @remarks
 * ## Why one string per manifest needs pinning
 *
 * Data duplicated on purpose has to be enforced, because the copies are edited by different hands at
 * different times and nothing compares them. A new package is scaffolded from a sibling, and whichever
 * sibling it was copied from is the license it inherits — silently, and correctly right up until the
 * project's license changes.
 *
 * The project is **Apache-2.0 only**. A package scaffolded from a stale template is exactly the drift
 * this file exists to catch, and it is the kind that reaches npm before anyone notices — the SPDX
 * string is what registries and corporate license scanners read, so a wrong one is a wrong answer to a
 * question asked by machines.
 *
 * ## Why it also asserts the license TEXT
 *
 * A declaration pointing at a file is only as good as the file. `LICENSE.md` holds the verbatim Apache
 * License 2.0, and two things make that fragile in this specific repo:
 *
 * 🔴 **It must stay out of every formatter's reach.** Unless `.prettierignore` and
 * `.markdownlint-cli2.yaml` both name `LICENSE.md`, Prettier or `markdownlint --fix` reflows a legal
 * instrument on the next commit that stages it. A case below asserts both entries, because somebody
 * removing them while tidying is a likelier mistake than a deliberate edit to the text.
 *
 * ⚠ **A verbatim legal text is the one file in the repo where "improving" it is a defect.** Asserting
 * its structural landmarks is cheap and makes any edit loud.
 *
 * ## Why landmarks rather than a hash
 *
 * A SHA would be stricter and would be the wrong tool: it fails on a trailing-newline change with a
 * message naming no cause, so it would get relaxed, and the relaxed version is what lets a real edit
 * through. The assertions below name the sections an Apache-2.0 text must contain, which fail with a
 * message a reader can act on.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The one SPDX expression every package in this repo declares. */
const EXPECTED_SPDX = 'Apache-2.0';

/**
 * Structural landmarks of the Apache License 2.0.
 *
 * @remarks
 * Section headings and the clauses most likely to be lost to a reflow — §4's NOTICE obligation and §6's
 * trademark reservation are the two this project leans on by name elsewhere (`NOTICE.md` cites §4(d);
 * the trademark terms cite §6).
 */
const APACHE_LANDMARKS = [
	'Apache License',
	'Version 2.0, January 2004',
	'TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION',
	'1. Definitions.',
	'4. Redistribution.',
	'6. Trademarks.',
	'7. Disclaimer of Warranty.',
	'APPENDIX: How to apply the Apache License to your work.',
] as const;

/**
 * The `packages:` globs from `pnpm-workspace.yaml`, verbatim.
 *
 * @remarks
 * Read by scoping to the block rather than by parsing the YAML, as `overrideUpperBounds` does: the
 * file is mostly prose, and the block is the only place the workspace's membership is declared.
 *
 * @returns Each entry, quotes stripped — `packages/*`, and any literal directory beside it.
 */
function workspaceGlobs(): readonly string[] {
	const source = readFileSync(resolve(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8');
	const block = /^packages:\n(?<body>(?:[ \t]+-.*\n?)+)/mu.exec(source)?.groups?.['body'] ?? '';

	return block
		.split('\n')
		.map((line) => /^\s+-\s+["']?(?<glob>[^"'\s]+)["']?\s*$/u.exec(line)?.groups?.['glob'])
		.filter((glob): glob is string => glob !== undefined);
}

/**
 * The manifests one workspace glob names.
 *
 * @remarks
 * Two shapes occur, and only two: a trailing `/*` (every directory one level down that holds a
 * `package.json`) and a literal directory. Anything else fails the vacuity case below rather than
 * being guessed at — a glob this function cannot expand is a membership it cannot vouch for.
 *
 * @param glob - One entry of the `packages:` list.
 * @returns Repo-relative `package.json` paths.
 */
function manifestsFor(glob: string): readonly string[] {
	if (glob.endsWith('/*')) {
		const parent = glob.slice(0, -'/*'.length);

		return readdirSync(resolve(REPO_ROOT, parent), { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && existsSync(resolve(REPO_ROOT, parent, entry.name, 'package.json')))
			.map((entry) => `${parent}/${entry.name}/package.json`);
	}

	return /[*?{[]/u.test(glob) || !existsSync(resolve(REPO_ROOT, glob, 'package.json')) ? [] : [`${glob}/package.json`];
}

/**
 * Every `package.json` in the workspace — the root plus every member — as repo-relative paths.
 *
 * @remarks
 * Derived from the workspace declaration rather than listed or counted, so a new package is covered
 * the day it is scaffolded and a removed one stops being expected. A hand-written list, or a minimum
 * count, would have to be updated by the very commit that changes the thing it is supposed to check.
 *
 * @returns Sorted manifest paths.
 */
function workspaceManifests(): readonly string[] {
	return ['package.json', ...workspaceGlobs().flatMap((glob) => manifestsFor(glob))].sort();
}

describe('license declarations', () => {
	it('covers every workspace manifest, so the rule below has subjects', () => {
		// The vacuity guard. A parse that found no globs, or a glob that expanded to nothing, would make
		// the case below pass over a short list, which is indistinguishable from a repo where every
		// manifest agrees. So each declared glob must contribute at least one manifest of its own.
		const globs = workspaceGlobs();

		expect(globs.length, 'no `packages:` globs parsed out of pnpm-workspace.yaml — has the block moved?').toBeGreaterThan(
			0,
		);
		for (const glob of globs) {
			expect(manifestsFor(glob).length, `workspace glob '${glob}' names no package.json`).toBeGreaterThan(0);
		}
		expect(workspaceManifests()).toContain('package.json');
	});

	it('is Apache-2.0 in every workspace manifest', () => {
		const offenders = workspaceManifests()
			.map((path) => ({
				license: (JSON.parse(readFileSync(resolve(REPO_ROOT, path), 'utf8')) as { license?: string }).license,
				path,
			}))
			.filter((entry) => entry.license !== EXPECTED_SPDX);

		expect(
			offenders,
			`every package declares "license": "${EXPECTED_SPDX}", the license LICENSE.md and NOTICE.md grant`,
		).toEqual([]);
	});

	it('is the license LICENSE.md actually contains', () => {
		// A declaration pointing at a file is only as good as the file, and this one is a verbatim legal
		// text that any formatter would happily reflow.
		const text = readFileSync(resolve(REPO_ROOT, 'LICENSE.md'), 'utf8');
		const missing = APACHE_LANDMARKS.filter((landmark) => !text.includes(landmark));

		expect(missing, 'LICENSE.md is not the verbatim Apache-2.0 text — has something reformatted it?').toEqual([]);
	});

	it('ships no per-license texts beside LICENSE.md', () => {
		// A stray per-license file would mean a public repo containing an MIT text nothing grants.
		// Asserted because a file can come back — a revert, a merge, or somebody restoring what looks
		// like an accidental deletion.
		const stale = ['LICENSE-MIT.md', 'LICENSE-APACHE.md'].filter((name) =>
			readdirSync(REPO_ROOT).includes(name),
		);

		expect(stale, 'LICENSE.md is the only license text, and nothing grants these').toEqual([]);
	});

	it('protects LICENSE.md from both formatters', () => {
		// 🔴 A reformatted license is a legal problem reached by a routine `--fix`, so both ignore lists
		// must name the file by its exact name.
		const prettierIgnore = readFileSync(resolve(REPO_ROOT, '.prettierignore'), 'utf8');
		const markdownIgnore = readFileSync(resolve(REPO_ROOT, '.markdownlint-cli2.yaml'), 'utf8');

		expect(prettierIgnore, '.prettierignore must list LICENSE.md').toMatch(/^LICENSE\.md$/mu);
		expect(markdownIgnore, '.markdownlint-cli2.yaml must ignore LICENSE.md').toContain('"LICENSE.md"');
	});
});
