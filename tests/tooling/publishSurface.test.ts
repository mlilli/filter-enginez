/**
 * The 13 engine packages are publishable, and what they publish is built output — not source.
 *
 * @remarks
 * ## What this pins, and why a guard rather than a checklist
 *
 * The obvious way to prove the packaging is to pack the 13 and install the tarballs, and that runs
 * separately. This guard pins, at rest, the manifest properties without which those tarballs are
 * wrong:
 *
 * - a `private: true` package makes publish refuse outright;
 * - an `exports` subpath published as `./src/*.ts` hands consumers raw TypeScript as the entry point;
 * - without a `files` allow-list a tarball carries test files, every tsconfig, `.turbo` cache entries
 *   and both halves of every source map — and 🔴 `mock-data`, whose generated corpus is gitignored but
 *   not npm-ignored, publishes at hundreds of megabytes.
 *
 * ## 🔴 The failure mode this exists for is SILENT
 *
 * The workspace deliberately keeps `exports` pointing at source — that is what lets `tsc --noEmit`,
 * vitest and six dev servers run with no build step in front of them — and the published artifact is
 * corrected by `publishConfig`, which pnpm applies at pack time. **So the thing that must be true of
 * the tarball is invisible in the thing every local gate reads.** Every test, typecheck and dev
 * server would stay green with `publishConfig` deleted, mistyped, or left behind when a new subpath
 * is added to `exports`. The symptom would surface only at a consumer, as an unloadable entry point.
 *
 * That is the same shape as the defect `ruleTypeNamesSurviveMinification` guards: correct in dev,
 * broken in the artifact users get, invisible to a suite that never looks at the artifact. The answer
 * is the same — assert against the thing that ships.
 *
 * ## What it does NOT claim
 *
 * ⚠ It does not verify that pnpm actually performs the override. Nothing here runs pnpm, so that the
 * guard stays runnable where `pnpm install` is not an option (on a constrained machine it strips the
 * `roaring-wasm` and rolldown bindings). pnpm documents `publishConfig.exports` / `.types` as
 * overridable before packing, and confirming the applied result is a separate pack-and-install run. What this guard holds is that the
 * overrides are COMPLETE, point at built output, and point at files that exist.
 *
 * ## Why the roster is a literal
 *
 * Every package in this repository is published; the demo apps and UI packages live in the separate
 * examples repository, which guards its own packages' `private: true`. So a package appearing under
 * `packages/` here is a decision to publish one more thing to npm, and the roster below is where that
 * decision is written down. A glob over `packages/` would make it silently instead — the same reason
 * `scripts/audit-publish-surface.sh` carries the same literal list. The roster case at the bottom
 * fails the day the two disagree.
 *
 * @packageDocumentation
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The 13 engine packages. */
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
 * `eslint`'s `./config` subpath is the one legitimate exception to "published targets live in
 * `dist`".
 *
 * @remarks
 * ⚠ Named explicitly rather than pattern-matched. `src/config/` is hand-written JavaScript — ESLint
 * flat-config modules, not compiled from TypeScript — so it has no `dist` twin by design and the
 * package's `files` list ships it on purpose. 🔴 A rule that rewrote every `./src/` target to
 * `./dist/` would produce `./dist/config/index.js` for this subpath, pointing at a directory that does
 * not exist. One exception recorded as data beats a clever rule that is wrong once.
 */
const SOURCE_SHIPPED_SUBPATHS = new Set(['eslint:./config']);

interface Manifest {
	readonly author?: string;
	readonly bugs?: { readonly url?: string };
	readonly exports?: Readonly<Record<string, unknown>>;
	readonly files?: readonly string[];
	readonly homepage?: string;
	readonly keywords?: readonly string[];
	readonly license?: string;
	readonly name?: string;
	readonly private?: boolean;
	readonly publishConfig?: {
		readonly access?: string;
		readonly exports?: Readonly<Record<string, unknown>>;
		readonly types?: string;
	};
	readonly repository?: {
		readonly directory?: string;
		readonly type?: string;
		readonly url?: string;
	};
}

/**
 * The one repository every published package must point at.
 *
 * @remarks
 * Hard-coded rather than derived from the first manifest, which would make the consistency case
 * below self-satisfying: thirteen packages agreeing on the wrong owner would pass.
 */
const REPOSITORY_URL = 'git+https://github.com/mlilli/filter-enginez.git';

/** Where issues go. Same reasoning as {@link REPOSITORY_URL}. */
const ISSUES_URL = 'https://github.com/mlilli/filter-enginez/issues';

/** Read one package's manifest. */
function manifestFor(name: string): Manifest {
	return JSON.parse(readFileSync(resolve(REPO_ROOT, `packages/${name}/package.json`), 'utf8')) as Manifest;
}

/** Flatten a conditional-exports value to its target strings. */
function targetsOf(value: unknown): readonly string[] {
	if (typeof value === 'string') {
		return [value];
	}
	if (value !== null && typeof value === 'object') {
		return Object.values(value).filter((entry): entry is string => typeof entry === 'string');
	}

	return [];
}

describe.each(ENGINE_PACKAGES)('publish surface — %s', (name) => {
	const manifest = manifestFor(name);

	it('is not private, so publish will not refuse it', () => {
		// `publishConfig` cannot override `private`, so the flag must be absent from the manifest.
		expect(manifest.private, `${name} is private — pnpm publish would refuse it`).toBeUndefined();
	});

	it('🔴 points at the repository, because provenance depends on it', () => {
		// 🔴 NOT COSMETIC. `npm publish` with provenance requires the manifest's `repository` to match
		// the repository the publish runs from, and REFUSES otherwise — so a missing or drifted field
		// does not degrade the npm page, it fails the release. Without the field, provenance is
		// impossible rather than merely absent.
		//
		// ⚠ Provenance is a verifiable link from the published tarball to the exact workflow run that
		// built it, and it is worth MORE to a project nobody has heard of than to an established one,
		// because nobody has any other reason to trust the tarball.
		expect(manifest.repository?.url, `${name} has no repository.url — provenance will refuse to publish`).toBe(
			REPOSITORY_URL,
		);
		expect(manifest.bugs?.url, `${name} has no bugs.url`).toBe(ISSUES_URL);
	});

	it('scopes repository.directory to its own subdirectory', () => {
		// ⚠ The multi-package half of the contract, and the half that is easy to omit because nothing fails
		// without it: npm simply links all 13 pages at the repository ROOT and a reader has to guess
		// which subdirectory is theirs. Asserted per package against the package's own name, so a
		// copy-paste between manifests — the likely way this breaks — is caught rather than inherited.
		expect(manifest.repository?.directory, `${name} has the wrong repository.directory`).toBe(`packages/${name}`);
	});

	it('declares a files allow-list', () => {
		// 🔴 An ALLOW-list, deliberately, and `mock-data` is the argument. npm resolves ignore files
		// package-locally, so the root .gitignore protecting the wine corpus from git does nothing for
		// npm. A deny-list fails OPEN — the next generated artifact ships unless someone
		// remembers to exclude it. This fails CLOSED.
		expect(manifest.files, `${name} has no files allow-list`).toBeDefined();
		expect(manifest.files?.length ?? 0).toBeGreaterThan(0);
	});

	it('ships no source maps', () => {
		// Decided from a measurement rather than a preference. The emitted maps say
		// `sources: ["../src/<file>.ts"]` and carry NO `sourcesContent`, so in a dist-only tarball
		// every map dangles — devtools and editors report "source not found", which is strictly worse
		// than no map at all. 🔴 And `inlineSources: true` cannot rescue it: it embeds source into
		// `.js.map` ONLY, leaving `.d.ts.map` still pointing at a missing file.
		// So shipping maps would force shipping `src/`, and the compiled output here is unbundled,
		// unminified, TypeScript-stripped ESM that reads almost line-for-line like the source anyway.
		for (const pattern of manifest.files ?? []) {
			expect(pattern, `${name}: files includes a map pattern`).not.toMatch(/\.map/u);
		}
	});

	it('declares publishConfig.access so a scoped package is not published restricted', () => {
		expect(manifest.publishConfig?.access).toBe('public');
	});

	it('overrides every exports subpath for publication', () => {
		// The completeness half. Adding a subpath to `exports` without adding its `publishConfig`
		// twin is the regression that every local gate would pass.
		const workspace = Object.keys(manifest.exports ?? {}).sort();
		const published = Object.keys(manifest.publishConfig?.exports ?? {}).sort();

		expect(published, `${name}: publishConfig.exports does not mirror exports`).toStrictEqual(workspace);
	});

	it('publishes built output, never TypeScript source', () => {
		// The correctness half, and the one a consumer would feel: a `.ts` entry point is unloadable
		// in Node and needs non-default config in every bundler.
		for (const [subpath, value] of Object.entries(manifest.publishConfig?.exports ?? {})) {
			if (SOURCE_SHIPPED_SUBPATHS.has(`${name}:${subpath}`)) {
				continue;
			}
			for (const target of targetsOf(value)) {
				expect(target, `${name}${subpath}: published target is TypeScript source`).not.toMatch(
					/^\.\/src\/.*\.tsx?$/u,
				);
			}
		}
	});

	it('publishes targets that exist on disk', () => {
		// Catches a typo in a hand-edited override and a renamed entry point. Depends on `dist` being
		// built, which the repo's own gates already require.
		for (const value of Object.values(manifest.publishConfig?.exports ?? {})) {
			for (const target of targetsOf(value)) {
				const absolute = resolve(REPO_ROOT, `packages/${name}`, target);

				expect(existsSync(absolute), `${name}: published target missing — ${target}`).toBe(true);
			}
		}
	});

	it('names NOTICE.md in files, which npm will not add by itself', () => {
		// 🔴 Apache-2.0 §4(d) requires the NOTICE to travel with the distributed work. npm
		// auto-includes `LICENSE*` and `README*` from a package directory but **not** `NOTICE`, so
		// NOTICE.md has to be named explicitly or the attributions never leave the repo.
		//
		// ⚠ The copies themselves are NOT asserted here. `scripts/sync-licenses.mjs` generates them at
		// release time and `.gitignore` excludes them deliberately — "committing 4 copies × 16 packages
		// would drift silently". Asserting their presence would make this guard fail in any fresh
		// clone, which is how a correct guard gets deleted. The manifest entry is the tracked half, so
		// the manifest entry is what gets guarded.
		expect(manifest.license).toBe('Apache-2.0');
		expect(manifest.files, `${name}: NOTICE.md is not in files`).toContain('NOTICE.md');
	});

	it('carries the registry metadata a package page shows', () => {
		// `repository` / `bugs` are asserted above. `sideEffects` and `engines` are absent on purpose —
		// both are compatibility CLAIMS, and asserting one without measuring it is exactly the failure
		// these guards exist to stop. Left open rather than guessed.
		expect(manifest.author).toBe('Michael Lilli');
		expect(manifest.homepage).toBe('https://filter-enginez.com');
		expect(manifest.keywords?.length ?? 0).toBeGreaterThan(2);
	});
});

describe('publish surface — the workspace root', () => {
	it('🔴 stays private, because the root has no files allow-list', () => {
		// `pnpm pack` at the repo root — the obvious first guess at a pack-and-install check — packs
		// the WORKSPACE ROOT rather than the 13 engine packages: thousands of entries, every document,
		// script and test in the tree, none of it meant to be a package.
		//
		// 🔴 The root carries no `files` allow-list, so `private: true` is the ONLY thing standing
		// between that tarball and npm. Every other case in this file checks a package that SHOULD
		// publish; this is the one that must never. Removing `private` from thirteen package manifests
		// is exactly the frame of mind in which someone removes it from a fourteenth.
		const root = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8')) as Manifest;

		expect(
			root.private,
			'the workspace root must stay private — it has no `files` allow-list, so packing it ships '
			+ 'every document, script and test in the repository',
		).toBe(true);
	});

	it('keeps pack output out of git', () => {
		// A stray `pnpm pack` at the root leaves a multi-megabyte tarball of the whole tree sitting
		// UNTRACKED but committable.
		const ignore = readFileSync(resolve(REPO_ROOT, '.gitignore'), 'utf8');

		expect(ignore, '.gitignore does not exclude pack output').toMatch(/^\*\.tgz$/mu);
	});
});

describe('publish surface — the license-sync mechanism', () => {
	it('every file sync-licenses.mjs names still exists at the repo root', () => {
		// 🔴 `sync-licenses.mjs` copies the root license files into each publishable package at release
		// time, and exits non-zero on the first missing root file. Between releases it does not run, and
		// a mechanism that does not run cannot fail: rename or delete a root license file and nothing
		// notices until the next release dies on a filename nobody recognizes.
		//
		// ⚠ A dormant mechanism is not a tested one. This case is what makes the list falsifiable at
		// rest.
		const source = readFileSync(resolve(REPO_ROOT, 'scripts/sync-licenses.mjs'), 'utf8');
		const declaration = /const LICENSE_FILES = \[(?<list>[^\]]*)\]/u.exec(source);

		expect(declaration?.groups?.['list'], 'LICENSE_FILES not found — has the script moved?').toBeDefined();

		const named = [...(declaration?.groups?.['list'] ?? '').matchAll(/'(?<file>[^']+)'/gu)].map(
			(match) => match.groups?.['file'] ?? '',
		);

		expect(named.length, 'LICENSE_FILES parsed to nothing').toBeGreaterThan(0);

		for (const file of named) {
			expect(existsSync(resolve(REPO_ROOT, file)), `sync-licenses.mjs names a missing root ${file}`).toBe(true);
		}
	});

	it('considers every engine package publishable', () => {
		// `sync-licenses.mjs` selects its targets by `private !== true`, so the `private` flags silently
		// decide which packages get license text. A package that regained `private` would ship without
		// its LICENSE.md and NOTICE.md copies — and, being private, would not ship at all, which the
		// per-package case above reports from the other direction.
		const unlicensed = ENGINE_PACKAGES.filter((name) => manifestFor(name).private === true);

		expect(unlicensed, 'private packages are skipped by sync-licenses.mjs').toStrictEqual([]);
	});
});

describe('publish surface — roster', () => {
	it('covers all 13 engine packages', () => {
		// Vacuity guard. `describe.each` over an empty or truncated roster reports success, so the
		// count is asserted independently: zero packages checked and zero violations are the same
		// exit code.
		expect(ENGINE_PACKAGES).toHaveLength(13);
	});

	it('names exactly the packages that exist, so a new one is a decision rather than an accident', () => {
		// 🔴 Every directory under `packages/` here is published by `changeset publish`, which publishes
		// every workspace package that is not `private`. So a package added here without joining the
		// roster would reach npm unchecked by every case above, and one removed from disk would leave
		// the roster asserting about nothing. Derived from disk in both directions, compared as sets.
		const onDisk = readdirSync(resolve(REPO_ROOT, 'packages'))
			.filter((name) => existsSync(resolve(REPO_ROOT, `packages/${name}/package.json`)))
			.sort();

		expect(onDisk.length, 'no packages found — has packages/ moved?').toBeGreaterThan(0);
		expect(
			onDisk,
			'packages/ and ENGINE_PACKAGES disagree. A package added here is published to npm by the next '
			+ 'release: add it to ENGINE_PACKAGES (and to scripts/audit-publish-surface.sh) deliberately, '
			+ 'or move it to the examples repository.',
		).toStrictEqual([...ENGINE_PACKAGES].sort());
	});
});
