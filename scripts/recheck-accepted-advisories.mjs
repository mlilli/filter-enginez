#!/usr/bin/env node
/**
 * Re-check the stated precondition of every accepted advisory, against the registry.
 *
 * @remarks
 * Usage: `node scripts/recheck-accepted-advisories.mjs`
 *   Exits **non-zero** when any precondition no longer holds — i.e. when an advisory this repo
 *   suppresses has become fixable and the suppression should be retired.
 *
 * ## Why this exists
 *
 * `auditConfig.ignoreGhsas` makes `pnpm audit` print "All found vulnerabilities were already reviewed
 * and decided to be ignored". That is the right outcome for advisories that genuinely cannot be
 * fixed today — but it has a sharp edge, and the question that exposes it is why a **high** is being
 * hidden at all:
 *
 * 🔴 **Every justification is conditional on a dependency tree that moves, and nothing re-evaluates
 * the conditions.** The re-review triggers in `SECURITY.md` are prose ("re-review when eslint or
 * typedoc moves to minimatch 11"), and no gate evaluates prose. `pnpm audit` cannot tell you the premise expired —
 * suppression is exactly what stops it from mentioning the package at all. So without this script an
 * unfixable high in dev tooling would stay invisible on the day it became fixable, which is the moment
 * you most want to hear about it.
 *
 * ⚠ A suppression can also go inert (the lockfile stops resolving the vulnerable version) or outlive
 * its recorded trigger, and neither produces a failure on its own. **A dormant claim is not a checked
 * one.** This script is the instrument that makes each acceptance falsifiable.
 *
 * ## Why a script rather than a vitest guard
 *
 * It needs the network, which a vitest guard must not — so it is run by hand, and every Monday by
 * `.github/workflows/audit.yml`. The one precondition that needs **no** network (that no math
 * extension is enabled, which is what makes the KaTeX advisory unreachable) is ALSO asserted in
 * `tests/tooling/acceptedAdvisoryParity.test.ts`, because it is the only one a change inside this repo
 * can invalidate, and it is free to check there.
 *
 * 🟢 The division is deliberate: static preconditions are guarded continuously, registry preconditions
 * are re-checked weekly and on demand. Neither is left to memory.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The subset of a registry manifest this script reads.
 *
 * @remarks
 * Declared rather than left implicit because `tsconfig.node.json` type-checks `scripts/**` with
 * `checkJs`, so `response.json()`'s `any` would otherwise spread untyped property access through every
 * precondition.
 *
 * @typedef {object} RegistryManifest
 * @property {string} version - The published version of the `latest` dist-tag.
 * @property {Record<string, string> | undefined} [dependencies] - Runtime deps, when the check needs them.
 */

/**
 * The `latest` dist-tag manifest for a package.
 *
 * @param {string} name - Package name, scoped names included.
 * @returns {Promise<RegistryManifest>} The parsed manifest.
 */
async function latestManifest(name) {
	const url = `https://registry.npmjs.org/${name.replace('/', '%2F')}/latest`;
	const response = await fetch(url);

	if (!response.ok) {
		throw new Error(`registry returned ${String(response.status)} for ${name}`);
	}

	return response.json();
}

/**
 * The names of the packages whose lockfile snapshot depends on `name`, sorted and deduplicated.
 *
 * @remarks
 * Local, no network: it reads `pnpm-lock.yaml`'s `snapshots` section, where each entry lists the
 * versions it resolved for its dependencies. A premise that names the callers of a vulnerable package
 * uses it to notice a new caller, whose options nobody has read yet.
 *
 * @param {string} name - The dependency to look for.
 * @returns {string[]} The dependents' package names.
 */
function lockfileDependents(name) {
	const lockfile = readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8');
	const snapshots = lockfile.slice(lockfile.indexOf('\nsnapshots:\n'));
	const dependents = new Set();
	let current = '';

	for (const line of snapshots.split('\n')) {
		const entry = /^ {2}'?(?<key>@?[^@\s']+)@/u.exec(line);

		if (entry?.groups !== undefined) {
			current = entry.groups['key'] ?? '';
		} else if (line.startsWith(`      ${name}: `) || line.startsWith(`      '${name}': `)) {
			dependents.add(current);
		}
	}

	return [...dependents].sort();
}

/**
 * The accepted advisories and the PRECONDITION each acceptance rests on.
 *
 * @remarks
 * ⚠ This list is held to `auditConfig.ignoreGhsas` and to `SECURITY.md`'s table by
 * `tests/tooling/acceptedAdvisoryParity.test.ts` — all three must name the same GHSA set. Adding a
 * suppression without a precondition here fails that guard, which is the point: an acceptance with no
 * stated, checkable premise is the shape that rots.
 */
const ACCEPTED = [
	{
		// Static — no network. Mirrored in acceptedAdvisoryParity.test.ts, which runs continuously.
		check() {
			const config = readFileSync(join(ROOT, '.markdownlint-cli2.yaml'), 'utf8');
			const enabled = /^\s*(?:math|katex)\s*:/imu.test(config);

			return Promise.resolve({
				action: 'math is now enabled — KaTeX renders, so this acceptance no longer holds',
				detail: `.markdownlint-cli2.yaml ${enabled ? 'ENABLES a math/katex setting' : 'enables no math extension'}`,
				holds: !enabled,
			});
		},
		ghsa: 'GHSA-238p-pmpm-9mq7',
		premise: 'no math extension is enabled, so KaTeX never renders',
		severity: 'low',
	},
	{
		async check() {
			const eslint = await latestManifest('eslint');
			const typedoc = await latestManifest('typedoc');
			// Bracket access, not dotted: `noPropertyAccessFromIndexSignature` is on, and a dotted read of
			// an index-signature key is the error TS4111 that `tsconfig.node.json` exists to catch.
			const eslintRange = eslint.dependencies?.['minimatch'] ?? '(none)';
			const typedocRange = typedoc.dependencies?.['minimatch'] ?? '(none)';
			// Each of these was read for `optimizationLevel`; none sets it, so each runs at the default 1.
			const known = [
				'@eslint/config-array',
				'@typescript-eslint/typescript-estree',
				'eslint',
				'eslint-plugin-jsx-a11y-x',
				'typedoc',
			];
			const dependents = lockfileDependents('minimatch');
			const unread = dependents.filter((dependent) => !known.includes(dependent));
			const pinned = eslintRange.startsWith('^10') && typedocRange.startsWith('^10');
			let action = `${unread.join(', ')} now depend(s) on minimatch — check whether it sets optimizationLevel >= 2`;

			if (dependents.length === 0) {
				action = 'nothing in the lockfile depends on minimatch any more — retire this acceptance';
			} else if (!pinned) {
				action = 'eslint or typedoc moved to another minimatch major — upgrade to a patched one and retire this acceptance';
			}

			return {
				action,
				detail: `eslint@${eslint.version} requires minimatch ${eslintRange}, typedoc@${typedoc.version} requires ${typedocRange}; `
					+ `lockfile dependents: ${dependents.join(', ') || 'none'}`,
				holds: pinned && dependents.length > 0 && unread.length === 0,
			};
		},
		ghsa: 'GHSA-g3hv-75wg-m249',
		premise: 'eslint and typedoc still require minimatch 10, and no caller in the lockfile sets optimizationLevel >= 2',
		severity: 'moderate',
	},
];

const results = [];

for (const entry of ACCEPTED) {
	try {
		results.push({ entry, outcome: await entry.check() });
	} catch (error) {
		results.push({
			entry,
			outcome: {
				action: 'resolve the error above, then re-run — an unverifiable premise is not a held one',
				detail: `check could not run: ${error instanceof Error ? error.message : String(error)}`,
				holds: false,
			},
		});
	}
}

let expired = 0;

for (const { entry, outcome } of results) {
	const mark = outcome.holds ? '✓' : '✗';

	console.log(`${mark} ${entry.ghsa}  (${entry.severity})`);
	console.log(`    premise: ${entry.premise}`);
	console.log(`    checked: ${outcome.detail}`);

	if (!outcome.holds) {
		expired += 1;
		console.log(`    🔴 ACTION: ${outcome.action}`);
	}
}

console.log('');

if (expired > 0) {
	console.error(
		`✗ ${String(expired)} of ${String(ACCEPTED.length)} acceptance(s) no longer hold. Retire them from\n`
		+ '  `auditConfig.ignoreGhsas` in pnpm-workspace.yaml and from SECURITY.md, then re-run `pnpm audit`.',
	);
	process.exit(1);
}

console.log(
	`✓ all ${String(ACCEPTED.length)} acceptance(s) still hold. Update SECURITY.md's "Last reviewed" date.`,
);
