#!/usr/bin/env node
/**
 * Copy the root license + notice files into every publishable package.
 *
 * @remarks
 * **Why this exists.** The repo-root `LICENSE.md` covers the repository, but npm packages are distributed
 * independently — a consumer who installs `@filter-enginez/core` gets a tarball, not a clone, and that tarball has to
 * carry its own license text. The `license` field in `package.json` records the SPDX expression but does not put the
 * text in the tarball.
 *
 * The project is licensed Apache-2.0, so "the text" means two files: `LICENSE.md` and the `NOTICE.md` that carries the
 * Apache-2.0 §4(d) attributions and the trademark and contribution terms.
 *
 * **Why a script rather than committed copies.** Thirteen publishable packages × two files is duplicated legal text to
 * keep in sync by hand, and the failure mode is silent: someone edits the root NOTICE, forgets the copies, and packages
 * ship stale attributions. Generating them at publish time means there is exactly one source of truth. The copies are
 * gitignored (`.gitignore` §"License + notice copies") for the same reason.
 *
 * ⚠ The script reads every `LICENSE_FILES` entry from the repo root and `process.exit(1)`s on the first miss, so a
 * license change that renames or deletes a root file would stop it at release time.
 * `tests/tooling/publishSurface.test.ts` asserts that every file this script names exists at the repo root, so that
 * drift fails in CI on the day it happens instead.
 *
 * Usage: `node scripts/sync-licenses.mjs [--check]`
 *   `--check` reports what WOULD be copied and exits non-zero if anything is missing or stale. For CI and the release
 *   checklist — run it before `pnpm publish -r`, since the copies are gitignored and therefore absent in a fresh clone.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES_DIR = join(ROOT, 'packages');

/**
 * The files every published tarball must carry.
 *
 * @remarks
 * `tests/tooling/publishSurface.test.ts` asserts every entry here exists at the repo root, so a
 * license change cannot leave this list pointing at a deleted file.
 *
 * ⚠ npm auto-includes `LICENSE*` and `README*` from a package directory but **not** `NOTICE`, so
 * `NOTICE.md` also has to be named in each package's `files` array. The guard checks that too.
 */
const LICENSE_FILES = ['LICENSE.md', 'NOTICE.md'];

const isCheckMode = process.argv.includes('--check');

/**
 * Every package directory that would actually be published.
 *
 * @returns Absolute paths to non-private packages.
 */
function publishablePackages() {
	return readdirSync(PACKAGES_DIR)
		.map((name) => join(PACKAGES_DIR, name))
		.filter((dir) => statSync(dir).isDirectory())
		.filter((dir) => {
			try {
				return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).private !== true;
			} catch {
				return false;
			}
		});
}

/**
 * Files that DO travel alongside the copy, so a repo-relative link to them still resolves.
 *
 * @remarks
 * `LICENSE.md` is itself synced into every package and named in every `files` array, so
 * `[LICENSE.md](./LICENSE.md)` is correct inside a tarball. Nothing else in the repo is.
 */
const CO_LOCATED = new Set(['./LICENSE.md']);

/**
 * Rewrite repo-relative markdown links that will not resolve from a package directory.
 *
 * @remarks
 * 🔴 **Consumer-facing.** The root `NOTICE.md` links files such as `[CONTRIBUTING.md](./CONTRIBUTING.md)`
 * — correct at the repo root, dead one directory down, and **the target ships in no tarball.** Copied
 * verbatim, every published package would carry a NOTICE with links pointing at nothing (and
 * `tests/tooling/docLinks.test.ts` reports each one as a dead link).
 *
 * 🟢 Flattened to the link label (inline code) rather than rewritten to a URL. A link into a
 * repository is meaningless inside a tarball that has no repository around it, and naming the path as
 * text is the honest rendering.
 *
 * @param {string} body - The root file's contents.
 * @returns {string} The same text with non-co-located relative links flattened.
 */
function flattenRepoRelativeLinks(body) {
	return body.replaceAll(
		/\[(?<label>[^\]]+)\]\((?<target>\.\/[^)]+)\)/gu,
		(match, label, target) => (CO_LOCATED.has(target) ? match : label),
	);
}

const sources = LICENSE_FILES.map((name) => {
	try {
		return { body: flattenRepoRelativeLinks(readFileSync(join(ROOT, name), 'utf8')), name };
	} catch {
		console.error(`✗ missing root ${name} — cannot sync licenses`);
		process.exit(1);
	}
});

const targets = publishablePackages();
const stale = [];

for (const dir of targets) {
	for (const { body, name } of sources) {
		const dest = join(dir, name);
		let current = null;

		try {
			current = readFileSync(dest, 'utf8');
		} catch {
			// Absent — counts as stale.
		}

		if (current === body) {
			continue;
		}
		if (isCheckMode) {
			stale.push(`${dir.replace(`${ROOT}/`, '')}/${name}`);
		} else {
			writeFileSync(dest, body);
		}
	}
}

if (targets.length === 0) {
	console.log('✓ no publishable packages (all private) — nothing to sync');
	process.exit(0);
}

if (isCheckMode && stale.length > 0) {
	console.error(`✗ ${stale.length} license file(s) missing or stale:\n   ${stale.join('\n   ')}`);
	console.error('   run: node scripts/sync-licenses.mjs');
	process.exit(1);
}

console.log(
	isCheckMode
		? `✓ license files present and current in ${targets.length} package(s)`
		: `✓ synced ${LICENSE_FILES.length} license file(s) into ${targets.length} package(s)`,
);
