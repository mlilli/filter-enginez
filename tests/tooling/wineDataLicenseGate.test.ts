/**
 * The real-wine importer must not download anything until its data license is accepted.
 *
 * @remarks
 * `packages/mock-data/scripts/import-kaggle-wine.mjs` fetches the Kaggle "Wine Reviews" dataset, which
 * is CC BY-NC-SA 4.0 (non-commercial, share-alike) and carries WineEnthusiast's review text — unlike
 * the Apache-2.0 code around it. The script prints those terms and refuses to fetch or read the cached
 * CSV unless it is run with `--accept-data-license` (or `FILTER_ENGINEZ_ACCEPT_DATA_LICENSE=1`).
 *
 * Two checks, because each catches what the other cannot:
 *
 * - **Behavior:** run the script with no acceptance and assert it exits non-zero, prints the license,
 *   and says it is not downloading. The gate returns before any network or file access, so this is
 *   offline and fast.
 * - **Order:** inside `main()`, the acceptance check must come before the first `fetchCsv()` call. A
 *   refactor that moved the fetch above the gate would still print the notice and still exit 1 — after
 *   the download had already happened.
 *
 * @packageDocumentation
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const IMPORTER = resolve(REPO_ROOT, 'packages/mock-data/scripts/import-kaggle-wine.mjs');

describe('the real-wine importer license gate', () => {
	it('refuses to download without --accept-data-license, and says why', () => {
		const environment: NodeJS.ProcessEnv = { ...process.env };

		delete environment['FILTER_ENGINEZ_ACCEPT_DATA_LICENSE'];

		const run = spawnSync(process.execPath, [IMPORTER], { encoding: 'utf8', env: environment, timeout: 15_000 });

		expect(run.status, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`).toBe(1);
		expect(run.stdout).toContain('CC BY-NC-SA 4.0');
		expect(run.stdout).toContain('NON-COMMERCIAL');
		expect(run.stderr).toContain('Not downloading');
	});

	it('checks acceptance before the first fetch in main()', () => {
		const source = readFileSync(IMPORTER, 'utf8');
		const mainBody = source.slice(source.indexOf('async function main()'));
		const gateAt = mainBody.indexOf('hasAcceptedDataLicense()');
		const fetchAt = mainBody.indexOf('fetchCsv()');

		expect(gateAt, 'no acceptance check found in main()').toBeGreaterThan(-1);
		expect(fetchAt, 'no fetchCsv() call found in main() — did the importer change shape?').toBeGreaterThan(-1);
		expect(gateAt, 'main() fetches before it checks the license').toBeLessThan(fetchAt);
	});
});
