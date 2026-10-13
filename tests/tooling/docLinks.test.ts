/**
 * Every relative link in the repo's markdown resolves to something that exists.
 *
 * @remarks
 * A link rots when its target moves and leaves its references behind, and the documents with the
 * most links are the ones a new contributor is told to read first.
 *
 * That is a specific and recurring failure rather than a generic tidiness concern. The documents point
 * at each other, and a dead pointer degrades exactly the way a stale doc does: silently, and in the
 * direction of somebody re-deriving from scratch what was already written down.
 *
 * 🔴 **The engine and the examples are two repositories**, so a relative link from one into the other
 * resolves in neither. A link into the sibling repository is written as its GitHub URL, which this
 * guard deliberately does not follow (below).
 *
 * ### What it deliberately does not check
 *
 * **Anchors.** `./README.md#license` is asserted to the file, not to the heading. Heading anchors
 * need a slug algorithm matching the renderer's, and getting that subtly wrong produces false
 * failures on correct links — which is worse than the gap, because a guard that cries wolf gets
 * exempted rather than fixed.
 *
 * **External URLs.** Not a filesystem question, and a network call in a unit suite is a flake.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Directories with no authored markdown in them.
 *
 * @remarks
 * `node_modules` is the one that matters — thousands of READMEs whose links are somebody else's
 * problem. The rest are build output, and asserting on generated files means asserting on whichever
 * command last ran.
 */
const SKIP_DIRECTORIES = new Set([
	'.angular',
	'.git',
	'.svelte-kit',
	'.turbo',
	'coverage',
	'dist',
	'node_modules',
]);

/**
 * A markdown link with a relative target.
 *
 * @remarks
 * Matches `](./x)` and `](../x)` only — a leading `.` is what distinguishes a repo path from an
 * external URL or a root-relative site path, without having to enumerate schemes. The target stops
 * at `#` so an anchor is excluded from the path, and at whitespace so a following title is too.
 */
const RELATIVE_LINK_PATTERN = /\]\((\.\.?\/[^)\s#]+)(?:#[^)]*)?\)/gu;

/** One link that points at nothing. */
interface DeadLink {
	/** The link target, as written. */
	readonly target: string;
	/** Repo-relative path of the file holding it. */
	readonly source: string;
}

/**
 * Every markdown file in the repo, recursively.
 *
 * @param dir - Absolute directory to walk.
 * @returns Absolute paths.
 */
function markdownFiles(dir: string): string[] {
	let found: string[] = [];

	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (SKIP_DIRECTORIES.has(entry.name)) {
			continue;
		}

		const path = join(dir, entry.name);

		if (entry.isDirectory()) {
			// A workspace self-link (pnpm writes `packages/<name>/<name>` for some packages) can be a
			// symlink some mounted checkouts cannot stat. A walk that dies on one unreadable directory
			// reports zero dead links for the whole repo, which is the shape of false pass this file
			// exists to prevent.
			try {
				found = found.concat(markdownFiles(path));
			} catch {
				continue;
			}
		} else if (entry.name.endsWith('.md')) {
			found.push(path);
		}
	}

	return found;
}

/**
 * The relative link targets in a markdown source.
 *
 * @remarks
 * Takes a STRING rather than a path so the negative control below can put a knowingly-broken
 * document through the identical extractor. A checker that has only ever run over correct input has
 * not been shown to work.
 *
 * @param source - File contents.
 * @returns Targets, in document order, with any anchor stripped.
 */
function relativeLinkTargets(source: string): readonly string[] {
	return [...source.matchAll(RELATIVE_LINK_PATTERN)].flatMap((match) =>
		match[1] === undefined ? [] : [match[1]],
	);
}

/**
 * Does a relative link from `file` resolve to something inside this repository?
 *
 * @remarks
 * 🔴 **Inside, not merely somewhere.** The engine and examples repositories are checked out side by
 * side, so `../../filter-enginez/docs/architecture.md` from the examples' `docs/` resolves on a
 * contributor's machine — and nowhere else: not on GitHub, not in a clone of one repository, not in
 * CI's checkout of the other. A link that climbs out of the repo root is dead everywhere it is read,
 * so it is reported as dead here too. Cross-repository links are written as GitHub URLs.
 *
 * @param file - Absolute path of the markdown file holding the link.
 * @param target - The link target, as written.
 * @returns `true` when the target exists and lies within the repo root.
 */
function resolvesInsideRepo(file: string, target: string): boolean {
	const absolute = resolve(dirname(file), target);
	const fromRoot = relative(REPO_ROOT, absolute);

	const isOutsideRoot = fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot);

	return !isOutsideRoot && existsSync(absolute);
}

/**
 * Every relative link in the repo that resolves to nothing, or to something outside it.
 *
 * @returns The offenders, with the file that holds each.
 */
function deadLinks(): readonly DeadLink[] {
	return markdownFiles(REPO_ROOT).flatMap((file) =>
		relativeLinkTargets(readFileSync(file, 'utf8'))
			.filter((target) => !resolvesInsideRepo(file, target))
			.map((target) => ({ source: relative(REPO_ROOT, file), target })),
	);
}

describe('markdown links', () => {
	it('reports a dead target and passes a live one', () => {
		// 🔴 The negative control, first in the file. Everything below is an assertion that a list is
		// empty, and an empty list is what a broken extractor produces too.
		const fixture = [
			'See [the readme](./README.md) and [the void](./no-such-file-anywhere.md).',
			'Also [an external one](https://example.com/x.md) and [an anchor](./README.md#license).',
		].join('\n');
		const targets = relativeLinkTargets(fixture);

		expect(targets, 'external URLs are not relative links').toEqual([
			'./README.md',
			'./no-such-file-anywhere.md',
			'./README.md',
		]);
		const fromRoot = resolve(REPO_ROOT, 'README.md');

		expect(resolvesInsideRepo(fromRoot, './README.md'), 'the live target').toBe(true);
		expect(resolvesInsideRepo(fromRoot, './no-such-file-anywhere.md'), 'the dead target').toBe(false);
		// The repo root's own parent exists on every machine, which is what makes it the right control
		// for "exists, but outside the repository".
		expect(resolvesInsideRepo(fromRoot, '../'), 'a target outside the repository').toBe(false);
	});

	it('has no dead relative links anywhere in the repo', () => {
		const offenders = deadLinks().map(({ source, target }) => `${source} -> ${target}`);

		expect(
			offenders,
			'a markdown link pointing at nothing, or out of the repository — fix the path, or link the '
			+ "sibling repository's file by its GitHub URL",
		).toEqual([]);
	});

	it('is actually reading the documents it claims to check', () => {
		// The vacuity guard. A walk that returns nothing, or an extractor that matches nothing, makes the
		// case above pass over an empty list — which looks identical to a clean repo.
		//
		// Anchored on `README.md`, the one document every repository here is guaranteed to carry and the
		// first one a visitor reads, and on its links actually being extracted: a threshold above one is
		// what stops a README trimmed to a single pointer from satisfying a guard about cross-references.
		// The walk must also reach below the root, or a regression that stopped descending into
		// `packages/` and `docs/` would pass on the root files alone.
		const files = markdownFiles(REPO_ROOT).map((file) => relative(REPO_ROOT, file));

		expect(files, 'README.md must be among the files walked').toContain('README.md');
		expect(
			files.filter((file) => file.includes('/')).length,
			'the walk found no markdown below the repo root — has it stopped descending?',
		).toBeGreaterThan(0);

		const fromReadme = relativeLinkTargets(readFileSync(resolve(REPO_ROOT, 'README.md'), 'utf8'));

		expect(fromReadme.length, 'README.md links to the documents beside it').toBeGreaterThan(2);
	});
});
