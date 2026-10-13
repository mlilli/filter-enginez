#!/usr/bin/env node

/**
 * version-bump.mjs — Bumps the version field in every package.json across the
 * monorepo to a single unified semver string.
 *
 * Usage:
 *   pnpm version:bump 2.1.0
 *   pnpm version:bump 3.0.0-beta.1
 *
 * The script discovers all workspaces via `pnpm -r list --json --depth=0`,
 * then rewrites each package.json in place. It preserves existing formatting
 * (2-space indent + trailing newline) to keep diffs clean.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Semver regex — supports pre-release tags like 2.0.0-beta.1 */
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;

const newVersion = process.argv[2];

if (!newVersion || !SEMVER_PATTERN.test(newVersion)) {
	console.error('');
	console.error('  Usage: pnpm version:bump <semver>');
	console.error('');
	console.error('  Examples:');
	console.error('    pnpm version:bump 2.1.0');
	console.error('    pnpm version:bump 3.0.0-beta.1');
	console.error('');
	process.exit(1);
}

/** Discover all workspace packages via pnpm */
const packagesJson = execSync('pnpm -r list --json --depth=0', {
	encoding: 'utf8',
});
const packages = JSON.parse(packagesJson);

/** Track results for the summary */
const updatedPackages = [];

for (const pkg of packages) {
	const packageJsonPath = join(pkg.path, 'package.json');

	try {
		const raw = readFileSync(packageJsonPath, 'utf8');
		const parsed = JSON.parse(raw);
		const previousVersion = parsed.version;

		parsed.version = newVersion;

		// Preserve 2-space indent + trailing newline (monorepo convention)
		writeFileSync(packageJsonPath, `${JSON.stringify(parsed, null, 2)}\n`);

		updatedPackages.push({
			name: parsed.name,
			previousVersion,
		});
	} catch (error) {
		// `catch` binds `unknown`, and a thrown non-Error (a string, a rejected value) has no `.message` —
		// reading it blindly would turn a write failure into a confusing "cannot read property of undefined".
		const reason = error instanceof Error ? error.message : String(error);

		console.error(`  Failed to update ${packageJsonPath}: ${reason}`);
		process.exit(1);
	}
}

console.log('');
console.log(`  Bumped ${updatedPackages.length} packages to v${newVersion}:`);
console.log('');

for (const pkg of updatedPackages) {
	console.log(`    ${pkg.name}  ${pkg.previousVersion} → ${newVersion}`);
}

console.log('');
