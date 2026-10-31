/**
 * Every runtime dependency a package declares is imported by that package's shipped source.
 *
 * @remarks
 * ## Why this exists
 *
 * A package's `dependencies` are installed into every app that installs the package, and a supply-chain review
 * reads each one as code the app trusts. A dependency nothing imports costs that trust, the download and the audit
 * surface, and buys nothing, and no other check here notices it: the build, the types and every suite stay green
 * whether or not the manifest lists a package the code stopped using. So this guard reads each package's non-test
 * source and fails for any `dependencies` entry none of it imports, naming the package and the fix.
 *
 * ## What counts
 *
 * "Imported" means named by a module specifier anywhere in a source file under `src/`: an import or re-export
 * declaration (type-only ones included, since a type that reaches the emitted declarations needs its package
 * installed), `import()` and `require()` calls, `import x = require()`, and `import('x').T` type references. A
 * subpath import (`pkg/sub`) counts for `pkg`. Test files (`*.test.*`, `*.spec.*`) and `test-support/` directories
 * are left out, because they are not built into `dist`: a package only tests use belongs in `devDependencies`.
 *
 * Only `dependencies` are checked. A peer dependency is the consuming app's to install, and a dev dependency
 * never reaches a consumer.
 *
 * ## Vacuity
 *
 * The cases assert that the walk found the packages, that they declare a plausible number of runtime dependencies
 * between them, and that every package with any runtime dependency had source to read.
 *
 * @packageDocumentation
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { nonTestSourceFiles, packageOf, parseSource, specifierUses } from './support/packageSources.js';
import { REPO_ROOT } from './support/repoFiles.js';

/** One package under `packages/`, with what it declares and what its shipped source imports. */
interface PackageImports {
	/** The package's `dependencies`, by name. */
	readonly dependencies: readonly string[];
	/** The package directory, relative to the repo root. */
	readonly directory: string;
	/** Every bare specifier its non-test source names, reduced to a package name. */
	readonly importedPackages: ReadonlySet<string>;
	/** The package's npm name. */
	readonly name: string;
	/** How many non-test source files were read. */
	readonly sourceFileCount: number;
}

/**
 * Read one package: its declared runtime dependencies and the packages its non-test source imports.
 *
 * @param directory - The package directory, absolute.
 * @returns What it declares and imports.
 */
function readPackage(directory: string): PackageImports {
	const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as {
		readonly dependencies?: Readonly<Record<string, string>>;
		readonly name: string;
	};
	const files = nonTestSourceFiles(join(directory, 'src'));
	const importedPackages = new Set(
		files.flatMap((path) => specifierUses(parseSource(path))).map((use) => packageOf(use.specifier)).filter((name) => name !== undefined),
	);

	return {
		dependencies: Object.keys(manifest.dependencies ?? {}),
		directory: relative(REPO_ROOT, directory),
		importedPackages,
		name: manifest.name,
		sourceFileCount: files.length,
	};
}

const PACKAGES: readonly PackageImports[] = readdirSync(resolve(REPO_ROOT, 'packages'), { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => readPackage(resolve(REPO_ROOT, 'packages', entry.name)));

describe('runtime dependencies', () => {
	it('finds the packages and their dependencies, so the check below is not vacuous', () => {
		expect(PACKAGES.length, 'packages under packages/').toBeGreaterThanOrEqual(13);
		expect(
			PACKAGES.reduce((total, pkg) => total + pkg.dependencies.length, 0),
			'runtime dependencies declared across the packages',
		).toBeGreaterThanOrEqual(20);
		for (const pkg of PACKAGES.filter((candidate) => candidate.dependencies.length > 0)) {
			expect(pkg.sourceFileCount, `${pkg.directory}: no non-test source read under src/`).toBeGreaterThan(0);
		}
	});

	it.each(PACKAGES.map((pkg) => [pkg.name, pkg] as const))('%s imports every one of its dependencies', (_name, pkg) => {
		const unused = pkg.dependencies.filter((dependency) => !pkg.importedPackages.has(dependency));

		expect(
			unused,
			`${pkg.directory}/package.json declares these in dependencies, but no non-test source under `
			+ `${pkg.directory}/src imports them. Every install of ${pkg.name} downloads them for nothing: remove them, `
			+ 'or move them to devDependencies if only tests use them.',
		).toStrictEqual([]);
	});
});
