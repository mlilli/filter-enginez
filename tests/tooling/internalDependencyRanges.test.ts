/**
 * Every `@filter-enginez/*` dependency inside this workspace is declared `workspace:^`.
 *
 * @remarks
 * `pnpm pack` rewrites a workspace protocol into a real range in the published manifest:
 * `workspace:^` becomes `^<version>` and `workspace:*` becomes the exact `<version>`. The bindings
 * depend on `@filter-enginez/core` directly, and `core` relies on `instanceof` (rule classes, the
 * `FilterEngineError` hierarchy), so two installed copies of it break quietly at runtime. An exact pin
 * produces that second copy whenever an app's own `core` differs from a binding's by a single patch;
 * a caret range lets the package manager settle on one.
 *
 * Every field is held to the rule, `devDependencies` included, so the convention is one rule with no
 * exceptions to remember. `scripts/pack-engine-tarballs.sh` checks the other half: that the PACKED
 * manifests carry caret ranges.
 *
 * A sibling named only in `peerDependencies` is also declared in `devDependencies`. Turborepo orders
 * `^build` by `dependencies`, `devDependencies` and `optionalDependencies`, not peers, so a peer-only
 * sibling is not built before the dependent's `typecheck` — which then fails on a fresh clone, where no
 * `dist` exists yet, while passing on any machine that has built once.
 *
 * @packageDocumentation
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The dependency fields a manifest can declare a sibling in. */
const DEPENDENCY_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies'] as const;

type Manifest = Partial<Record<(typeof DEPENDENCY_FIELDS)[number], Readonly<Record<string, string>>>>;

/** Every manifest in the workspace: the root, `benchmarks/`, and each package under `packages/`. */
const MANIFESTS: readonly string[] = [
	'package.json',
	'benchmarks/package.json',
	...readdirSync(resolve(REPO_ROOT, 'packages'), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => `packages/${entry.name}/package.json`),
];

/** Each `@filter-enginez/*` declaration, as `{ site, spec }`. */
const DECLARATIONS = MANIFESTS.flatMap((path) => {
	const manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, path), 'utf8')) as Manifest;

	return DEPENDENCY_FIELDS.flatMap((field) =>
		Object.entries(manifest[field] ?? {})
			.filter(([name]) => name.startsWith('@filter-enginez/'))
			.map(([name, spec]) => ({ site: `${path} ${field} ${name}`, spec })),
	);
});

describe('internal dependency ranges', () => {
	it('finds the internal dependencies, so the check below is not vacuous', () => {
		expect(MANIFESTS.length).toBeGreaterThanOrEqual(15);
		expect(DECLARATIONS.length).toBeGreaterThanOrEqual(30);
	});

	it('also declares every @filter-enginez/* peer dependency as a devDependency', () => {
		const peerOnly = MANIFESTS.flatMap((path) => {
			const manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, path), 'utf8')) as Manifest;

			return Object.keys(manifest.peerDependencies ?? {})
				.filter((name) => name.startsWith('@filter-enginez/') && manifest.devDependencies?.[name] === undefined)
				.map((name) => `${path}: ${name}`);
		});

		expect(peerOnly, `add these to devDependencies so turbo builds them first:\n${peerOnly.join('\n')}`).toEqual([]);
	});

	it('declares every @filter-enginez/* dependency as workspace:^', () => {
		const wrong = DECLARATIONS.filter(({ spec }) => spec !== 'workspace:^').map(({ site, spec }) => `${site}: ${spec}`);

		expect(wrong, `use workspace:^ (packs as a caret range):\n${wrong.join('\n')}`).toEqual([]);
	});
});
