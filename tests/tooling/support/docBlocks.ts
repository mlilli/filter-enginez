/**
 * Fenced code blocks in the engine's documentation, parsed and classified for `docCodeBlocks.test.ts`.
 *
 * @remarks
 * ### The three kinds of TypeScript block
 *
 * Every fenced `ts` / `tsx` block in {@link DOC_FILES} is exactly one of:
 *
 * - **compiled** — the default. The block is a consumer's or an extender's code, and it is
 *   type-checked as its own module against the packages' source.
 * - **excerpt** — tagged with `<!-- excerpt: <path>#<id> -->` on a line above the fence. The block
 *   shows how the engine itself is built, so it must equal the named source region verbatim. Any
 *   fenced language can be an excerpt (the ESLint plugin is JavaScript).
 * - **unchecked** — tagged with `<!-- unchecked: <reason> -->`. The rare, explicit opt-out; the
 *   reason is mandatory and the guard lists every use.
 *
 * There is no fourth kind. A `ts` block that is genuinely not TypeScript (pseudo-code, a shape
 * sketch, ASCII) is fenced as `text` instead, which this module does not collect.
 *
 * ### Why the markers are HTML comments
 *
 * They render as nothing on GitHub and on npm, so a reader sees an ordinary code block, while the
 * guard and a maintainer reading the Markdown source both see where the block comes from. An excerpt
 * also carries `<!-- prettier-ignore -->`: Prettier formats embedded code in Markdown, and its output
 * differs from the ESLint-stylistic formatting of the source, so an excerpt it touched would stop
 * being verbatim.
 *
 * @packageDocumentation
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { REPO_ROOT } from './repoFiles.js';

/** Fence languages that are TypeScript and therefore must be compiled, excerpted or opted out. */
export const TYPESCRIPT_LANGUAGES: ReadonlySet<string> = new Set(['ts', 'tsx', 'typescript']);

/** How a block is verified. */
export type DocBlockKind = 'compiled' | 'excerpt' | 'unchecked';

/** One fenced block, located and classified. */
export interface DocBlock {
	/** Repo-relative Markdown path. */
	readonly file: string;
	/** 1-based line of the opening fence. */
	readonly line: number;
	/** The fence's language tag, lowercased; empty when the fence has none. */
	readonly language: string;
	/** The block's text, with the fence's own indentation removed. */
	readonly body: string;
	/** How the guard verifies it; `null` for a non-TypeScript block that is not an excerpt. */
	readonly kind: DocBlockKind | null;
	/** For an excerpt: the repo-relative source path and region id. */
	readonly excerpt?: { readonly id: string; readonly path: string };
	/** For an unchecked block: the written reason. */
	readonly reason?: string;
	/** The HTML comment lines directly above the fence, verbatim and trimmed. */
	readonly markers: readonly string[];
}

/**
 * The documentation whose blocks are verified.
 *
 * @remarks
 * Computed from the filesystem rather than listed, so a new guide or a new package README is covered
 * the day it lands: the root `README.md`, `docs/architecture.md`, every `docs/guides/*.md`, and every
 * `packages/<name>/README.md` that exists.
 *
 * @returns Repo-relative Markdown paths.
 */
export function docFiles(): readonly string[] {
	const guides = readdirSync(resolve(REPO_ROOT, 'docs/guides'))
		.filter((name) => name.endsWith('.md'))
		.map((name) => `docs/guides/${name}`);
	const readmes = readdirSync(resolve(REPO_ROOT, 'packages'), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => `packages/${entry.name}/README.md`)
		.filter((path) => {
			try {
				readFileSync(resolve(REPO_ROOT, path));

				return true;
			} catch {
				return false;
			}
		});

	return ['README.md', 'docs/architecture.md', ...guides.sort(), ...readmes.sort()];
}

/** Every documentation file the guard reads; see {@link docFiles}. */
export const DOC_FILES: readonly string[] = docFiles();

const EXCERPT_MARKER = /^<!--\s*excerpt:\s*(?<path>[^#\s]+)#(?<id>[\w.-]+)\s*-->$/u;
const UNCHECKED_MARKER = /^<!--\s*unchecked:\s*(?<reason>.*?)\s*-->$/u;
const FENCE = /^(?<indent>\s*)(?<fence>`{3,}|~{3,})(?<language>[\w-]*)/u;

/**
 * Remove up to `width` leading spaces from each line.
 *
 * @param lines - Block lines.
 * @param width - The fence's indentation.
 * @returns The lines, re-joined.
 */
function dedentBy(lines: readonly string[], width: number): string {
	return lines.map((text) => text.replace(new RegExp(`^ {0,${String(width)}}`, 'u'), '')).join('\n');
}

/**
 * Classify a block from its language and the comment lines above it.
 *
 * @param language - The fence's language tag.
 * @param markers - HTML comment lines directly above the fence.
 * @returns The classification fields of a {@link DocBlock}.
 */
function classify(
	language: string,
	markers: readonly string[],
): Pick<DocBlock, 'excerpt' | 'kind' | 'reason'> {
	for (const marker of markers) {
		const excerpt = EXCERPT_MARKER.exec(marker)?.groups;

		if (excerpt !== undefined) {
			return { excerpt: { id: excerpt['id'] ?? '', path: excerpt['path'] ?? '' }, kind: 'excerpt' };
		}

		const unchecked = UNCHECKED_MARKER.exec(marker)?.groups;

		if (unchecked !== undefined) {
			return { kind: 'unchecked', reason: unchecked['reason'] ?? '' };
		}
	}

	return { kind: TYPESCRIPT_LANGUAGES.has(language) ? 'compiled' : null };
}

/**
 * The index of the fence that closes a block, or the end of the file for an unclosed one.
 *
 * @remarks
 * Per CommonMark, a closing fence has no info string, uses the opener's character and is at least as
 * long, so a ```` ``` ```` inside a ```` ```` ```` block does not end it.
 *
 * @param lines - The file's lines.
 * @param open - Index of the opening fence.
 * @param fence - The opening fence's backticks or tildes.
 * @returns Index of the closing fence.
 */
function closingFence(lines: readonly string[], open: number, fence: string): number {
	let close = open + 1;

	while (close < lines.length) {
		const candidate = FENCE.exec(lines[close] ?? '')?.groups;

		if (
			candidate?.['language'] === ''
			&& candidate['fence']?.[0] === fence[0]
			&& (candidate['fence']?.length ?? 0) >= fence.length
		) {
			return close;
		}
		close += 1;
	}

	return close;
}

/**
 * The HTML comment lines directly above a fence, nearest last.
 *
 * @param lines - The file's lines.
 * @param open - Index of the opening fence.
 * @returns The trimmed comment lines.
 */
function markersAbove(lines: readonly string[], open: number): readonly string[] {
	const markers: string[] = [];

	for (let above = open - 1; above >= 0; above -= 1) {
		const text = (lines[above] ?? '').trim();

		if (!text.startsWith('<!--')) {
			break;
		}
		markers.unshift(text);
	}

	return markers;
}

/**
 * Every fenced block in one Markdown file.
 *
 * @remarks
 * Fences may be indented (a block inside a list item); the fence's own indentation is removed from
 * the body so an excerpt compares like for like.
 *
 * @param file - Repo-relative Markdown path.
 * @returns The file's blocks, in document order.
 */
export function parseDocBlocks(file: string): readonly DocBlock[] {
	const lines = readFileSync(resolve(REPO_ROOT, file), 'utf8').split('\n');
	const blocks: DocBlock[] = [];
	let index = 0;

	while (index < lines.length) {
		const open = FENCE.exec(lines[index] ?? '')?.groups;

		if (open === undefined) {
			index += 1;
			continue;
		}

		const language = (open['language'] ?? '').toLowerCase();
		const close = closingFence(lines, index, open['fence'] ?? '```');
		const markers = markersAbove(lines, index);

		blocks.push({
			body: dedentBy(lines.slice(index + 1, close), (open['indent'] ?? '').length),
			file,
			language,
			line: index + 1,
			markers,
			...classify(language, markers),
		});
		index = close + 1;
	}

	return blocks;
}

/**
 * `file:line`, the way every failure message names a block.
 *
 * @param block - The block.
 * @returns A clickable location.
 */
export function where(block: Pick<DocBlock, 'file' | 'line'>): string {
	return `${block.file}:${String(block.line)}`;
}
