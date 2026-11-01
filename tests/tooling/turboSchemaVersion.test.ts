/**
 * `turbo.json`'s `$schema` is the schema of the INSTALLED Turborepo, by construction.
 *
 * @remarks
 * Turborepo ships its config schema inside its own package, so `turbo.json` points at
 * `./node_modules/turbo/schema.json` rather than at a version-pinned URL. A pinned URL
 * (`https://v2-11-8.turborepo.dev/schema.json`) was a second copy of the installed version that every
 * bump had to carry by hand, and a dependency-update pull request bumps `package.json` and the
 * lockfile but never `turbo.json`; left behind, the editor validates the config against the previous
 * release's schema, and nothing fails. The local path cannot fall behind: it is whatever `turbo` the
 * lockfile installed.
 *
 * So the guard checks the path rather than a version: the declared `$schema` is exactly the local one,
 * and the file it names is the schema of the `turbo` package that resolves from the repository root.
 *
 * @packageDocumentation
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The only `$schema` value `turbo.json` may declare: the schema that ships inside the installed package. */
const LOCAL_SCHEMA = './node_modules/turbo/schema.json';

/** The `$schema` value exactly as `turbo.json` declares it. */
function declaredSchema(): string {
	const config = JSON.parse(readFileSync(resolve(REPO_ROOT, 'turbo.json'), 'utf8')) as { $schema?: string };

	return config.$schema ?? '';
}

/** The directory of the `turbo` package that resolves from the repository root. */
function installedTurboDirectory(): string {
	const require = createRequire(import.meta.url);

	return dirname(require.resolve('turbo/package.json', { paths: [REPO_ROOT]}));
}

/** The version of that installed package. */
function installedTurboVersion(): string {
	const manifest = JSON.parse(readFileSync(resolve(installedTurboDirectory(), 'package.json'), 'utf8')) as {
		version: string;
	};

	return manifest.version;
}

describe('turbo.json $schema', () => {
	it('points at the schema inside the installed turbo package', () => {
		expect(declaredSchema(), `turbo.json's $schema must be "${LOCAL_SCHEMA}", so it moves with every turbo bump`).toBe(
			LOCAL_SCHEMA,
		);
	});

	it('names a file that is the installed package\'s own schema', () => {
		const declaredFile = resolve(REPO_ROOT, LOCAL_SCHEMA);

		expect(existsSync(declaredFile), `${LOCAL_SCHEMA} does not exist; the turbo package no longer ships it`).toBe(true);
		expect(realpathSync(declaredFile)).toBe(realpathSync(resolve(installedTurboDirectory(), 'schema.json')));
	});

	it('keeps the package.json range compatible with what is installed', () => {
		// A caret range cannot pin a version. What this CAN catch is a bump that moves the lockfile while
		// forgetting the range, which would leave the old range able to resolve a turbo nobody tested.
		const rootManifest = JSON.parse(
			readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'),
		) as { devDependencies: Record<string, string> };
		// Bracket access, not dot: `noPropertyAccessFromIndexSignature` is on, and the value came out
		// of a `Record<string, string>`.
		const range = rootManifest.devDependencies['turbo'] ?? '';

		expect(range).toBe(`^${installedTurboVersion()}`);
	});
});
