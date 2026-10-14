/**
 * Every version the release workflow publishes carries an npm provenance attestation.
 *
 * @remarks
 * Provenance can only be attached at publish time, so a version that ships without it stays that way.
 * Two halves keep it attached:
 *
 * - **The request.** pnpm publishes natively (since v11) and reads only `pnpm_config_*` environment
 *   variables, so an `NPM_CONFIG_PROVENANCE` setting is silently ignored. `release.yml` must ask with
 *   `PNPM_CONFIG_PROVENANCE`, and must not carry any `NPM_CONFIG_*` variable that looks like it does
 *   something.
 * - **The check.** After a publish, `scripts/verify-provenance.mjs` asks the registry for each version the
 *   run published and fails the run when one has no SLSA provenance attestation. Its cases run here
 *   against a local stand-in registry.
 *
 * The check is wired to the Changesets action's `published` and `published-packages` outputs, which are
 * `changesets/action@v2`'s names; v1 called the list `publishedPackages`. An expression that reads an
 * output the action does not set gets an empty string, so a stale `published` name skips the check
 * without a word. That is why the action major is pinned here, together with the `@changesets/cli` major
 * that action v2 requires: it refuses to run against CLI 2.x.
 *
 * @packageDocumentation
 */

import type { AddressInfo } from 'node:net';

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOW = readFileSync(resolve(REPO_ROOT, '.github/workflows/release.yml'), 'utf8');
const ROOT_MANIFEST = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8')) as {
	devDependencies?: Record<string, string>;
};
const SCRIPT = resolve(REPO_ROOT, 'scripts/verify-provenance.mjs');

const SLSA = 'https://slsa.dev/provenance/v1';
const PUBLISH_ONLY = 'https://github.com/npm/attestation/tree/main/specs/publish/v0.1';

/** What the stand-in registry answers for each `name@version`; anything else is a 404. */
const ATTESTATIONS: Readonly<Record<string, readonly string[]>> = {
	'@scope/publish-only@1.0.0': [PUBLISH_ONLY],
	'@scope/with-provenance@1.0.0': [PUBLISH_ONLY, SLSA],
};

let registry: Server;
let registryUrl = '';

/**
 * Run the script against the stand-in registry.
 *
 * @param published - The `published-packages` value the release step would pass.
 * @returns The exit code and combined output.
 */
async function verify(published: readonly { name: string; version: string }[]): Promise<{ code: number; output: string }> {
	return new Promise((resolvePromise) => {
		execFile(
			process.execPath,
			[SCRIPT],
			{
				env: {
					...process.env,
					NPM_REGISTRY: registryUrl,
					PROVENANCE_RETRY_DELAY_MS: '10',
					PROVENANCE_TIMEOUT_MS: '50',
					PUBLISHED_PACKAGES: JSON.stringify(published),
				},
			},
			(error, stdout, stderr) => {
				resolvePromise({ code: error === null ? 0 : Number(error.code ?? 1), output: `${stdout}${stderr}` });
			},
		);
	});
}

beforeAll(async () => {
	registry = createServer((request, response) => {
		const key = decodeURIComponent((request.url ?? '').replace('/-/npm/v1/attestations/', ''));
		const types = ATTESTATIONS[key];

		if (types === undefined) {
			response.writeHead(404).end();

			return;
		}
		response.writeHead(200, { 'content-type': 'application/json' });
		response.end(JSON.stringify({ attestations: types.map((predicateType) => ({ predicateType })) }));
	});
	await new Promise<void>((resolvePromise) => {
		registry.listen(0, '127.0.0.1', resolvePromise);
	});
	registryUrl = `http://127.0.0.1:${String((registry.address() as AddressInfo).port)}`;
});

afterAll(async () => {
	await new Promise((resolvePromise) => {
		registry.close(resolvePromise);
	});
});

describe('release.yml asks for provenance in a way pnpm reads', () => {
	it('sets PNPM_CONFIG_PROVENANCE on the publish step', () => {
		expect(WORKFLOW).toMatch(/^ {10}PNPM_CONFIG_PROVENANCE: "true"$/mu);
	});

	it('carries no NPM_CONFIG_* variable, which pnpm ignores', () => {
		expect(WORKFLOW.match(/^\s+NPM_CONFIG_\w+:/gmu) ?? []).toStrictEqual([]);
	});

	it('verifies provenance after every publish, from the publish step’s own output', () => {
		expect(WORKFLOW).toContain("if: steps.changesets.outputs.published == 'true'");
		expect(WORKFLOW).toContain('run: node scripts/verify-provenance.mjs');
		expect(WORKFLOW).toContain('PUBLISHED_PACKAGES: ${{ steps.changesets.outputs.published-packages }}');
	});

	it('runs changesets/action v2, the major whose output names the step above reads', () => {
		expect(WORKFLOW, 'output names change with the action major: update the wiring and this test together').toMatch(
			/^ {8}uses: changesets\/action@v2$/mu,
		);
	});

	it('pairs the action with @changesets/cli 3, the only CLI major action v2 runs against', () => {
		expect(
			ROOT_MANIFEST.devDependencies?.['@changesets/cli'],
			'move @changesets/cli and changesets/action across majors in one change',
		).toMatch(/^\^3\./u);
	});
});

describe('verify-provenance.mjs', () => {
	it('passes when every published version has a SLSA provenance attestation', async () => {
		const { code, output } = await verify([{ name: '@scope/with-provenance', version: '1.0.0' }]);

		expect(code, output).toBe(0);
	});

	it('fails when a version has only the publish attestation', async () => {
		const { code, output } = await verify([
			{ name: '@scope/with-provenance', version: '1.0.0' },
			{ name: '@scope/publish-only', version: '1.0.0' },
		]);

		expect(code).toBe(1);
		expect(output).toContain('@scope/publish-only@1.0.0');
		expect(output).not.toContain('• @scope/with-provenance');
	});

	it('fails when the registry has no attestations for a version', async () => {
		const { code, output } = await verify([{ name: '@scope/unknown', version: '1.0.0' }]);

		expect(code).toBe(1);
		expect(output).toContain('@scope/unknown@1.0.0');
	});

	it('fails on an empty list rather than verifying nothing', async () => {
		const { code, output } = await verify([]);

		expect(code).toBe(1);
		expect(output).toContain('PUBLISHED_PACKAGES is empty');
	});
});
