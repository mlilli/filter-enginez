/**
 * Pins `.size-limit.json`: every framework binding is budgeted, against built output, marginally.
 *
 * @remarks
 * The size budgets are this repository's answer to "what does this framework's adapter cost", and
 * `docs/architecture.md` §22.4 tabulates them. Three things make a budget meaningless without failing
 * anything, and each has a case below:
 *
 * - a binding with no entry at all — a blank where a number should be;
 * - an entry measuring `src` rather than `dist` — the packages' `exports` point at TypeScript source
 *   for workspace consumers, so measuring source measures whatever the bundler made of the types;
 * - an entry that counts a workspace sibling — `react-signals` would then report the engine as its
 *   own weight, and every budget would be unreachable by orders of magnitude.
 *
 * A fourth case holds the §22.4 table to the file, entry for entry and budget for budget, so the
 * documented figure is the enforced one.
 *
 * Read as TEXT, like the rest of this project: these are properties of a literal file humans edit.
 *
 * @packageDocumentation
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Read a repo file.
 *
 * @param relative - Path from the repo root.
 * @returns Its contents.
 */
function read(relative: string): string {
	return readFileSync(resolve(REPO_ROOT, relative), 'utf8');
}

describe('.size-limit.json', () => {
	const config = JSON.parse(read('.size-limit.json')) as {
		readonly ignore?: readonly string[];
		readonly limit?: string;
		readonly name: string;
		/** A single file, or several measured under one budget — size-limit accepts both. */
		readonly path: string | readonly string[];
	}[];

	/**
	 * Every file one entry measures.
	 *
	 * @remarks
	 * `typeof` rather than `Array.isArray`: the latter narrows a `readonly string[]` to `any[]`, which
	 * makes everything downstream `any` and trips the unsafe-argument rules for no benefit.
	 *
	 * @param path - An entry's `path`, in either form.
	 * @returns The paths as an array.
	 */
	function pathsOf(path: string | readonly string[]): readonly string[] {
		return typeof path === 'string' ? [path] : path;
	}

	it('measures every framework binding package', () => {
		// A binding missing here is a framework whose adapter cost nobody measures — and the first
		// sign of it would be a size regression that shipped.
		const measured = new Set(config.map((entry) => entry.name));

		for (const binding of [
			'react-signals',
			'react-rxjs',
			'svelte-signals',
			'vue-signals',
			'angular-rxjs',
		]) {
			expect(measured, `${binding} is unmeasured`).toContain(binding);
		}
	});

	it('gives every entry a limit and a built path', () => {
		for (const entry of config) {
			expect(entry.limit, `${entry.name} has no limit`).toMatch(/kB$/u);

			// `path` may be a string or an array — size-limit accepts several files under one budget.
			// Every element still has to point at built output.
			for (const path of pathsOf(entry.path)) {
				// `dist`, not `src`: the packages' `exports` maps point at TypeScript source for workspace
				// consumers, so measuring `src` would measure whatever esbuild made of the types.
				expect(path, `${entry.name} should measure built output`).toMatch(/^packages\/[^/]+\/dist\//u);
			}
		}
	});

	it('marks its own workspace siblings as ignored, so each number is MARGINAL', () => {
		// The convention the whole table rests on: every row is "what this package adds", with the
		// engine and the framework external. Without it `react-signals` would measure React, the
		// budgets in `docs/architecture.md` would be unreachable by two orders of magnitude, and the
		// numbers would answer a question nobody asked.
		//
		// **Derived from each package's real manifest, not from a hardcoded name.** Requiring
		// `@filter-enginez/core` of every non-`core` entry would encode an assumption that holds only
		// while every measured package depends on the engine — `core` itself does not, and neither does
		// a pure asset package. Reading the manifest checks the actual rule ("no workspace
		// sibling is counted twice") and keeps checking it as the graph changes.
		for (const entry of config) {
			const [firstPath] = pathsOf(entry.path);
			const packageDir = /^packages\/([^/]+)\//u.exec(firstPath ?? '')?.[1];

			expect(packageDir, `${entry.name} has an unparseable path`).toBeDefined();

			const manifest = JSON.parse(read(`packages/${packageDir ?? ''}/package.json`)) as {
				dependencies?: Record<string, string>;
				peerDependencies?: Record<string, string>;
			};
			const siblings = [
				...Object.keys(manifest.dependencies ?? {}),
				...Object.keys(manifest.peerDependencies ?? {}),
			].filter((name) => name.startsWith('@filter-enginez/'));

			for (const sibling of siblings) {
				expect(entry.ignore ?? [], `${entry.name} should ignore ${sibling}`).toContain(sibling);
			}
		}
	});

	it('is tabulated in docs/architecture.md §22.4 with the same budgets', () => {
		const architecture = read('docs/architecture.md');
		const start = architecture.indexOf('### §22.4.');
		const section = architecture.slice(start, architecture.indexOf('\n## ', start));
		// A row reads `| \`name\` (optional note) | 3.5 kB |`.
		const documented = new Map(
			[...section.matchAll(/^\| `(?<name>[^`]+)`[^|]*\| (?<limit>[\d.]+ kB) +\|$/gmu)].map(
				(match) => [match.groups?.['name'] ?? '', match.groups?.['limit'] ?? ''],
			),
		);
		const configured = new Map(config.map((entry) => [entry.name, entry.limit ?? '']));

		// Vacuity: a moved heading or a reformatted table would otherwise compare two empty maps.
		expect(start, 'the §22.4 heading').toBeGreaterThan(-1);
		expect(documented.size, 'budget rows parsed from §22.4').toBeGreaterThan(10);
		expect(documented, '§22.4 disagrees with .size-limit.json — update the table with the budget').toStrictEqual(
			configured,
		);
	});
});
