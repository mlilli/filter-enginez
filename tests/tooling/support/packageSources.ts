/**
 * A package's shipped source: the non-test files under its `src/`, parsed.
 *
 * @remarks
 * Shared by the guards that read what a package's source imports
 * (`runtimeDependenciesImported.test.ts`, `lazyDependencies.test.ts`), so both agree on what counts
 * as shipped. Test files (`*.test.*`, `*.spec.*`) and `test-support/` directories are left out, as
 * every package's `tsconfig.build.json` leaves them out of `dist`.
 *
 * @packageDocumentation
 */

import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import ts from 'typescript';

/** Source extensions a package's `src/` may hold, with the script kind each is parsed as. */
const SCRIPT_KINDS: ReadonlyMap<string, ts.ScriptKind> = new Map([
	['.cjs', ts.ScriptKind.JS],
	['.cts', ts.ScriptKind.TS],
	['.js', ts.ScriptKind.JS],
	['.jsx', ts.ScriptKind.JSX],
	['.mjs', ts.ScriptKind.JS],
	['.mts', ts.ScriptKind.TS],
	['.ts', ts.ScriptKind.TS],
	['.tsx', ts.ScriptKind.TSX],
]);

/** A file name that marks a test. */
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;

/** A directory that holds test scaffolding the build excludes. */
const TEST_DIRECTORY = 'test-support';

/**
 * Every non-test source file under a directory, declaration files included.
 *
 * @param directory - The directory to walk, absolute.
 * @returns Absolute paths.
 */
export function nonTestSourceFiles(directory: string): readonly string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);

		if (entry.isDirectory()) {
			return entry.name === TEST_DIRECTORY ? [] : nonTestSourceFiles(path);
		}

		return SCRIPT_KINDS.has(extname(entry.name)) && !TEST_FILE.test(entry.name) ? [path] : [];
	});
}

/**
 * Parse one source file, with parent pointers set.
 *
 * @param path - The file, absolute.
 * @returns Its syntax tree.
 */
export function parseSource(path: string): ts.SourceFile {
	return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, SCRIPT_KINDS.get(extname(path)));
}

/** One module specifier in a source file, and the form that names it. */
export interface SpecifierUse {
	/** `dynamic` for an `import()` call, `static` for every other form. */
	readonly kind: 'dynamic' | 'static';
	/** The node that names it, for callers that inspect its surroundings. */
	readonly node: ts.Node;
	/** The specifier, as written. */
	readonly specifier: string;
}

/**
 * Every module specifier a source file names: import and re-export declarations (type-only ones
 * included), `import x = require()`, `require()` and `import()` calls, and `import('x').T` types.
 *
 * @param sourceFile - The parsed file.
 * @returns Each use, in source order.
 */
export function specifierUses(sourceFile: ts.SourceFile): readonly SpecifierUse[] {
	const uses: SpecifierUse[] = [];

	/**
	 * Collect the specifiers in one node and its children.
	 *
	 * @param node - The node to inspect.
	 */
	function visit(node: ts.Node): void {
		if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
			&& node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
			uses.push({ kind: 'static', node, specifier: node.moduleSpecifier.text });
		} else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
			&& ts.isStringLiteral(node.moduleReference.expression)) {
			uses.push({ kind: 'static', node, specifier: node.moduleReference.expression.text });
		} else if (ts.isCallExpression(node)
			&& (node.expression.kind === ts.SyntaxKind.ImportKeyword
				|| (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
			const [argument] = node.arguments;

			if (argument !== undefined && ts.isStringLiteralLike(argument)) {
				const kind = node.expression.kind === ts.SyntaxKind.ImportKeyword ? 'dynamic' : 'static';

				uses.push({ kind, node, specifier: argument.text });
			}
		} else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
			&& ts.isStringLiteral(node.argument.literal)) {
			uses.push({ kind: 'static', node, specifier: node.argument.literal.text });
		}
		ts.forEachChild(node, visit);
	}

	visit(sourceFile);

	return uses;
}

/**
 * The package a bare module specifier names: `@scope/name` for a scoped one, else its first segment.
 *
 * @param specifier - A module specifier as written.
 * @returns The package name, or `undefined` for a relative, absolute or `node:` specifier.
 */
export function packageOf(specifier: string): string | undefined {
	if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) {
		return undefined;
	}

	const segments = specifier.split('/');

	return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
}
