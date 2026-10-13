/**
 * Named source regions that documentation excerpts must reproduce verbatim.
 *
 * @remarks
 * ### The marker syntax
 *
 * A region is the lines strictly between `// #region docs:<id>` and `// #endregion docs:<id>` in one
 * source file. The `#region` / `#endregion` spelling is the one editors already fold on, so the
 * markers read as structure rather than as noise; the `docs:` namespace keeps them distinct from any
 * folding region an author adds for their own reasons.
 *
 * ### Why verbatim, and what "verbatim" forgives
 *
 * A sketch that names the right identifiers can still teach the wrong algorithm — a copy where the
 * code hashes in place, `Object.create` where the code constructs. Equality with the source is the
 * only check that sees that. The one difference forgiven is leading indentation: the source indents
 * with tabs at whatever depth the region sits, and Markdown code blocks use two spaces from column
 * zero. Everything else, comments included, must match.
 *
 * @packageDocumentation
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { REPO_ROOT, SKIPPED_DIRECTORIES } from './repoFiles.js';

/** Width one leading tab stands for, matching the Markdown code blocks' two-space indent. */
const TAB_WIDTH = 2;

const REGION_OPEN = /^\s*\/\/ #region docs:(?<id>[\w.-]+)\s*$/u;
const REGION_CLOSE = /^\s*\/\/ #endregion docs:(?<id>[\w.-]+)\s*$/u;

/** One `docs:` region found in source. */
export interface SourceRegion {
	/** Repo-relative source path. */
	readonly path: string;
	/** The region id. */
	readonly id: string;
	/** 1-based line of the opening marker. */
	readonly line: number;
	/** The text between the markers. */
	readonly text: string;
}

/**
 * Normalize leading indentation so source and Markdown compare like for like.
 *
 * @remarks
 * Each leading tab becomes {@link TAB_WIDTH} spaces, the common indentation of the non-blank lines
 * is removed, and trailing whitespace is trimmed. Nothing inside a line changes.
 *
 * @param text - Source or block text.
 * @returns The normalized text.
 */
export function normalizeIndentation(text: string): string {
	const lines = text
		.split('\n')
		.map((line) => line.replace(/^[\t ]+/u, (lead) => lead.replaceAll('\t', ' '.repeat(TAB_WIDTH))).trimEnd());
	const depths = lines.filter((line) => line !== '').map((line) => line.length - line.trimStart().length);
	const common = depths.length === 0 ? 0 : Math.min(...depths);

	return lines
		.map((line) => line.slice(common))
		.join('\n')
		.replace(/^\n+|\n+$/gu, '');
}

/**
 * Every `docs:` region in one file.
 *
 * @param path - Repo-relative source path.
 * @returns The regions, or a list of structural problems (unclosed, mismatched, duplicated).
 */
export function regionsIn(path: string): { problems: readonly string[]; regions: readonly SourceRegion[] } {
	const lines = readFileSync(resolve(REPO_ROOT, path), 'utf8').split('\n');
	const regions: SourceRegion[] = [];
	const problems: string[] = [];
	const open = new Map<string, number>();

	for (const [index, text] of lines.entries()) {
		const opening = REGION_OPEN.exec(text)?.groups?.['id'];
		const closing = REGION_CLOSE.exec(text)?.groups?.['id'];

		if (opening !== undefined) {
			if (open.has(opening) || regions.some((region) => region.id === opening)) {
				problems.push(`${path}:${String(index + 1)} opens region '${opening}' a second time`);
			}
			open.set(opening, index);
		} else if (closing !== undefined) {
			const start = open.get(closing);

			if (start === undefined) {
				problems.push(`${path}:${String(index + 1)} closes region '${closing}', which is not open`);
				continue;
			}
			open.delete(closing);
			// Another region's markers nested inside this one are structure, not content: two documents may
			// excerpt overlapping code, and neither should have to reproduce the other's markers.
			const body = lines
				.slice(start + 1, index)
				.filter((line) => !REGION_OPEN.test(line) && !REGION_CLOSE.test(line))
				.join('\n');

			regions.push({ id: closing, line: start + 1, path, text: body });
		}
	}
	for (const [id, start] of open) {
		problems.push(`${path}:${String(start + 1)} opens region '${id}' and never closes it`);
	}

	return { problems, regions };
}

/**
 * Every source file under `packages/` that can carry a region.
 *
 * @param directory - Absolute directory to walk.
 * @returns Repo-relative paths of `.ts`, `.tsx`, `.js` and `.mjs` files.
 */
function sourceFiles(directory: string = resolve(REPO_ROOT, 'packages')): readonly string[] {
	const files: string[] = [];

	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);

		if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) {
			files.push(...sourceFiles(path));
		} else if (entry.isFile() && /\.(?:ts|tsx|js|mjs)$/u.test(entry.name)) {
			files.push(relative(REPO_ROOT, path));
		}
	}

	return files;
}

/**
 * Every class, interface, type, enum and function name declared in the packages' non-test source.
 *
 * @remarks
 * A flat set across all packages, matched at line start (optionally behind `export`, `declare`,
 * `abstract`), so a local helper inside a function body does not count. Test files are left out: a
 * fixture class in a test is not something a document could be re-declaring. So is `mock-data`: its
 * `Wine` and `Book` are sample item types, and a consumer example declaring its own `interface Wine`
 * is describing the consumer's data, not re-stating ours.
 *
 * @returns Declared names.
 */
export function declaredInSource(): ReadonlySet<string> {
	const names = new Set<string>();
	const declaration
		= /^(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:class|interface|type|enum|function)\s+(?<name>[A-Za-z_$][\w$]*)/gmu;

	for (const path of sourceFiles()) {
		if (/\.test\.tsx?$/u.test(path) || path.startsWith('packages/mock-data/')) {
			continue;
		}
		for (const match of readFileSync(resolve(REPO_ROOT, path), 'utf8').matchAll(declaration)) {
			names.add(match.groups?.['name'] ?? '');
		}
	}

	return names;
}

/**
 * Every `docs:` region across the packages, for the orphan check.
 *
 * @remarks
 * A region no document excerpts is a marker that protects nothing while still reading as though it
 * does, so the guard fails on it the same way it fails on a dangling excerpt tag.
 *
 * @returns All regions, and all structural problems found while collecting them.
 */
export function allRegions(): { problems: readonly string[]; regions: readonly SourceRegion[] } {
	const regions: SourceRegion[] = [];
	const problems: string[] = [];

	for (const path of sourceFiles()) {
		if (!readFileSync(resolve(REPO_ROOT, path), 'utf8').includes('#region docs:')) {
			continue;
		}

		const found = regionsIn(path);

		regions.push(...found.regions);
		problems.push(...found.problems);
	}

	return { problems, regions };
}
