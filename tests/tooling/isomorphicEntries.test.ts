/**
 * Every isomorphic package's default entry loads in plain Node, with no DOM.
 *
 * @remarks
 * The isomorphic contract (`docs/architecture.md` §1.1) is enforced in two layers. Lint
 * (`@filter-enginez/no-browser-api-in-core`, enabled by the `nodeIsomorphic` ESLint preset) rejects
 * a browser global in source. This test is the runtime layer: it imports each package's `"."`
 * export in the Node test environment — no `window`, no `document`, no `localStorage` — so a
 * module that touches a browser API at load time, directly or through a dependency, fails here
 * rather than in a consumer's server render or edge function.
 *
 * The package list is derived, not hard-coded: every package whose `eslint.config.js` applies the
 * `nodeIsomorphic` preset is isomorphic by declaration, so a new one is covered the day it opts in.
 * A vacuity guard asserts the list is non-empty and that each import yields exports.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PACKAGES_DIR = resolve(REPO_ROOT, 'packages');

/** Packages whose ESLint config applies the `nodeIsomorphic` preset. */
const ISOMORPHIC_PACKAGES: readonly string[] = readdirSync(PACKAGES_DIR).filter((name) => {
	const configPath = resolve(PACKAGES_DIR, name, 'eslint.config.js');

	return existsSync(configPath) && readFileSync(configPath, 'utf8').includes('nodeIsomorphic');
}).sort();

/** The source file a package's `"."` export points at (exports point at source in this repo). */
function defaultEntry(name: string): string {
	const manifest = JSON.parse(readFileSync(resolve(PACKAGES_DIR, name, 'package.json'), 'utf8')) as {
		readonly exports: Readonly<Record<string, string>>;
	};
	const entry = manifest.exports['.'];

	if (entry === undefined) {
		throw new Error(`packages/${name}/package.json has no "." export`);
	}

	return resolve(PACKAGES_DIR, name, entry);
}

describe('isomorphic default entries load in plain Node', () => {
	it('finds the isomorphic packages (vacuity guard)', () => {
		expect(ISOMORPHIC_PACKAGES).toEqual(expect.arrayContaining(['core', 'reactive-rxjs', 'reactive-signals', 'redux-bridge']));
	});

	it('runs without DOM globals', () => {
		expect('window' in globalThis).toBe(false);
		expect('document' in globalThis).toBe(false);
		expect('localStorage' in globalThis).toBe(false);
	});

	it.each(ISOMORPHIC_PACKAGES)('imports @filter-enginez/%s', async (name) => {
		const module = (await import(pathToFileURL(defaultEntry(name)).href)) as Record<string, unknown>;

		expect(Object.keys(module).length, `@filter-enginez/${name} exported nothing`).toBeGreaterThan(0);
	});
});
