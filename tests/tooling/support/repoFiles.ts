/**
 * Every file a whole-repository content guard should read, found by walking the filesystem.
 *
 * @remarks
 * ### Why this is shared
 *
 * Two guards scan the whole tree for text that must never be there — `publicVoice.test.ts` for
 * forbidden names, `noCommittedSecrets.test.ts` for credentials — and both have to agree on what
 * "the whole tree" means. Two hand-kept skip lists drift: one guard learns that a directory is build
 * output, the other keeps scanning it, or the reverse, and the reverse is the dangerous one, because a
 * directory a scanner skips is a directory it vouches for without reading. One walker means one
 * answer.
 *
 * This file is byte-identical in the engine and examples repositories. Keep it that way: a fix made
 * to one copy is a fix the other repository silently lacks.
 *
 * ### What is skipped, and why that keeps the walk a SUPERSET of what git tracks
 *
 * Only three kinds of thing are left out, and every one of them is gitignored in both repositories:
 *
 * - dependency, build, cache and tool-state directories ({@link SKIPPED_DIRECTORIES});
 * - the local-only wine corpus ({@link LOCAL_CORPUS_FILE}) — real-world data under a
 *   non-commercial license, never committed, and full of producer names that legitimately contain
 *   strings `publicVoice` forbids;
 * - nothing else. Binary assets ARE listed, because a filename can be the finding (a tracked `.p12`
 *   is a credential store whatever its bytes say); callers that read content filter them out with
 *   {@link isBinaryPath}.
 *
 * ⚠ So outside a git work tree, a guard built on this walk is STRICTER than one built on
 * `git ls-files`: it also reads untracked files that would be committed by a careless `git add .`.
 * That is the right direction to err in for a check whose findings cannot be unpublished.
 *
 * @packageDocumentation
 */

import { readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root, resolved from this module's own location rather than from a working directory. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Directories never entered: dependencies, build output, caches and tool state — all gitignored. */
export const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
	'.angular',
	'.cache',
	'.git',
	'.pnpm-store',
	'.svelte-kit',
	'.turbo',
	'_cache',
	'build',
	'coverage',
	'dist',
	'node_modules',
	'playwright-report',
	'test-results',
	'tmp',
]);

/** Binary asset extensions, which cannot contain prose and are not worth decoding as text. */
const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
	'.gif',
	'.ico',
	'.jpeg',
	'.jpg',
	'.otf',
	'.pdf',
	'.png',
	'.tgz',
	'.ttf',
	'.webp',
	'.woff',
	'.woff2',
	'.zip',
]);

/**
 * The local-only real wine corpus and its raw source, matched by file name.
 *
 * @remarks
 * `data-real-*` is the stratified and full corpus, `data-full.json` a generated full tier, and
 * `winemag-data*` the raw upstream download. All are gitignored and can each run to 100 MB or more.
 */
export const LOCAL_CORPUS_FILE = /^(?:data-real-|data-full\.json$|winemag-data)/u;

/**
 * Is this a binary asset, by extension?
 *
 * @param path - A file path; only its extension is read.
 * @returns `true` for the binary formats in {@link BINARY_EXTENSIONS}.
 */
export function isBinaryPath(path: string): boolean {
	return BINARY_EXTENSIONS.has(extname(path).toLowerCase());
}

/**
 * Every file under `directory`, as paths relative to the repo root.
 *
 * @remarks
 * Symbolic links are neither followed nor listed (`withFileTypes` reports them as links, which are
 * neither directories nor files), so a link into a dependency or into the corpus cannot pull a second
 * tree into the scan. A link's target is either somewhere else in this walk or outside the repository
 * altogether.
 *
 * @param directory - Absolute directory to walk. Defaults to the repo root.
 * @returns Relative file paths, binary assets included.
 */
export function walkRepoFiles(directory: string = REPO_ROOT): readonly string[] {
	const files: string[] = [];

	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const entryPath = join(directory, entry.name);

		if (entry.isDirectory()) {
			if (!SKIPPED_DIRECTORIES.has(entry.name)) {
				files.push(...walkRepoFiles(entryPath));
			}
		} else if (entry.isFile() && !LOCAL_CORPUS_FILE.test(entry.name)) {
			files.push(relative(REPO_ROOT, entryPath));
		}
	}

	return files;
}
