/**
 * Every TypeScript block in the engine's documentation is either compiled against the packages or
 * proven verbatim against their source.
 *
 * @remarks
 * ## Why bodies, not names
 *
 * A fenced block is not code: nothing imports it, lint sees a comment, and a signature can drift
 * from the implementation with every other gate green. Checking that a block's identifiers exist
 * catches renames and deletions, but not a block that names the right things and does the wrong
 * thing with them — a sketch that copies where the code hashes in place reads as authoritative and
 * teaches the wrong cost model. So this guard checks the body of every block, two ways:
 *
 * - **Usage blocks** — how a consumer or an extender calls the packages — are type-checked as
 *   standalone modules against `packages/<name>/src`, with the repository's strict compiler options
 *   (`support/docBlockCompiler.ts`). A block may declare the placeholders a reader would supply
 *   (`declare const wines: readonly Wine[];`) — visibly, inside the block. There is no hidden prelude.
 * - **Implementation blocks** — how the engine itself is built — are excerpts: tagged with
 *   `<!-- excerpt: <path>#<id> -->`, they must equal the source between `// #region docs:<id>` and
 *   `// #endregion docs:<id>`, forgiving only leading indentation (`support/docExcerpts.ts`).
 *
 * A compiled block may not re-declare a class, interface, type, enum or function that the packages
 * declare: a free-standing copy of `interface FilterEngine` compiles and proves nothing about the
 * real one. Showing a real declaration is what an excerpt is for.
 *
 * Content that is genuinely not TypeScript — pseudo-code, a shape, a diagram — is fenced as `text`.
 * The escape hatch, `<!-- unchecked: <reason> -->`, exists for the rare block that is TypeScript and
 * cannot be either kind; every use is listed by the last case below so it stays visible.
 *
 * ## What it reads
 *
 * `README.md`, `docs/architecture.md`, every `docs/guides/*.md` and every `packages/<name>/README.md`
 * (`support/docBlocks.ts`), and every `docs:` region under `packages/` — a region no document
 * excerpts fails too, so a marker cannot outlive its reader. Blocks fenced `svelte` or `vue` are
 * single-file components, which need their framework's compiler rather than `tsc`; they are not
 * checked here.
 *
 * ⚠ One program compiles every block (parsing the packages and the framework typings once), so the
 * compile runs in `beforeAll`; the hook budget in `vitest.config.ts` covers it with room.
 *
 * @packageDocumentation
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { type BlockDiagnostic, compileBlocks, topLevelTypeDeclarations } from './support/docBlockCompiler.js';
import { DOC_FILES, type DocBlock, parseDocBlocks, TYPESCRIPT_LANGUAGES, where } from './support/docBlocks.js';
import { allRegions, declaredInSource, normalizeIndentation, regionsIn } from './support/docExcerpts.js';
import { REPO_ROOT } from './support/repoFiles.js';

const BLOCKS: readonly DocBlock[] = DOC_FILES.flatMap((file) => parseDocBlocks(file));
const COMPILED = BLOCKS.filter((block) => block.kind === 'compiled');
const EXCERPTS = BLOCKS.filter((block) => block.kind === 'excerpt');
const UNCHECKED = BLOCKS.filter((block) => block.kind === 'unchecked');

/**
 * The virtual module name for a block: its file and line, filesystem-safe.
 *
 * @param block - A compiled block.
 * @returns E.g. `docs-architecture.md-L95`.
 */
function unitName(block: DocBlock): string {
	return `${block.file.replaceAll('/', '-')}-L${String(block.line)}`;
}

describe('documentation code blocks', () => {
	let diagnostics: readonly BlockDiagnostic[] = [];

	beforeAll(() => {
		diagnostics = compileBlocks(
			COMPILED.map((block) => ({
				extension: block.language === 'tsx' ? 'tsx' : 'ts',
				name: unitName(block),
				text: block.body,
			})),
		);
	});

	it('found the documents, their blocks, and both kinds of verification', () => {
		// Vacuity: an empty parse, a moved document or a marker syntax that silently stopped matching
		// would otherwise pass every case below.
		expect(DOC_FILES).toContain('docs/architecture.md');
		expect(DOC_FILES.length).toBeGreaterThan(15);
		expect(BLOCKS.filter((block) => TYPESCRIPT_LANGUAGES.has(block.language)).length).toBeGreaterThan(80);
		expect(COMPILED.length, 'compiled blocks').toBeGreaterThan(25);
		expect(EXCERPTS.length, 'verified excerpts').toBeGreaterThan(60);
	});

	it('compiles every usage block against the packages', () => {
		const byUnit = new Map(COMPILED.map((block) => [unitName(block), block]));
		const findings = diagnostics.map((diagnostic) => {
			const block = byUnit.get(diagnostic.name);
			const line = block === undefined ? diagnostic.line : block.line + diagnostic.line;

			return `${block?.file ?? diagnostic.name}:${String(line)} ${diagnostic.message}`;
		});

		expect(findings, `documentation blocks fail to compile:\n${findings.join('\n')}`).toStrictEqual([]);
	});

	it('does not re-declare what the packages declare', () => {
		const declared = declaredInSource();

		expect(declared.has('FilterRule'), 'the source walk found nothing').toBe(true);

		const findings = COMPILED.flatMap((block) =>
			topLevelTypeDeclarations(block.body)
				.filter((name) => declared.has(name))
				.map(
					(name) =>
						`${where(block)} declares '${name}', which the packages declare too — import it, or show the `
						+ 'real declaration as an excerpt',
				),
		);

		expect(findings, findings.join('\n')).toStrictEqual([]);
	});

	it('reproduces every excerpt verbatim from its source region', () => {
		const findings: string[] = [];

		for (const block of EXCERPTS) {
			const { id = '', path = '' } = block.excerpt ?? {};

			if (!block.markers.includes('<!-- prettier-ignore -->')) {
				findings.push(`${where(block)} excerpt needs <!-- prettier-ignore --> above the fence, or Prettier reflows it`);
			}
			if (!existsSync(resolve(REPO_ROOT, path))) {
				findings.push(`${where(block)} excerpts ${path}, which does not exist`);
				continue;
			}

			const region = regionsIn(path).regions.find((candidate) => candidate.id === id);

			if (region === undefined) {
				findings.push(`${where(block)} excerpts region '${id}', which ${path} does not mark`);
			} else if (normalizeIndentation(region.text) !== normalizeIndentation(block.body)) {
				const expected = normalizeIndentation(region.text).split('\n');
				const actual = normalizeIndentation(block.body).split('\n');
				const first = expected.findIndex((text, index) => text !== actual[index]);
				const at = first === -1 ? Math.min(expected.length, actual.length) : first;

				findings.push(
					`${where(block)} differs from ${path}#${id} at block line ${String(at + 1)}:\n`
					+ `  source: ${expected[at] ?? '(end of region)'}\n  doc:    ${actual[at] ?? '(end of block)'}`,
				);
			}
		}

		expect(findings, findings.join('\n')).toStrictEqual([]);
	});

	it('keeps every source region well formed and excerpted by some document', () => {
		const { problems, regions } = allRegions();
		const used = new Set(EXCERPTS.map((block) => `${block.excerpt?.path ?? ''}#${block.excerpt?.id ?? ''}`));
		const orphans = regions
			.filter((region) => !used.has(`${region.path}#${region.id}`))
			.map((region) => `${region.path}:${String(region.line)} region '${region.id}' is excerpted by no document`);

		expect(regions.length, 'no docs: regions found in the packages').toBeGreaterThanOrEqual(used.size);
		expect([...problems, ...orphans], [...problems, ...orphans].join('\n')).toStrictEqual([]);
	});

	it('gives every opt-out a reason, and keeps the list short enough to read', () => {
		const listed = UNCHECKED.map((block) => `${where(block)}: ${block.reason ?? ''}`);

		expect(
			UNCHECKED.filter((block) => (block.reason ?? '').length < 20).map((block) => where(block)),
			'an unchecked block needs a written reason',
		).toStrictEqual([]);
		// The current list, asserted exactly: adding an opt-out is a visible, reviewed change to this file.
		expect(listed).toStrictEqual([]);
	});
});
