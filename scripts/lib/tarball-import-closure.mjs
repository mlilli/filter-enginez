#!/usr/bin/env node
/**
 * Resolve a packed tarball's import closure, and report what is missing.
 *
 * @remarks
 * Invoked by `scripts/pack-engine-tarballs.sh` with two environment variables:
 *   `DIR`     — the extracted `package/` directory
 *   `LISTING` — the tarball's file list, one `package/...` path per line
 *
 * Prints `{ missing, optional, reachable }` as JSON.
 *
 * **Why this check earns its place.** A packed manifest can name `./dist/index.js` perfectly while
 * the `files` allow-list quietly excluded a module that `index.js` imports. The tarball then installs
 * cleanly and throws on the consumer's first import — the failure mode an allow-list makes possible
 * and a manifest read cannot see.
 *
 * 🔴 **Static and dynamic imports are reported SEPARATELY, and that distinction is the whole
 * subtlety.** A static import runs at load, so an unresolved one is a break. A dynamic import may be
 * deliberately optional: `mock-data`'s `corpusLoaders` does `await import('./data-real-default.json')`
 * inside a try/catch that falls back to `null`, because the corpora deliberately ship with the
 * generators and not as data (716 MB -> 0.17 MB). Collapsing the two would report that design
 * decision as a defect on every run, which is how a correct check gets switched off.
 *
 * ⚠ Comments are stripped before scanning. Without it, `core`'s `@example` line
 * `import { MinTagMatchRule } from './custom-rules'` and `worker-bridge`'s
 * `import WineWorker from './wine.worker.ts?worker'` would both read as real imports and be reported
 * as missing modules. A comment can DESCRIBE an import and can never BE one.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

/** The extracted `package/` directory. Required; the caller always sets it. */
const root = process.env['DIR'] ?? '';
const listing = new Set((process.env['LISTING'] ?? '').split('\n').filter(Boolean));

if (root === '' || listing.size === 0) {
	process.stderr.write('tarball-import-closure: DIR and LISTING are both required\n');
	process.exit(2);
}

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// 🔴 Strip comments FIRST. A docblock `@example` is prose about an import and can never be one.
// Without it, core's `import { MinTagMatchRule } from './custom-rules'` example and
// worker-bridge's `import WineWorker from './wine.worker.ts?worker'` both read as real imports.
/**
 * Blank out block and line comments.
 *
 * @param {string} source - File contents.
 * @returns {string} The same source with comments removed.
 */
const withoutComments = (source) =>
	source.replaceAll(/\/\*[\s\S]*?\*\//gu, '').replaceAll(/^\s*\/\/[^\n]*/gmu, '');

const entries = Object.values(manifest.exports ?? {})
	.flatMap((v) => (typeof v === 'string' ? [v] : Object.values(v)))
	.filter((t) => t.endsWith('.js'));

const missing = [];
const optional = [];
const seen = new Set();
const queue = entries.map((e) => e.replace(/^\.\//u, ''));

while (queue.length) {
	const rel = normalize(queue.pop());

	if (seen.has(rel)) {
		continue;
	}
	seen.add(rel);
	if (!listing.has(`package/${rel}`)) {
		missing.push(rel); continue;
	}
	let src;

	try {
		src = withoutComments(readFileSync(join(root, rel), 'utf8'));
	} catch {
		continue;
	}

	// Static imports MUST resolve — they run at load.
	for (const m of src.matchAll(/(?:^|[\s;}])(?:import|export)[^'"]*?from\s*['"](\.[^'"]+)['"]/gu)) {
		const raw = m[1];

		// `noUncheckedIndexedAccess` makes a capture group `string | undefined`, and
		// `tsconfig.node.json` type-checks this directory with `checkJs`.
		if (raw !== undefined) {
			queue.push(normalize(join(dirname(rel), raw)));
		}
	}
	// Dynamic imports are reported separately: mock-data's corpora are deliberately absent and the
	// loaders fall back to null by design, so an unresolved one is a design choice, not a break.
	for (const m of src.matchAll(/import\(\s*['"](\.[^'"]+)['"]\s*\)/gu)) {
		const raw = m[1];

		if (raw === undefined) {
			continue;
		}

		const target = normalize(join(dirname(rel), raw));

		if (!listing.has(`package/${target}`)) {
			optional.push(target);
		}
	}
}
process.stdout.write(JSON.stringify({ missing, optional: [...new Set(optional)], reachable: seen.size }));
