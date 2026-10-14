/**
 * Every workflow that installs dependencies runs with the commit hooks switched off.
 *
 * @remarks
 * `pnpm install` runs the `prepare` script, which installs the Husky hooks in `.husky/` — in CI as well
 * as on a laptop, because CI checkouts are git repositories too. A workflow that then commits or pushes
 * with git (the release action does, when set to `push-with-git-cli`) would run the hooks, and the
 * pre-push hook is the full coverage suite, once per push. `HUSKY: "0"` at the workflow level turns the
 * hooks off for every step.
 *
 * Read as TEXT: these are properties of literal files humans edit.
 *
 * @packageDocumentation
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WORKFLOWS_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), '../../.github/workflows');

/** Each workflow file that runs `pnpm install`, with its text. */
const INSTALLING_WORKFLOWS = readdirSync(WORKFLOWS_DIRECTORY)
	.filter((file) => /\.ya?ml$/u.test(file))
	.map((file) => ({ file, text: readFileSync(resolve(WORKFLOWS_DIRECTORY, file), 'utf8') }))
	.filter(({ text }) => text.includes('pnpm install'));

/** A top-level `env:` block that sets `HUSKY: "0"` among its entries. */
const TOP_LEVEL_HUSKY_OFF = /^env:\n(?: {2}\S.*\n)*? {2}HUSKY: "0"$/mu;

describe('workflows disable the commit hooks', () => {
	it('finds the installing workflows, so the check below is not vacuous', () => {
		expect(INSTALLING_WORKFLOWS.length).toBeGreaterThanOrEqual(1);
	});

	for (const { file, text } of INSTALLING_WORKFLOWS) {
		it(`${file} sets HUSKY: "0" at the workflow level`, () => {
			expect(text).toMatch(TOP_LEVEL_HUSKY_OFF);
		});
	}
});
