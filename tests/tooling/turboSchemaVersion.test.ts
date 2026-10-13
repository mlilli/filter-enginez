/**
 * `turbo.json`'s `$schema` URL is a second copy of the installed Turborepo version.
 *
 * @remarks
 * The URL is version-PINNED — `https://v2-11-7.turborepo.dev/schema.json`, not a floating `latest` —
 * so it has to move with every bump. Left behind it validates the config against the previous
 * release's schema, which is the quiet kind of wrong: an editor stops flagging a key the installed
 * binary has started rejecting, or flags one it has started accepting. Nothing fails; the feedback
 * just becomes fiction.
 *
 * **It is carried by hand on every bump**, which is exactly the case for the rule that data
 * duplicated on purpose has to be pinned.
 *
 * ## Read from `node_modules`, not from `package.json`
 *
 * The range in `package.json` is a caret range, and a caret range is not a version: after any install
 * that resolves a newer patch, the range and the installed binary legitimately disagree. What the
 * schema has to match is **what actually runs**, so this reads `node_modules/turbo/package.json`.
 *
 * That does mean the case is only as honest as the install — but a stale `node_modules` makes every
 * other gate lie too, and the alternative (asserting against the caret range) would pass while the
 * schema described a release nobody has.
 *
 * @packageDocumentation
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The `$schema` URL exactly as `turbo.json` declares it. */
function declaredSchemaUrl(): string {
	const config = JSON.parse(readFileSync(resolve(REPO_ROOT, 'turbo.json'), 'utf8')) as { $schema?: string };

	return config.$schema ?? '';
}

/** The version actually installed in `node_modules`. */
function installedTurboVersion(): string {
	const require = createRequire(import.meta.url);
	const manifest = JSON.parse(
		readFileSync(require.resolve('turbo/package.json', { paths: [REPO_ROOT]}), 'utf8'),
	) as { version: string };

	return manifest.version;
}

describe('turbo.json $schema', () => {
	it('names the INSTALLED turbo version', () => {
		// The whole point. `v2-11-7` ⇄ `2.11.7`.
		const installed = installedTurboVersion();

		expect(declaredSchemaUrl()).toContain(`v${installed.replaceAll('.', '-')}`);
	});

	it('is version-pinned rather than floating', () => {
		// A `latest` URL would satisfy nothing above and quietly retire this guard, so the SHAPE is
		// asserted separately from the value. If Turborepo ever ships a stable unversioned schema,
		// deleting this file is the right move — leaving it and loosening the regex is not.
		expect(declaredSchemaUrl()).toMatch(/^https:\/\/v\d+-\d+-\d+\.turborepo\.dev\/schema\.json$/u);
	});

	it('keeps the package.json range compatible with what is installed', () => {
		// Weaker than the two above, deliberately: a caret range cannot pin a version. What it CAN
		// catch is the bump that edits the schema URL and the lockfile while forgetting the range —
		// which would leave the old range able to resolve something the schema does not describe.
		const rootManifest = JSON.parse(
			readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'),
		) as { devDependencies: Record<string, string> };
		// Bracket access, not dot: `noPropertyAccessFromIndexSignature` is on, and the value came out
		// of a `Record<string, string>`.
		const range = rootManifest.devDependencies['turbo'] ?? '';

		expect(range).toBe(`^${installedTurboVersion()}`);
	});
});
