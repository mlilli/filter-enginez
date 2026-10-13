/**
 * Type-check documentation code blocks against the packages' real source, with the TypeScript compiler API.
 *
 * @remarks
 * ### One program, one module per block
 *
 * Every compiled block becomes a virtual file under {@link VIRTUAL_ROOT} and all of them share ONE
 * program, so the packages' source and the framework typings are parsed and bound once rather than
 * once per block. `moduleDetection: force` makes each virtual file its own module even when it has no
 * `import`, so two blocks that both declare `const engine` do not collide the way two global scripts
 * would.
 *
 * ### Options: the repository's own, with three deliberate differences
 *
 * The options are read from `tsconfig.base.json` itself — the same strict flags, `NodeNext`
 * resolution and `verbatimModuleSyntax` every package compiles with — so a block that passes here
 * would pass in a consumer project configured like this one. The differences, each for a reason:
 *
 * - `noUnusedLocals` / `noUnusedParameters` are off. A snippet routinely declares a value to show
 *   its type (`const engine = createFilterEngine(…)`) and stops; an unused binding is a lint
 *   concern, not a correctness one, and requiring every snippet to consume every binding would
 *   pad the docs with noise.
 * - `jsx: react-jsx`, for `tsx` blocks — what the React packages compile with.
 * - `moduleDetection: force`, above.
 *
 * ### How `@filter-enginez/*` and framework imports resolve
 *
 * A block's import is resolved first from the virtual file's own location (the repo root), then —
 * if that fails — as though the block sat in each package's `src` directory in turn. That second
 * step is what a consumer project gets for free: a package can always import ITSELF by name
 * (Node's self-reference, which honors the package's `exports` map), and each package's own
 * `node_modules` holds the framework it binds (React, Vue, Svelte, Angular, RxJS). So
 * `@filter-enginez/core/similarity` resolves through core's `exports`, and
 * `@filter-enginez/core/src/internals/BitmapIndex` correctly does NOT, because no export names it.
 *
 * @packageDocumentation
 */

import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

import { REPO_ROOT } from './repoFiles.js';

/** Where the virtual block files live. Nothing is written there; the compiler host serves them. */
export const VIRTUAL_ROOT = resolve(REPO_ROOT, '.doc-blocks');

/** One block handed to the compiler. */
export interface CompileUnit {
	/** Stable name, used in the virtual file name (`docs-architecture.md-L95`). */
	readonly name: string;
	/** `ts` or `tsx`. */
	readonly extension: 'ts' | 'tsx';
	/** The block's source. */
	readonly text: string;
}

/** One compiler diagnostic, located inside its block. */
export interface BlockDiagnostic {
	/** The unit's name. */
	readonly name: string;
	/** 1-based line within the block. */
	readonly line: number;
	/** The flattened diagnostic message. */
	readonly message: string;
}

/**
 * The compiler options every block is checked with; see the module remarks for the differences.
 *
 * @returns Options parsed from `tsconfig.base.json`, adjusted.
 */
function compilerOptions(): ts.CompilerOptions {
	const path = resolve(REPO_ROOT, 'tsconfig.base.json');
	const read = ts.readConfigFile(path, (file) => ts.sys.readFile(file));
	const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, REPO_ROOT, undefined, path);

	return {
		...parsed.options,
		declaration: false,
		declarationMap: false,
		jsx: ts.JsxEmit.ReactJSX,
		moduleDetection: ts.ModuleDetectionKind.Force,
		noEmit: true,
		noUnusedLocals: false,
		noUnusedParameters: false,
	};
}

/**
 * A file inside each package's `src`, used as the fallback "importing file" for resolution.
 *
 * @returns Absolute paths, one per package.
 */
function packageAnchors(): readonly string[] {
	return readdirSync(resolve(REPO_ROOT, 'packages'), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => resolve(REPO_ROOT, 'packages', entry.name, 'src', '__doc_block__.ts'));
}

/**
 * Compile every unit in one program and return the diagnostics that land inside a unit.
 *
 * @remarks
 * Diagnostics in the packages' own source are not reported here — the packages' `typecheck` task
 * owns those — so a failure always points at a documentation line.
 *
 * @param units - The blocks to compile.
 * @returns Diagnostics per unit; an empty list means every block compiled cleanly.
 */
export function compileBlocks(units: readonly CompileUnit[]): readonly BlockDiagnostic[] {
	const options = compilerOptions();
	const virtual = new Map(units.map((unit) => [resolve(VIRTUAL_ROOT, `${unit.name}.${unit.extension}`), unit]));
	const host = ts.createCompilerHost(options, true);
	const anchors = packageAnchors();
	// The default host's methods, kept as bound closures so the overrides below can delegate to them.
	const disk = ts.createCompilerHost(options, true);

	host.fileExists = (file) => virtual.has(file) || disk.fileExists(file);
	host.readFile = (file) => virtual.get(file)?.text ?? disk.readFile(file);
	host.getSourceFile = (file, language, onError, create) => {
		const unit = virtual.get(file);

		return unit === undefined
			? disk.getSourceFile(file, language, onError, create)
			: ts.createSourceFile(file, unit.text, language, true);
	};
	host.resolveModuleNameLiterals = (literals, containingFile, _reference, resolveOptions) =>
		literals.map((literal) => {
			const first = ts.resolveModuleName(literal.text, containingFile, resolveOptions, host);

			// Only bare specifiers fall back: a relative import in a block has no file to point at.
			if (first.resolvedModule !== undefined || !virtual.has(containingFile) || literal.text.startsWith('.')) {
				return first;
			}

			for (const anchor of anchors) {
				const retry = ts.resolveModuleName(literal.text, anchor, resolveOptions, host);

				if (retry.resolvedModule !== undefined) {
					return retry;
				}
			}

			return first;
		});

	const program = ts.createProgram({ host, options, rootNames: [...virtual.keys()]});
	const results: BlockDiagnostic[] = [];

	for (const [file, unit] of virtual) {
		const source = program.getSourceFile(file);

		if (source === undefined) {
			results.push({ line: 1, message: 'the compiler did not load this block', name: unit.name });
			continue;
		}

		for (const diagnostic of [
			...program.getSyntacticDiagnostics(source),
			...program.getSemanticDiagnostics(source),
		]) {
			const line = diagnostic.start === undefined ? 0 : source.getLineAndCharacterOfPosition(diagnostic.start).line;

			results.push({
				line: line + 1,
				message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
				name: unit.name,
			});
		}
	}

	return results;
}

/**
 * Top-level class, interface, type, enum and function names a block declares.
 *
 * @remarks
 * Used for the re-declaration check: a compiled block that declares `interface FilterEngine` would
 * compile happily as a free-standing copy while proving nothing about the real one. Such a block is
 * describing the engine, and must be an excerpt.
 *
 * @param text - The block's source.
 * @returns Declared names.
 */
export function topLevelTypeDeclarations(text: string): readonly string[] {
	const source = ts.createSourceFile('block.tsx', text, ts.ScriptTarget.ESNext, false, ts.ScriptKind.TSX);
	const names: string[] = [];

	for (const statement of source.statements) {
		if (
			(ts.isClassDeclaration(statement)
				|| ts.isInterfaceDeclaration(statement)
				|| ts.isTypeAliasDeclaration(statement)
				|| ts.isEnumDeclaration(statement)
				|| ts.isFunctionDeclaration(statement))
			&& statement.name !== undefined
		) {
			names.push(statement.name.text);
		}
	}

	return names;
}
