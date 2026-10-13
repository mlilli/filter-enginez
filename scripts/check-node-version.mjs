/**
 * Fail fast, and legibly, when the active Node is older than `.nvmrc` pins.
 *
 * @remarks
 * This exists because of a specific bad failure mode. `.nvmrc` pins a version but nothing enforces it,
 * so a shell that hasn't run `nvm use` silently runs whatever Node it defaults to. Everything works
 * until it doesn't: a tool deep in the pipeline refuses to start below its own minimum, or a newer
 * built-in is missing, and the error it prints names neither Node nor the version it needs. The real
 * cause is buried in a `[WARN]` line pnpm printed before any of it scrolled past.
 *
 * So: check up front, say exactly what's wrong and exactly what to type. Note `nvm install` (not just
 * `nvm use`) is the instruction, because `nvm use` fails silently-ish when the pinned version isn't
 * installed at all, which leaves you on the old one wondering why nothing changed.
 *
 * @packageDocumentation
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Parse a `vX.Y.Z` / `X.Y.Z` string into comparable parts.
 *
 * @param {string} raw - A version string, with or without a leading `v`.
 * @returns {number[]} `[major, minor, patch]`, with missing segments defaulting to 0.
 */
function parseVersion(raw) {
	return raw
		.trim()
		.replace(/^v/, '')
		.split('.')
		.map((part) => Number.parseInt(part, 10) || 0);
}

/**
 * Compare two parsed versions.
 *
 * @param {number[]} a - Left version parts.
 * @param {number[]} b - Right version parts.
 * @returns {number} Negative when `a < b`, 0 when equal, positive when `a > b`.
 */
function compare(a, b) {
	for (let i = 0; i < 3; i += 1) {
		const diff = (a[i] ?? 0) - (b[i] ?? 0);

		if (diff !== 0) {
			return diff;
		}
	}

	return 0;
}

const required = parseVersion(readFileSync(join(repoRoot, '.nvmrc'), 'utf8'));
const actual = parseVersion(process.version);

if (compare(actual, required) < 0) {
	const wanted = required.join('.');

	process.stderr.write(
		`\n  ✘ Node ${process.version} is too old — this repo pins v${wanted} in .nvmrc.\n\n`
			+ '    Tools in the build, lint and test pipeline can fail below their own minimum with\n'
			+ '    errors that never mention Node.\n\n'
			+ '    Fix:  nvm install && nvm use\n\n'
			+ '    (`nvm install` reads .nvmrc and installs the pin if it is missing; `nvm use` alone\n'
			+ '     does nothing when the version was never installed.)\n\n',
	);
	process.exit(1);
}
