/**
 * Reading a package's modules the way its build emits them, for guards that walk a package's module graph.
 *
 * @remarks
 * ### Why this is shared
 *
 * Two guards follow imports from a package's `exports` map through its sources:
 * `sideEffectFreePackages.test.ts` reads each module's top-level statements, and `lazyDependencies.test.ts` checks
 * which dependencies the static graph reaches. Both have to agree on where an export target's source lives, how a
 * relative specifier resolves, and what the compiler emits for a module, because each answers "what does a consumer
 * load?". One copy of those answers keeps the two guards describing the same graph.
 *
 * ### Why the EMITTED module, not the source
 *
 * The packages compile with `verbatimModuleSyntax`, so the compiler drops an `import type` entirely and keeps every
 * other import declaration, even one whose named bindings are all inline `type` specifiers (it becomes a bare
 * `import 'x'`, which still loads `x`). Reading the transpiled text sees exactly the imports the built `dist` file
 * has; reading source would have to re-implement that rule.
 *
 * @packageDocumentation
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';

import { REPO_ROOT } from './repoFiles.js';

/**
 * Compiler options for transpiling one package's modules the way its build does.
 *
 * @param directory - Absolute path of the package.
 * @returns The options of its `tsconfig.build.json`, emitting ES modules without declarations or maps.
 */
export function buildCompilerOptions(directory: string): ts.CompilerOptions {
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
export function emittedJavaScript(path: string, options: ts.CompilerOptions): string {
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
export function sourceOfExportTarget(directory: string, target: string): string | undefined {
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
export function resolveRelative(importer: string, specifier: string): string {
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
