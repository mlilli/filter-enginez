/**
 * From the repository root, `react` resolves to React 19 — the React the lint rules are written for.
 *
 * @remarks
 * `@eslint-react` reads the React version from `react` as it resolves from the current directory,
 * and turns its React 19 rules off below 19. Inside a package (how `pnpm lint` runs, per package)
 * that is the package's own React 19. From the repository root — how the pre-commit hook's
 * lint-staged runs `eslint --fix` — the root had no `react` of its own, so the lookup fell through to
 * `NODE_PATH`, which pnpm's `.bin` shims point at the hidden hoist (`node_modules/.pnpm/node_modules`).
 * Once `compat/react18` joined the workspace, the hoist held its React 18.3.1: the hook then saw React
 * 18, found the `eslint-disable` comments for the React 19 rules unused, and deleted them in the
 * commit, and CI's per-package lint failed on the lines they had covered.
 *
 * The root's own `react` devDependency (with `@types/react` beside it, for the documentation's compiled
 * blocks, which resolve React's types from the root) is what the lookup now finds first. This guard holds it there:
 * the root manifest declares React 19, and that is what resolves — with `NODE_PATH` pointed at the
 * hidden hoist, as the shims set it.
 *
 * @packageDocumentation
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The `react` range the root manifest declares, if any. */
function declaredRootReact(): string | undefined {
	const manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8')) as {
		devDependencies?: Readonly<Record<string, string>>;
	};

	return manifest.devDependencies?.['react'];
}

/**
 * The React version a `require('react')` from the repository root finds, the way `@eslint-react`
 * looks it up, run in a child process with `NODE_PATH` set as pnpm's `.bin` shims set it.
 */
function reactVersionFromRoot(): string {
	return execFileSync(
		process.execPath,
		['-e', 'process.stdout.write(require("module").createRequire(process.cwd() + "/")("react").version)'],
		{ cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, NODE_PATH: resolve(REPO_ROOT, 'node_modules/.pnpm/node_modules') }},
	);
}

describe('react from the repository root', () => {
	it('is a root devDependency on React 19', () => {
		expect(declaredRootReact(), 'the root package.json needs its own `react` (19) for lint-staged\'s ESLint').toMatch(/^\^19\./u);
	});

	it('resolves to React 19 even with the hidden hoist on NODE_PATH', () => {
		expect(reactVersionFromRoot()).toMatch(/^19\./u);
	});
});
