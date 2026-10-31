/**
 * A dependency a package loads on demand is an optional peer dependency, reachable from its entry points through
 * `import()` only, never through a static import.
 *
 * @remarks
 * ## Why this exists
 *
 * `@filter-enginez/core` uses `roaring-wasm` for bitmap acceleration, and the library is about 259 kB minified,
 * nearly all of it inline WebAssembly. Most apps never enable bitmaps, so core loads it inside
 * `initializeBitmapAcceleration()` with a dynamic `import()`: a bundler then leaves it out of every app that never
 * calls that function, or splits it into a chunk fetched only when the call runs. And it is an optional peer
 * dependency, so installing core does not install it: an app that enables bitmaps installs it itself, and
 * `initializeBitmapAcceleration()` names the install command when it is missing. A second case holds the manifest to
 * that — `peerDependencies` plus `peerDependenciesMeta.optional`, never `dependencies` — and to a matching
 * `devDependencies` entry, which is what installs it for the package's own tests and the benchmarks.
 *
 * An optional peer has to stay invisible to an app that does not install it, at build time as well as at run time,
 * and a third case reads the package's source for the two ways it stops being so. A type import of the dependency,
 * even `import type`, is copied into the emitted `.d.ts`, so an app type-checking with `skipLibCheck: false` fails
 * with "Cannot find module"; the types the package needs are declared in the package. And esbuild and webpack fail a
 * bundle on a bare `import()` they cannot resolve; inside a `try` block they leave it for the runtime to reject, so
 * the loader keeps it there.
 *
 * One static import anywhere on a path from an entry point undoes that, and nothing else in this repository would
 * notice. The engine's behavior is identical either way, every unit suite stays green, and the size budget for core
 * leaves its dependencies out. A `RoaringBitmap32` imported as a value "just for a type", or a re-export through a
 * barrel, is all it takes. So this guard walks the static module graph from every entry point and fails when the
 * dependency appears in it, printing the import chain that reached it.
 *
 * ## What it reads
 *
 * Each package's `exports` map gives the entry points. From each one it follows every relative static import and
 * re-export, reading every module as the build emits it (`support/packageModules.ts` explains why emitted rather than
 * source: under `verbatimModuleSyntax` an `import { type X } from 'lib'` still loads `lib`). Dynamic `import()` calls
 * are recorded but not followed, which is exactly the boundary a bundler splits at.
 *
 * ## Vacuity
 *
 * A walk that reads nothing finds nothing. Each case asserts the walk read a plausible number of modules and that some
 * module still loads the dependency through `import()`, and the manifest case requires it to be declared as a peer. If
 * the dependency were removed, or the loader stopped importing it, a case fails rather than passing in silence.
 *
 * @packageDocumentation
 */

import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { buildCompilerOptions, emittedJavaScript, resolveRelative, sourceOfExportTarget } from './support/packageModules.js';
import { nonTestSourceFiles, packageOf, parseSource, specifierUses } from './support/packageSources.js';
import { REPO_ROOT } from './support/repoFiles.js';

/**
 * Whether a node sits inside the `try` block of a `try` statement in its own function — the
 * condition under which esbuild and webpack let an unresolvable `import()` through to the runtime.
 *
 * @param node - The node.
 * @returns `true` when an enclosing `try` block is reached before a function boundary.
 */
function isInsideTryBlock(node: ts.Node): boolean {
	// The source file is the root: `parent` is unset there at run time, although the type says otherwise.
	for (let child = node; !ts.isSourceFile(child); child = child.parent) {
		if (ts.isFunctionLike(child)) {
			return false;
		}
		if (ts.isTryStatement(child.parent) && child.parent.tryBlock === child) {
			return true;
		}
	}

	return false;
}

/** A dependency that must be loaded only through `import()`. */
interface LazyDependency {
	/** The bare specifier, as in `import('roaring-wasm')`. */
	readonly dependency: string;
	/** The fewest modules the walk must read before its silence means anything. */
	readonly minimumModules: number;
	/** The package directory, as in `packages/<packageDirectory>`. */
	readonly packageDirectory: string;
	/** Why it is loaded on demand, for the failure message. */
	readonly reason: string;
}

/** The dependencies loaded on demand. */
const LAZY_DEPENDENCIES: readonly LazyDependency[] = [
	{
		dependency: 'roaring-wasm',
		minimumModules: 80,
		packageDirectory: 'core',
		reason: 'about 259 kB of mostly inline WebAssembly that only `initializeBitmapAcceleration()` needs; an app that '
			+ 'never enables bitmaps must not bundle it',
	},
];

/** The manifest fields that declare a lazy dependency. */
interface LazyManifest {
	readonly dependencies?: Readonly<Record<string, string>>;
	readonly devDependencies?: Readonly<Record<string, string>>;
	readonly peerDependencies?: Readonly<Record<string, string>>;
	readonly peerDependenciesMeta?: Readonly<Record<string, { readonly optional?: boolean }>>;
}

/** The imports one emitted module makes. */
interface ModuleImports {
	/** Specifiers loaded through `import()`. */
	readonly dynamic: readonly string[];
	/** Specifiers loaded through import and re-export declarations. */
	readonly static: readonly string[];
}

/**
 * The imports one emitted module makes.
 *
 * @param javascript - The module as `tsc` emits it.
 * @param fileName - Its path, for the parser.
 * @returns Its static and dynamic specifiers, as written.
 */
function importsOf(javascript: string, fileName: string): ModuleImports {
	const sourceFile = ts.createSourceFile(fileName, javascript, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
	const staticSpecifiers: string[] = [];
	const dynamicSpecifiers: string[] = [];

	/**
	 * Collect the specifiers in one node and its children.
	 *
	 * @param node - The node to inspect.
	 */
	function visit(node: ts.Node): void {
		if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
			&& node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
			staticSpecifiers.push(node.moduleSpecifier.text);
		} else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
			const [argument] = node.arguments;

			if (argument !== undefined && ts.isStringLiteralLike(argument)) {
				dynamicSpecifiers.push(argument.text);
			}
		}
		ts.forEachChild(node, visit);
	}

	visit(sourceFile);

	return { dynamic: dynamicSpecifiers, static: staticSpecifiers };
}

/** What a walk of one package's static module graph found. */
interface StaticGraph {
	/** Each static import of the dependency, as the chain of modules from an entry point that reached it. */
	readonly chainsToDependency: readonly (readonly string[])[];
	/** The modules that load the dependency through `import()`, relative to the package. */
	readonly dynamicLoaders: readonly string[];
	/** How many modules the walk read. */
	readonly moduleCount: number;
}

/**
 * Walk the static module graph of a package from every `exports` entry point.
 *
 * @param packageDirectory - The package directory under `packages/`.
 * @param dependency - The bare specifier to look for.
 * @returns The chains that reach it statically, the modules that load it dynamically, and the modules read.
 */
function walkStaticGraph(packageDirectory: string, dependency: string): StaticGraph {
	const directory = resolve(REPO_ROOT, 'packages', packageDirectory);
	const manifest = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8')) as {
		readonly exports?: Readonly<Record<string, Readonly<Record<string, string>> | string>>;
	};
	const options = buildCompilerOptions(directory);
	const entries = Object.values(manifest.exports ?? {})
		.flatMap((target) => (typeof target === 'string' ? [target] : Object.values(target)))
		.map((target) => sourceOfExportTarget(directory, target))
		.filter((path) => path !== undefined);
	/** Each module mapped to the chain of modules that first reached it, entry point first. */
	const chains = new Map<string, readonly string[]>();
	const pending: (readonly string[])[] = entries.map((entry) => [entry]);
	const chainsToDependency: (readonly string[])[] = [];
	const dynamicLoaders: string[] = [];
	const label = (path: string): string => relative(directory, path).replaceAll('\\', '/');

	for (let chain = pending.shift(); chain !== undefined; chain = pending.shift()) {
		const path = chain.at(-1) ?? '';

		if (chains.has(path)) {
			continue;
		}
		chains.set(path, chain);

		const imports = importsOf(emittedJavaScript(path, options), path);

		if (imports.dynamic.includes(dependency)) {
			dynamicLoaders.push(label(path));
		}
		for (const specifier of imports.static) {
			if (specifier === dependency || specifier.startsWith(`${dependency}/`)) {
				chainsToDependency.push([...chain.map(label), specifier]);
			} else if (specifier.startsWith('.') && !specifier.endsWith('.json')) {
				pending.push([...chain, resolveRelative(path, specifier)]);
			}
		}
	}

	return { chainsToDependency, dynamicLoaders, moduleCount: chains.size };
}

describe('dependencies loaded on demand', () => {
	it('lists at least one', () => {
		expect(LAZY_DEPENDENCIES.length).toBeGreaterThan(0);
	});

	it.each(LAZY_DEPENDENCIES.map((lazy) => [`${lazy.packageDirectory} → ${lazy.dependency}`, lazy] as const))(
		'%s is reachable through import() only',
		(_label, lazy) => {
			const graph = walkStaticGraph(lazy.packageDirectory, lazy.dependency);

			// Vacuity: the walk read the package.
			expect(graph.moduleCount, 'modules read from the exports entry points').toBeGreaterThanOrEqual(lazy.minimumModules);

			expect(
				graph.chainsToDependency.map((chain) => `  ${chain.join(' → ')}`),
				`${lazy.dependency} must be loaded only through import() (${lazy.reason}). These static import chains reach `
				+ 'it from an entry point. Import its types with `import type`, and take its values from the module that '
				+ 'loads it with import().',
			).toEqual([]);

			// Vacuity, second half: something still loads it, so the empty list above means "only on demand".
			expect(graph.dynamicLoaders, `no module loads ${lazy.dependency} through import() any more`).not.toEqual([]);
		},
	);

	it.each(LAZY_DEPENDENCIES.map((lazy) => [`${lazy.packageDirectory} → ${lazy.dependency}`, lazy] as const))(
		'%s is named only by import() calls inside a try block',
		(_label, lazy) => {
			const directory = resolve(REPO_ROOT, 'packages', lazy.packageDirectory);
			const uses = nonTestSourceFiles(join(directory, 'src')).flatMap((path) => {
				const sourceFile = parseSource(path);

				return specifierUses(sourceFile)
					.filter((use) => packageOf(use.specifier) === lazy.dependency)
					.map((use) => ({
						...use,
						site: `${relative(directory, path)}:${String(sourceFile.getLineAndCharacterOfPosition(use.node.getStart()).line + 1)}`,
					}));
			});

			// Vacuity: the source walk found the loader.
			expect(uses.filter((use) => use.kind === 'dynamic'), `no source module names ${lazy.dependency} in import()`)
				.not.toEqual([]);
			expect(
				uses.filter((use) => use.kind === 'static').map((use) => use.site),
				`${lazy.dependency} is an optional peer, so the declarations a consumer type-checks must not name it: a type `
				+ 'import, even `import type`, is copied into the emitted .d.ts, and an app without the peer then fails with '
				+ '"Cannot find module" under skipLibCheck: false. Declare the type in the package instead.',
			).toEqual([]);
			expect(
				uses.filter((use) => use.kind === 'dynamic' && !isInsideTryBlock(use.node)).map((use) => use.site),
				`An app without ${lazy.dependency} bundles with esbuild and webpack only when this import() sits inside a try `
				+ 'block in its own function, the form both leave for the runtime to reject. Move it into one.',
			).toEqual([]);
		},
	);

	it.each(LAZY_DEPENDENCIES.map((lazy) => [`${lazy.packageDirectory} → ${lazy.dependency}`, lazy] as const))(
		'%s is an optional peer dependency, never a dependency',
		(_label, lazy) => {
			const manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, 'packages', lazy.packageDirectory, 'package.json'), 'utf8')) as LazyManifest;

			expect(
				Object.keys(manifest.dependencies ?? {}),
				`${lazy.dependency} is in dependencies, so every install of the package downloads it. Declare it in `
				+ 'peerDependencies with peerDependenciesMeta optional: true instead.',
			).not.toContain(lazy.dependency);
			expect(
				manifest.peerDependencies?.[lazy.dependency],
				`${lazy.dependency} is not in peerDependencies. Declare it there, so an app that uses it installs a version `
				+ 'in the supported range; if the package no longer uses it, drop its entry here.',
			).toBeDefined();
			expect(
				manifest.peerDependenciesMeta?.[lazy.dependency]?.optional,
				`${lazy.dependency} is a required peer, so every app must install it. Mark it optional in peerDependenciesMeta.`,
			).toBe(true);
			// The package's own tests and the benchmarks still load it, so the workspace installs it.
			expect(
				manifest.devDependencies?.[lazy.dependency],
				`${lazy.dependency} is not in devDependencies, so the workspace does not install it for the package's own tests`,
			).toBe(manifest.peerDependencies?.[lazy.dependency]);
		},
	);
});
