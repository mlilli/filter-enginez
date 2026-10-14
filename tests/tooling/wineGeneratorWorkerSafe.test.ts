/**
 * `@filter-enginez/mock-data/wine/generator` loads in a browser Web Worker and computes the same
 * records in every JavaScript engine.
 *
 * @remarks
 * The demos generate the 150k wine tier inside a worker, so this sub-export's import graph is a
 * browser boundary. Lint already rejects browser globals in `mock-data` (`nodeIsomorphic`); this
 * guard covers what lint cannot see:
 *
 * - **Every module on the path is inside the package.** It walks the static imports reachable from
 *   `src/wine/generator.ts`: no `node:` built-in, no third-party package, no dynamic `import()`, no
 *   top-level `await`, and none of the corpus loaders, MSW handlers or filter config.
 * - **No engine-dependent math.** Engines may disagree in the last bit of `Math.exp`, `Math.log`,
 *   `Math.cos` or `**`, which would change a record wherever a value lands on a rounding boundary;
 *   the generator uses its own series instead (`src/wine/generate-math.ts`), and only the
 *   integer-exact helpers of the shared random module.
 * - **The sub-export is published**, from source in the workspace and from `dist` in the tarball.
 *
 * The walk asserts its own reach (it must find the generator and its statistics tables), so a
 * parser that silently stopped following imports fails here instead of passing. It lives in the
 * `tooling` project because reading files needs Node types, which the isomorphic package must not
 * have.
 */

import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PACKAGE_ROOT = resolve(REPO_ROOT, 'packages/mock-data');
const ENTRY = resolve(PACKAGE_ROOT, 'src/wine/generator.ts');

/** Source with block comments and whole-line comments removed, so prose cannot satisfy or trip a check. */
function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
}

/** Every static import and re-export specifier in a module's source. */
function staticSpecifiers(source: string): string[] {
	return [...stripComments(source).matchAll(/^(?:import|export)\s[^;]*?\sfrom\s+'([^']+)'/gmu)].map((match) => match[1] ?? '');
}

/** The import graph reachable from an entry module. */
interface ImportGraph {
	/** Specifiers that are not relative paths, with the module that imports each. */
	readonly external: readonly string[];
	/** Reachable modules (absolute paths) and their sources. */
	readonly modules: ReadonlyMap<string, string>;
}

/**
 * Walk the static imports reachable from `entry`.
 *
 * @param entry - Absolute path of the entry module.
 * @returns The reachable modules and every non-relative specifier found.
 */
function importGraph(entry: string): ImportGraph {
	const modules = new Map<string, string>();
	const external: string[] = [];
	const pending = [entry];

	while (pending.length > 0) {
		const file = pending.pop() ?? '';

		if (modules.has(file)) {
			continue;
		}

		const source = readFileSync(file, 'utf8');

		modules.set(file, source);
		for (const specifier of staticSpecifiers(source)) {
			if (specifier.startsWith('.')) {
				pending.push(resolve(dirname(file), specifier.replace(/\.js$/u, '.ts')));
			} else {
				external.push(`${relative(REPO_ROOT, file)} imports ${specifier}`);
			}
		}
	}

	return { external, modules };
}

describe('the worker-safe wine generator sub-export', () => {
	const graph = importGraph(ENTRY);
	const names = [...graph.modules.keys()].map((file) => relative(PACKAGE_ROOT, file));

	it('reaches the generator and its tables (vacuity guard)', () => {
		expect(names).toEqual(expect.arrayContaining([
			'src/wine/generate.ts',
			'src/wine/generate-math.ts',
			'src/wine/generate-origins.ts',
			'src/wine/generate-profile.ts',
			'src/wine/generate-text.ts',
			'src/tier-sizes.ts',
		]));
	});

	it('imports only relative modules inside the package: no node: built-ins, no packages', () => {
		expect(graph.external, 'a module on the worker path imports a package or a built-in').toStrictEqual([]);
		for (const name of names) {
			expect(name.startsWith('src/'), name).toBe(true);
		}
	});

	it('loads no corpus loader, MSW handler or filter config', () => {
		for (const forbidden of ['src/wine/corpusLoaders.ts', 'src/wine/data.ts', 'src/wine/handlers.ts', 'src/wine/filter-config.ts', 'src/handler-factory.ts']) {
			expect(names, forbidden).not.toContain(forbidden);
		}
	});

	it('does no dynamic import, top-level await or environment access', () => {
		for (const [file, source] of graph.modules) {
			const code = stripComments(source);

			expect(code, `${file}: dynamic import`).not.toMatch(/\bimport\s*\(/u);
			expect(code, `${file}: top-level await`).not.toMatch(/^(?:export\s+)?(?:const|let)\s[^=]*=\s*await\s|^await\s/mu);
			expect(code, `${file}: process or require`).not.toMatch(/\b(?:process|require)\s*[.(]/u);
		}
	});

	it('calls no math function whose last bit varies between engines', () => {
		const wineModules = [...graph.modules].filter(([file]) => relative(PACKAGE_ROOT, file).startsWith('src/wine/'));

		expect(wineModules.length, 'vacuity: the wine modules on the path').toBeGreaterThan(5);
		for (const [file, source] of wineModules) {
			const code = stripComments(source).replace(/'[^'\n]*'|`[^`\n]*`/gu, "''");

			expect(code, file).not.toMatch(/Math\.(?:a?cosh?|a?sinh?|a?tanh?|atan2|cbrt|exp|expm1|hypot|log|log10|log1p|log2|pow)\b|\*\*/u);
		}
	});

	it('uses only the integer-exact helpers of the shared random module', () => {
		// `_generation/random.ts` also serves the other datasets, and its `normalSample` uses
		// `Math.log` and `Math.cos`. The wine generator must stay off it.
		const portableHelpers = new Set(['mulberry32', 'pickOne', 'randomInt', 'SeededRng', 'slugify']);
		const imported = [...graph.modules.values()]
			.flatMap((source) => [...stripComments(source).matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\.\/_generation\/random\.js'/gu)])
			.flatMap((match) => (match[1] ?? '').split(',').map((name) => name.replace(/\btype\b/u, '').trim()).filter((name) => name.length > 0));

		expect(imported.length, 'vacuity: the random helpers in use').toBeGreaterThan(0);
		for (const name of imported) {
			expect(portableHelpers.has(name), `${name} is not on the portable list`).toBe(true);
		}
	});

	it('is published as its own sub-export', () => {
		const manifest = JSON.parse(readFileSync(resolve(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
			readonly exports: Readonly<Record<string, string>>;
			readonly publishConfig: { readonly exports: Readonly<Record<string, unknown>> };
		};

		expect(manifest.exports['./wine/generator']).toBe('./src/wine/generator.ts');
		expect(manifest.publishConfig.exports['./wine/generator']).toStrictEqual({
			default: './dist/wine/generator.js',
			types: './dist/wine/generator.d.ts',
		});
	});
});
