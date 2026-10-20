/**
 * Every published package declares `sideEffects`, and a package that declares `false` has no module whose top level
 * does anything beyond defining what it exports.
 *
 * @remarks
 * ## Why this exists
 *
 * `"sideEffects": false` is a promise to every bundler that consumes the package: "a module whose exports you do not
 * use can be dropped, and nothing changes." Bundlers act on it without checking. That is what lets an app import one
 * error class from `@filter-enginez/core` and bundle well under a kilobyte instead of the whole engine — the
 * roaring-wasm WebAssembly (about 231 kB of inline base64 in its browser build), fuse.js and rbush.
 *
 * The promise is also a claim about code nobody has written yet. A module that registers a global, patches a built-in
 * prototype, imports a stylesheet or polyfill, or calls `customElements.define()` at its top level works in every test
 * here, and then silently stops doing its job in a consumer's production bundle, because the bundler dropped it on the
 * package's word. No type check, unit test or size budget in this repository would notice. So this guard reads every
 * module each package can load and fails on any top-level statement whose effect could reach outside the module.
 *
 * ## What it reads
 *
 * For each package it starts from the `exports` map (whose targets point at `src` in the workspace), follows every
 * relative `import`, `export … from` and `import()` to the modules a consumer can reach, and transpiles each one with
 * the compiler options of the package's own `tsconfig.build.json`. `tsc` emits one output file per source module and
 * keeps the statement structure, so the transpiled text has the same top-level statements as the built `dist` file,
 * including anything the compiler adds (lowered decorators or enums). Transpiling instead of reading `dist` keeps the
 * guard independent of a prior build, so it runs in CI before `pnpm build` does.
 *
 * ## What counts as an effect
 *
 * Accepted at the top level: imports that bind names, re-exports, function and class declarations, and `const` / `let`
 * / `var` bindings, including ones whose initializer calls a function. Module-level values are built that way — a
 * registry, a cache, a React context, an Angular injection token, a generated dataset — and a bundler that drops the
 * module drops the value with it.
 *
 * Reported: a bare `import './x'` (it exists only to run the other module), an expression statement (a call or an
 * assignment whose result nobody binds), any other statement form (`if`, `for`, a block), a class static block or
 * decorator, and, inside a binding's initializer outside any function body, an assignment, `++` / `--`, `delete`, a
 * top-level `await`, or a reference to a host global (`globalThis`, `window`, `document`, `customElements` and the
 * like). Code inside a function body runs only when something calls it, so it is not read.
 *
 * ⚠ The accepted shape is a judgment, not a proof: `const unused = registerGlobally()` passes. The audit behind
 * `"sideEffects": false` read every such initializer; this guard catches the statement forms that exist only for their
 * effect, which is how a real module-level side effect is almost always written.
 *
 * ## Reviewed exceptions
 *
 * A reported statement whose effect stays inside its own module is safe under `false`: whenever anything the effect
 * touches is reachable, the module is in the bundle and the statement runs. Such statements are listed in
 * {@link REVIEWED_EFFECTS} with the reason, and an entry that no longer matches anything fails too, so the list cannot
 * keep vouching for code that has gone. A package whose effect DOES reach outside its module declares the built file in
 * an array instead (`"sideEffects": ["./dist/register.js"]`), and the guard skips exactly the files listed there.
 *
 * @packageDocumentation
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, posix, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './support/repoFiles.js';

/** The fields of a package manifest this guard reads. */
interface Manifest {
	readonly exports?: Readonly<Record<string, Readonly<Record<string, string>> | string>>;
	readonly name: string;
	readonly private?: boolean;
	readonly publishConfig?: { readonly sideEffects?: unknown };
	readonly sideEffects?: unknown;
}

/** One publishable package under `packages/`. */
interface PublishedPackage {
	/** Absolute path of the package directory. */
	readonly directory: string;
	/** The directory name, as in `packages/<directoryName>`. */
	readonly directoryName: string;
	/** The parsed manifest. */
	readonly manifest: Manifest;
}

/** One top-level statement whose effect could reach outside its module. */
interface Finding {
	/** Source path relative to the package's `src`, such as `errors/FilterEngineError.ts`. */
	readonly file: string;
	/** 1-based line of the statement in the transpiled module. */
	readonly line: number;
	/** What kind of effect it is. */
	readonly reason: string;
	/** The offending node's text, whitespace collapsed to single spaces. */
	readonly text: string;
}

/** The result of reading every module one package can load. */
interface PackageScan {
	/** How many modules were read. */
	readonly moduleCount: number;
	/** The package. */
	readonly publishedPackage: PublishedPackage;
	/** The reviewed exceptions that matched a finding, once per finding. */
	readonly reviewed: readonly ReviewedEffect[];
	/** The findings no reviewed exception covers. */
	readonly unreviewed: readonly Finding[];
}

/** A reported statement that was reviewed and found to touch only bindings of its own module. */
interface ReviewedEffect {
	/** Matches {@link Finding.file}. */
	readonly file: RegExp;
	/** The package directory name. */
	readonly packageDirectory: string;
	/** Why dropping the module together with this statement changes nothing. */
	readonly reason: string;
	/** Matches {@link Finding.text}. */
	readonly text: RegExp;
}

/**
 * The reviewed exceptions. Each entry must match at least one finding.
 *
 * @remarks
 * Keep each `text` pattern as narrow as the statement it covers: a pattern that matches more than the reviewed call
 * vouches for code nobody reviewed.
 */
const REVIEWED_EFFECTS: readonly ReviewedEffect[] = [
	{
		file: /^FilterEngine\.ts$/u,
		packageDirectory: 'core',
		reason: 'wraps the methods of FilterEngine.prototype, the class this module declares; any code that can reach '
			+ 'a FilterEngine keeps this module, so the wrapper is always in place',
		text: /^rejectCallsAfterDestroy\(FilterEngine\.prototype, 'FilterEngine'\);$/u,
	},
	{
		file: /^(?:errors\/FilterEngine\w*Error|rules\/ruleRegistry)\.ts$/u,
		packageDirectory: 'core',
		reason: 'sets `name` on the prototype of the class whose static block it is, so the name travels with the class',
		text: /^static \{ defineErrorName\(this, '\w+'\); \}$/u,
	},
	{
		file: /^wine\/data\.ts$/u,
		packageDirectory: 'mock-data',
		reason: 'awaits the default wine tier so `wines` is an array at import; the loader reads a bundled file or '
			+ 'generates wines, and writes only its own module-level cache',
		text: /^export const wines = await loadDefaultWines\(\);$/u,
	},
];

/**
 * Host globals that a module's top level has no business touching: reading one at import time is how a module
 * registers itself, patches the environment or polyfills it.
 */
const HOST_GLOBALS: ReadonlySet<string> = new Set([
	'customElements',
	'document',
	'globalThis',
	'history',
	'localStorage',
	'location',
	'navigator',
	'self',
	'sessionStorage',
	'window',
]);

/** Assignment operators, compound ones included. */
const ASSIGNMENT_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
	ts.SyntaxKind.AmpersandAmpersandEqualsToken,
	ts.SyntaxKind.AmpersandEqualsToken,
	ts.SyntaxKind.AsteriskAsteriskEqualsToken,
	ts.SyntaxKind.AsteriskEqualsToken,
	ts.SyntaxKind.BarBarEqualsToken,
	ts.SyntaxKind.BarEqualsToken,
	ts.SyntaxKind.CaretEqualsToken,
	ts.SyntaxKind.EqualsToken,
	ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
	ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
	ts.SyntaxKind.LessThanLessThanEqualsToken,
	ts.SyntaxKind.MinusEqualsToken,
	ts.SyntaxKind.PercentEqualsToken,
	ts.SyntaxKind.PlusEqualsToken,
	ts.SyntaxKind.QuestionQuestionEqualsToken,
	ts.SyntaxKind.SlashEqualsToken,
]);

/**
 * Collapse runs of whitespace so a statement's text does not depend on line wrapping.
 *
 * @param text - Source text.
 * @returns The text on one line.
 */
function collapseWhitespace(text: string): string {
	return text.replace(/\s+/gu, ' ').trim();
}

/**
 * Does this node start a body that runs only when called?
 *
 * @param node - Any node.
 * @returns `true` for functions, methods, accessors and constructors.
 */
function isDeferredBody(node: ts.Node): boolean {
	return ts.isArrowFunction(node)
		|| ts.isFunctionExpression(node)
		|| ts.isMethodDeclaration(node)
		|| ts.isGetAccessorDeclaration(node)
		|| ts.isSetAccessorDeclaration(node)
		|| ts.isConstructorDeclaration(node);
}

/**
 * The first effect inside an expression that runs at import time, if any.
 *
 * @param root - A binding's initializer, a class member's initializer, or an exported expression.
 * @returns A description of the effect, or `undefined` when there is none.
 */
function effectInExpression(root: ts.Node): string | undefined {
	let effect: string | undefined;

	/**
	 * Walk one node, recording the first effect.
	 *
	 * @param node - The node to inspect.
	 */
	function visit(node: ts.Node): void {
		if (effect !== undefined || isDeferredBody(node)) {
			return;
		}
		if (ts.isAwaitExpression(node)) {
			effect = 'top-level await';
		} else if (ts.isBinaryExpression(node) && ASSIGNMENT_OPERATORS.has(node.operatorToken.kind)) {
			effect = 'assignment';
		} else if (
			(ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
			&& (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)
		) {
			effect = 'increment or decrement';
		} else if (ts.isDeleteExpression(node)) {
			effect = 'delete';
		} else if (ts.isClassStaticBlockDeclaration(node)) {
			effect = 'class static block';
		} else if (ts.isIdentifier(node) && HOST_GLOBALS.has(node.text)) {
			effect = `host global \`${node.text}\``;
		} else if (ts.isPropertyAccessExpression(node)) {
			// The name after the dot is a property, not a reference: `config.window` touches no global.
			visit(node.expression);
		} else if (ts.isPropertyAssignment(node)) {
			// Likewise the key of `{ window: … }`; a computed key is still an expression and is read.
			if (ts.isComputedPropertyName(node.name)) {
				visit(node.name.expression);
			}
			visit(node.initializer);
		} else {
			ts.forEachChild(node, visit);
		}
	}

	visit(root);

	return effect;
}

/**
 * Findings for one class declaration: decorators, effects in its heritage clause or static members, static blocks.
 *
 * @param declaration - A top-level class.
 * @returns The effects found, as `[node, reason]` pairs.
 */
function classEffects(declaration: ts.ClassDeclaration): readonly (readonly [ts.Node, string])[] {
	const effects: (readonly [ts.Node, string])[] = [];

	for (const decorator of ts.getDecorators(declaration) ?? []) {
		effects.push([decorator, 'decorator']);
	}
	for (const clause of declaration.heritageClauses ?? []) {
		for (const type of clause.types) {
			const effect = effectInExpression(type.expression);

			if (effect !== undefined) {
				effects.push([type, effect]);
			}
		}
	}
	for (const member of declaration.members) {
		if (ts.isClassStaticBlockDeclaration(member)) {
			effects.push([member, 'class static block']);
			continue;
		}
		for (const decorator of ts.canHaveDecorators(member) ? ts.getDecorators(member) ?? [] : []) {
			effects.push([decorator, 'decorator']);
		}
		if (member.name !== undefined && ts.isComputedPropertyName(member.name)) {
			const effect = effectInExpression(member.name.expression);

			if (effect !== undefined) {
				effects.push([member.name, effect]);
			}
		}

		const isStatic = (ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static) !== 0;

		if (isStatic && ts.isPropertyDeclaration(member) && member.initializer !== undefined) {
			const effect = effectInExpression(member.initializer);

			if (effect !== undefined) {
				effects.push([member, `static field initializer: ${effect}`]);
			}
		}
	}

	return effects;
}

/**
 * Every top-level statement of a transpiled module whose effect could reach outside the module.
 *
 * @param javascript - The module as `tsc` emits it.
 * @param file - The module's path relative to its package's `src`, recorded on each finding.
 * @returns The findings, in source order.
 */
function findTopLevelEffects(javascript: string, file: string): readonly Finding[] {
	const sourceFile = ts.createSourceFile(file, javascript, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
	const findings: Finding[] = [];

	/**
	 * Record one finding.
	 *
	 * @param node - The offending node.
	 * @param reason - What kind of effect it is.
	 */
	function report(node: ts.Node, reason: string): void {
		findings.push({
			file,
			line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
			reason,
			text: collapseWhitespace(node.getText(sourceFile)),
		});
	}

	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement)) {
			if (statement.importClause === undefined) {
				report(statement, 'bare import, which runs the imported module for its effects');
			}
		} else if (ts.isExportDeclaration(statement) || ts.isFunctionDeclaration(statement) || ts.isEmptyStatement(statement)) {
			// Re-exports, function declarations and stray semicolons define names and run nothing.
		} else if (ts.isClassDeclaration(statement)) {
			for (const [node, reason] of classEffects(statement)) {
				report(node, reason);
			}
		} else if (ts.isVariableStatement(statement)) {
			for (const declaration of statement.declarationList.declarations) {
				const effect = declaration.initializer === undefined ? undefined : effectInExpression(declaration.initializer);

				if (effect !== undefined) {
					report(statement, effect);
				}
			}
		} else if (ts.isExportAssignment(statement)) {
			const effect = effectInExpression(statement.expression);

			if (effect !== undefined) {
				report(statement, effect);
			}
		} else if (ts.isExpressionStatement(statement)) {
			if (!ts.isStringLiteral(statement.expression)) {
				report(statement, 'expression statement');
			}
		} else {
			report(statement, `top-level ${ts.SyntaxKind[statement.kind]}`);
		}
	}

	return findings;
}

/**
 * Compiler options for transpiling one package's modules the way its build does.
 *
 * @param directory - Absolute path of the package.
 * @returns The options of its `tsconfig.build.json`, emitting ES modules without declarations or maps.
 */
function buildCompilerOptions(directory: string): ts.CompilerOptions {
	const configPath = resolve(directory, 'tsconfig.build.json');
	const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
		...ts.sys,
		onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
			throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
		},
	});

	if (parsed === undefined) {
		throw new Error(`${configPath} could not be read`);
	}

	// `module: ESNext` because `transpileModule` cannot see `"type": "module"`, which is what makes NodeNext emit ESM;
	// the statement structure is the same either way.
	return {
		...parsed.options,
		composite: false,
		declaration: false,
		declarationMap: false,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		noEmit: false,
		sourceMap: false,
	};
}

/**
 * Transpile a module the way the package build emits it.
 *
 * @param path - Absolute path of a `.ts`, `.tsx` or `.js` source.
 * @param options - From {@link buildCompilerOptions}.
 * @returns The emitted JavaScript; a `.js` source is returned as written.
 */
function emittedJavaScript(path: string, options: ts.CompilerOptions): string {
	const source = readFileSync(path, 'utf8');

	if (path.endsWith('.js')) {
		return source;
	}

	return ts.transpileModule(source, { compilerOptions: options, fileName: path }).outputText;
}

/**
 * Map an `exports` target to the source module it is built from.
 *
 * @param directory - Absolute path of the package.
 * @param target - A target such as `./src/index.ts` or `./dist/plugin/index.js`.
 * @returns The absolute source path, or `undefined` for a declaration file.
 */
function sourceOfExportTarget(directory: string, target: string): string | undefined {
	if (target.endsWith('.d.ts')) {
		return undefined;
	}

	const built = /^\.\/dist\/(?<path>.+)\.js$/u.exec(target)?.groups?.['path'];

	return resolve(directory, built === undefined ? target : `./src/${built}.ts`);
}

/**
 * Resolve a relative module specifier the way `moduleResolution: nodenext` does for this repository's sources.
 *
 * @param importer - Absolute path of the importing module.
 * @param specifier - A relative specifier, such as `./errors/index.js`.
 * @returns The absolute path of the source module.
 */
function resolveRelative(importer: string, specifier: string): string {
	const base = resolve(dirname(importer), specifier);
	const candidates = specifier.endsWith('.js')
		? [base.replace(/\.js$/u, '.ts'), base.replace(/\.js$/u, '.tsx'), base]
		: [`${base}.ts`, resolve(base, 'index.ts'), base];
	const found = candidates.find((candidate) => existsSync(candidate) && !candidate.endsWith('.d.ts'));

	if (found === undefined) {
		throw new Error(`${relative(REPO_ROOT, importer)} imports '${specifier}', which resolves to no source file`);
	}

	return found;
}

/**
 * The relative modules a source file loads: static imports and re-exports that are not type-only, and `import()`.
 *
 * @param path - Absolute path of a source module.
 * @returns The specifiers, as written.
 */
function relativeSpecifiers(path: string): readonly string[] {
	const sourceFile = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
	const specifiers: string[] = [];

	/**
	 * Collect the specifiers in one node and its children.
	 *
	 * @param node - The node to inspect.
	 */
	function visit(node: ts.Node): void {
		if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly !== true && ts.isStringLiteral(node.moduleSpecifier)) {
			specifiers.push(node.moduleSpecifier.text);
		} else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier !== undefined
			&& ts.isStringLiteral(node.moduleSpecifier)) {
			specifiers.push(node.moduleSpecifier.text);
		} else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
			const [argument] = node.arguments;

			if (argument !== undefined && ts.isStringLiteralLike(argument)) {
				specifiers.push(argument.text);
			}
		}
		ts.forEachChild(node, visit);
	}

	visit(sourceFile);

	// JSON modules carry data, not statements.
	return specifiers.filter((specifier) => specifier.startsWith('.') && !specifier.endsWith('.json'));
}

/**
 * Every source module a consumer of the package can load, starting from its `exports` map.
 *
 * @param publishedPackage - The package.
 * @returns Absolute source paths, sorted.
 */
function reachableModules(publishedPackage: PublishedPackage): readonly string[] {
	const pending = Object.values(publishedPackage.manifest.exports ?? {})
		.flatMap((target) => (typeof target === 'string' ? [target] : Object.values(target)))
		.map((target) => sourceOfExportTarget(publishedPackage.directory, target))
		.filter((path) => path !== undefined);
	const seen = new Set<string>();

	for (let path = pending.pop(); path !== undefined; path = pending.pop()) {
		if (seen.has(path)) {
			continue;
		}
		seen.add(path);
		pending.push(...relativeSpecifiers(path).map((specifier) => resolveRelative(path, specifier)));
	}

	return [...seen].sort();
}

/**
 * The publishable packages: every directory under `packages/` whose manifest is not private.
 *
 * @returns The packages, sorted by directory name.
 */
function publishedPackages(): readonly PublishedPackage[] {
	const packagesRoot = resolve(REPO_ROOT, 'packages');

	return readdirSync(packagesRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(resolve(packagesRoot, entry.name, 'package.json')))
		.map((entry) => {
			const directory = resolve(packagesRoot, entry.name);
			const manifest = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8')) as Manifest;

			return { directory, directoryName: entry.name, manifest };
		})
		.filter((candidate) => candidate.manifest.private !== true)
		.sort((left, right) => left.directoryName.localeCompare(right.directoryName));
}

/**
 * The `dist` path a source module builds to, in the form a `sideEffects` array names it.
 *
 * @param publishedPackage - The package.
 * @param sourcePath - Absolute path under the package's `src`.
 * @returns A path such as `./dist/errors/index.js`.
 */
function builtPathOf(publishedPackage: PublishedPackage, sourcePath: string): string {
	const fromSource = posix.normalize(relative(resolve(publishedPackage.directory, 'src'), sourcePath).replaceAll('\\', '/'));

	return `./dist/${fromSource.replace(/\.tsx?$/u, '.js')}`;
}

/**
 * Is a finding covered by a reviewed exception for its package?
 *
 * @param publishedPackage - The package the finding is in.
 * @param finding - The finding.
 * @returns The matching exception, if any.
 */
function reviewedEffectFor(publishedPackage: PublishedPackage, finding: Finding): ReviewedEffect | undefined {
	return REVIEWED_EFFECTS.find((reviewed) => reviewed.packageDirectory === publishedPackage.directoryName
		&& reviewed.file.test(finding.file)
		&& reviewed.text.test(finding.text));
}

/**
 * Transpile a snippet as a TypeScript module and report its top-level effects, for the classifier's own cases.
 *
 * @param source - TypeScript module text.
 * @returns The reasons reported, in order.
 */
function effectsInSnippet(source: string): readonly string[] {
	const options = buildCompilerOptions(resolve(REPO_ROOT, 'packages/core'));
	const javascript = ts.transpileModule(source, { compilerOptions: options, fileName: 'snippet.ts' }).outputText;

	return findTopLevelEffects(javascript, 'snippet.ts').map((finding) => finding.reason);
}

/**
 * Scan every module a package can load, skipping the built files its `sideEffects` array names.
 *
 * @param publishedPackage - The package.
 * @returns The modules read, the findings no reviewed exception covers, and the exceptions that matched.
 */
function scanPackage(publishedPackage: PublishedPackage): PackageScan {
	const { sideEffects } = publishedPackage.manifest;
	const declaredFiles = new Set(Array.isArray(sideEffects) ? sideEffects as readonly unknown[] : []);
	const modules = reachableModules(publishedPackage).filter((path) => !declaredFiles.has(builtPathOf(publishedPackage, path)));
	const options = buildCompilerOptions(publishedPackage.directory);
	const unreviewed: Finding[] = [];
	const reviewed: ReviewedEffect[] = [];

	for (const path of modules) {
		const file = relative(resolve(publishedPackage.directory, 'src'), path).replaceAll('\\', '/');

		for (const finding of findTopLevelEffects(emittedJavaScript(path, options), file)) {
			const exception = reviewedEffectFor(publishedPackage, finding);

			if (exception === undefined) {
				unreviewed.push(finding);
			} else {
				reviewed.push(exception);
			}
		}
	}

	return { moduleCount: modules.length, publishedPackage, reviewed, unreviewed };
}

const PACKAGES = publishedPackages();

/** Every package scanned once, so the per-package cases and the stale-exception case read the same result. */
const SCANS: readonly PackageScan[] = PACKAGES.map(scanPackage);

describe('the top-level effect classifier', () => {
	it.each([
		['a stylesheet import', `import './styles.css';`],
		['a custom element registration', `customElements.define('x-filter', class extends HTMLElement {});`],
		['a built-in prototype patch', `Array.prototype.last = function () { return this.at(-1); };`],
		['a polyfill bound to a name', `export const fetchImpl = (globalThis.fetch ??= () => undefined);`],
		['a host global read into a binding', `export const storage = window.localStorage;`],
		['a top-level await', `declare function init(): Promise<number>; export const ready = await init();`],
		['a class static block', `declare function register(c: unknown): void; export class A { static { register(this); } }`],
		['a counter bumped at import', `let count = 0; export const id = count++;`],
		['a conditional at the top level', `declare const x: boolean; if (x) { console.log(x); }`],
		['a lowered decorator', `declare function d(c: unknown): void; @d export class Decorated {}`],
	])('reports %s', (_label, source) => {
		expect(effectsInSnippet(source)).not.toEqual([]);
	});

	it.each([
		['bindings and re-exports', `import { a } from './a.js'; export { a }; export * from './b.js';`],
		['module-level values built by calls', `declare function make(): object; export const registry = make(); const cache = new Map<string, number>();`],
		['an error class with instance fields', `export class E extends Error { readonly code = 'X'; }`],
		['host globals inside function bodies', `export function f(): void { window.name = 'x'; } export const g = (): void => { document.title = 'x'; };`],
		['a property named like a host global', `declare const config: { window: number }; export const size = config.window; export const o = { document: 1 };`],
	])('accepts %s', (_label, source) => {
		expect(effectsInSnippet(source)).toEqual([]);
	});
});

describe('sideEffects declarations', () => {
	it('finds the publishable packages under packages/', () => {
		// The vacuity check: an empty list would pass every case below.
		expect(PACKAGES.map((publishedPackage) => publishedPackage.manifest.name)).toEqual(
			expect.arrayContaining(['@filter-enginez/core', '@filter-enginez/mock-data', '@filter-enginez/worker-bridge']),
		);
	});

	it.each(PACKAGES.map((publishedPackage) => [publishedPackage.manifest.name, publishedPackage] as const))(
		'%s declares sideEffects at the top level of its manifest',
		(name, publishedPackage) => {
			const { sideEffects } = publishedPackage.manifest;
			const isFileList = Array.isArray(sideEffects)
				&& sideEffects.length > 0
				&& sideEffects.every((entry) => typeof entry === 'string' && entry.startsWith('./dist/'));

			expect(
				sideEffects === false || isFileList,
				`${name}: declare "sideEffects": false, or list the built files that have effects, as `
				+ '["./dist/<file>.js"]. Without the field, bundlers keep every module of the package an app touches.',
			).toBe(true);
			// `pnpm pack` copies the top-level field into the published manifest; a second copy here could only disagree.
			expect(publishedPackage.manifest.publishConfig?.sideEffects, `${name}: keep sideEffects out of publishConfig`)
				.toBeUndefined();
		},
	);

	it('lists no reviewed exception for a package that does not exist', () => {
		const directories = new Set(PACKAGES.map((publishedPackage) => publishedPackage.directoryName));

		expect(REVIEWED_EFFECTS.filter((reviewed) => !directories.has(reviewed.packageDirectory))).toEqual([]);
	});
});

describe('modules of side-effect-free packages', () => {
	it.each(SCANS.map((scan) => [scan.publishedPackage.manifest.name, scan] as const))(
		'%s: no module does anything at import time beyond defining its exports',
		(name, scan) => {
			expect(scan.moduleCount, `${name}: its exports map reaches no source module`).toBeGreaterThan(0);
			expect(
				scan.unreviewed.map((finding) => `  ${finding.file}:${String(finding.line)} (${finding.reason}): ${finding.text}`),
				`${name} declares "sideEffects": false, but these top-level statements may act outside their module. `
				+ 'Move the work into the function that needs it; or, when the effect only touches bindings this module '
				+ 'declares, add a reviewed entry to REVIEWED_EFFECTS with the reason; or, when it really must run at '
				+ 'import, list the built file in the package\'s "sideEffects" array.',
			).toEqual([]);
		},
	);

	it('has no reviewed exception left that matches nothing', () => {
		const used = new Set(SCANS.flatMap((scan) => scan.reviewed));
		const stale = REVIEWED_EFFECTS.filter((reviewed) => !used.has(reviewed));

		expect(
			stale.map((reviewed) => `${reviewed.packageDirectory}: ${reviewed.file.source} / ${reviewed.text.source}`),
			'these REVIEWED_EFFECTS entries match no statement any more; delete them',
		).toEqual([]);
	});
});
