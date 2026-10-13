/**
 * No shipped module uses a NAMED import from a CommonJS-only dependency.
 *
 * @remarks
 * ## The defect
 *
 * `lz-string@1.5.0` is CommonJS with no `exports` map, no `module` field and no `type`. Node's
 * `cjs-module-lexer` cannot statically detect its named exports, so this throws at load:
 *
 * ```ts
 * import { compressToEncodedURIComponent } from 'lz-string';
 * // SyntaxError: Named export 'compressToEncodedURIComponent' not found. The requested module
 * // 'lz-string' is a CommonJS module, which may not support all module.exports as named exports.
 * ```
 *
 * `packages/url-state-router/src/serializers.ts` imports `lz-string`; written that way, it would make
 * `@filter-enginez/url-state-router/serializers` **impossible to import from Node at all**.
 *
 * ## 🔴 Why no other gate catches it
 *
 * **Vite, Rolldown and vitest all interop CJS named imports for you.** So the verticals build and run,
 * the unit and e2e suites pass, `tsc` is happy — TypeScript resolves the types from
 * `lz-string/typings`, which say nothing about module format — and the only environment that fails is
 * a plain Node ESM consumer, which only a pack-and-install import test exercises.
 *
 * 🟢 **That is the same shape as the defect `ruleTypeNamesSurviveMinification` guards**: correct in
 * dev, broken in the artifact users get, invisible to a suite that never exercises the artifact. The
 * remedy is the same — assert the property statically, so it cannot regress between pack-and-install
 * runs.
 *
 * ## 🔴 The obvious fix breaks a different host, which bounds what this guard is worth
 *
 * Replacing the named import with a plain DEFAULT import breaks a SvelteKit consumer under SSR:
 *
 * ```text
 * TypeError: Cannot destructure property 'compressToEncodedURIComponent' of
 * '__vite_ssr_import_0__.default' as it is undefined
 * ```
 *
 * Vite's SSR transform hands back a namespace whose named exports are present and whose `default`
 * is not, so the default import resolves to `undefined` and every SSR route in that app returns
 * 500. The working form is a namespace import with a `.default` fallback, which satisfies Node ESM
 * and Vite SSR at once; `serializers.ts` carries the three-way comparison.
 *
 * ⚠ **So this guard sees one of the two failure modes, and the cheaper one.** A named import is
 * statically detectable, which is what makes it guardable here. A default import that resolves to
 * `undefined` at runtime is not — it is well-typed, it is the documented remedy for the first
 * failure, and only actually loading the module in an SSR host reveals it. That is `pnpm test:e2e`'s
 * job, and nothing cheaper does it.
 *
 * 🟢 Hence the failure message prescribes the namespace form rather than the default form. A guard
 * confidently handing out the wrong fix is worse than one that stays silent, because it is believed.
 *
 * ## What counts as CJS-only
 *
 * Derived from the INSTALLED package, not from a hardcoded list: a dependency is CJS-only when its
 * manifest has no `type: "module"`, no `exports` map and no `module` field. 🟢 Deriving it means a
 * dependency that later ships ESM stops being flagged automatically, with no edit here — and a NEW
 * CJS-only dependency is covered the day it is added.
 *
 * ⚠ Test files are out of scope. `serializers.test.ts` still uses the named form, deliberately: it
 * runs under vitest, which interops, and it imports `lz-string` directly rather than through our
 * module, so it is not exercising the shipped import path either way. The guard is about what ships.
 *
 * @packageDocumentation
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The 13 engine packages — the ones whose source is published. */
const ENGINE_PACKAGES = [
	'core',
	'reactive-signals',
	'reactive-rxjs',
	'react-signals',
	'react-rxjs',
	'svelte-signals',
	'vue-signals',
	'angular-rxjs',
	'redux-bridge',
	'url-state-router',
	'worker-bridge',
	'eslint',
	'mock-data',
] as const;

/**
 * Locate an installed dependency's manifest.
 *
 * @remarks
 * Scans pnpm's virtual store. ⚠ That is a layout assumption, and an acceptable one: `packageManager`
 * pins pnpm, and `ruleTypeNamesSurviveMinification` already reads `node_modules` directly for the same
 * kind of reason. `require.resolve(`${dep}/package.json`)` was the alternative and is worse here — a
 * package with an `exports` map can legally refuse that subpath, so the resolution failure would be
 * ambiguous between "not installed" and "has an exports map", which is precisely the distinction this
 * guard turns on.
 *
 * @param dependency - Package name, scoped names included.
 * @returns The parsed manifest, or `undefined` when it is not installed.
 */
function installedManifest(dependency: string): Record<string, unknown> | undefined {
	const store = resolve(REPO_ROOT, 'node_modules/.pnpm');

	if (!existsSync(store)) {
		return undefined;
	}

	for (const entry of readdirSync(store)) {
		const candidate = join(store, entry, 'node_modules', dependency, 'package.json');

		if (existsSync(candidate)) {
			return JSON.parse(readFileSync(candidate, 'utf8')) as Record<string, unknown>;
		}
	}

	return undefined;
}

/**
 * Every runtime dependency declared by the 13, paired with whether it is CJS-only.
 *
 * @returns Dependency names that are unsafe to name-import.
 */
function cjsOnlyDependencies(): readonly string[] {
	const names = new Set<string>();

	for (const name of ENGINE_PACKAGES) {
		const manifest = JSON.parse(
			readFileSync(resolve(REPO_ROOT, `packages/${name}/package.json`), 'utf8'),
		) as { dependencies?: Record<string, string> };

		for (const dependency of Object.keys(manifest.dependencies ?? {})) {
			if (!dependency.startsWith('@filter-enginez/')) {
				names.add(dependency);
			}
		}
	}

	return [...names].filter((dependency) => {
		const manifest = installedManifest(dependency);

		if (manifest === undefined) {
			return false; // not installed — cannot classify, so do not accuse
		}

		return manifest['type'] !== 'module' && manifest['exports'] === undefined && manifest['module'] === undefined;
	});
}

/**
 * Blank out comments, so prose about an import is not mistaken for one.
 *
 * @remarks
 * 🔴 **The code this guard protects quotes the form it forbids.** `serializers.ts` explains itself by
 * quoting the broken form — `import { compressToEncodedURIComponent } from 'lz-string'` — inside a
 * comment, and a matcher over raw text would read that as code. Prose about an import is the commonest
 * false positive for a guard that scans source.
 *
 * ⚠ **Deliberately NOT extracted to `support/`.** This repository has two copies of this helper —
 * here and in `scripts/lib/tarball-import-closure.mjs` — and the other is a plain `.mjs` script that
 * cannot import a TypeScript test helper without a build step. Two copies on either side of that
 * boundary is below the three-strikes threshold, so the duplication stays.
 *
 * @param source - File contents.
 * @returns The same source with block and line comments removed.
 */
function withoutComments(source: string): string {
	return source.replaceAll(/\/\*[\s\S]*?\*\//gu, '').replaceAll(/^\s*\/\/[^\n]*/gmu, '');
}

/** Shipped source files — `src/**`, excluding tests. */
function shippedSources(): readonly string[] {
	const found: string[] = [];

	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir)) {
			if (entry === 'node_modules' || entry === 'dist') {
				continue;
			}

			const path = join(dir, entry);
			let isDirectory = false;

			try {
				isDirectory = statSync(path).isDirectory();
			} catch {
				continue;
			}
			if (isDirectory) {
				walk(path);
				continue;
			}
			if (/\.(test|spec)\.[cm]?[jt]sx?$/u.test(path)) {
				continue;
			}
			if (/\.[cm]?[jt]sx?$/u.test(path)) {
				found.push(path);
			}
		}
	};

	for (const name of ENGINE_PACKAGES) {
		const source = resolve(REPO_ROOT, `packages/${name}/src`);

		if (existsSync(source)) {
			walk(source);
		}
	}

	return found;
}

describe('no named imports from CommonJS-only dependencies', () => {
	const cjsOnly = cjsOnlyDependencies();
	const sources = shippedSources();

	it('classified some dependencies and found some sources', () => {
		// Vacuity guard, and it needs the specific case as well as the counts: if `node_modules` is
		// absent or the store layout changes, `cjsOnly` goes empty and the main case passes over
		// everything. `lz-string` is the known CJS-only dependency and the reason this file exists, so
		// its presence is what proves the classifier still works.
		expect(sources.length, 'no shipped sources found — has packages/<name>/src moved?').toBeGreaterThan(100);
		expect(
			cjsOnly,
			'lz-string is not classified CJS-only — either it shipped ESM (good: simplify serializers.ts '
			+ 'back to a named import) or the classifier is broken (bad: this guard is asserting nothing)',
		).toContain('lz-string');
	});

	it('avoids a named import for every CommonJS-only dependency', () => {
		const offenders: string[] = [];

		for (const file of sources) {
			const source = withoutComments(readFileSync(file, 'utf8'));

			for (const dependency of cjsOnly) {
				// A named import is `import { … } from 'dep'`. A default import, a namespace import and a
				// bare side-effect import are all fine — only the braces are the hazard.
				const named = new RegExp(
					`import\\s*\\{[^}]*\\}\\s*from\\s*['"]${dependency.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}['"]`,
					'u',
				);

				if (named.test(source)) {
					offenders.push(`${relative(REPO_ROOT, file)} name-imports CJS-only '${dependency}'`);
				}
			}
		}

		expect(
			offenders,
			'a named import from a CommonJS-only package throws in Node ESM. ⚠ Do NOT reach for a plain '
			+ "default import: `import pkg from '…'` resolves to undefined under Vite's SSR runtime. "
			+ "Use `import * as mod from '…'` then "
			+ '`(mod as { default?: typeof mod }).default ?? mod`; serializers.ts carries the full reasoning. '
			+ 'Bundlers hide BOTH failures, so no other gate here will tell you.',
		).toStrictEqual([]);
	});
});
