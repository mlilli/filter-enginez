/**
 * Every suppressed advisory is justified in `SECURITY.md`, and nothing is justified that is not
 * suppressed.
 *
 * @remarks
 * ## Why this pair drifts
 *
 * `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml` is the machine half: a list of GHSA IDs that
 * `pnpm audit` stops reporting. `SECURITY.md`'s "Accepted advisories" table is the human half: why
 * each one is acceptable, and what event should trigger a re-review. **Only the machine half has any
 * effect**, so the human half is free to rot — and an accepted advisory whose reasoning nobody can
 * read is indistinguishable from an advisory nobody noticed.
 *
 * 🔴 It drifts in both directions:
 *
 * - **A suppression outlives its fix.** An entry's recorded re-review trigger fires — say, the
 *   devDependency that pulled in the vulnerable line moves off it — and the suppression stays,
 *   because nothing prompts the check.
 * - **A suppression goes inert.** The lockfile no longer resolves any vulnerable version, so the
 *   entry suppresses nothing. The only symptom is `pnpm audit` counting fewer ignored advisories than
 *   the list holds — an off-by-one in a summary line nobody is obliged to read.
 *
 * ⚠ **An ignore that matches nothing is worse than useless.** It is a standing claim that some risk
 * was weighed, and it keeps being true-looking after the risk is gone, which is exactly how the next
 * reviewer learns to skim the list instead of reading it.
 *
 * ## What this can and cannot check
 *
 * It asserts the two lists are the SAME SET, which is the part that is checkable at rest. It cannot
 * tell whether a justification is still *true* — that needs a resolved dependency tree and a live
 * advisory database, which is `pnpm audit`'s job and runs outside this suite. So this guard makes
 * drift between the two files impossible and leaves the judgement where judgement belongs.
 *
 * 🟢 The division matters: a guard that tried to re-derive "is this still exploitable" would be
 * asserting against a moving target and would fail for reasons unrelated to the repo. This one fails
 * only when a human edited one file and forgot the other.
 *
 * @packageDocumentation
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Any GHSA identifier.
 *
 * @remarks
 * 🔴 **Two patterns, one source, deliberately.** A `/g/`-flagged regex carries `lastIndex` between
 * `exec` calls, so reusing a single global pattern inside a `.map()` resumes each search where the
 * previous row left off and silently skips alternate matches — reporting a `SECURITY.md` row as
 * missing when it is plainly there.
 *
 * ⚠ `matchAll` is unaffected (it clones the regex), so the hazard is asymmetric: it hides in whichever
 * function uses `exec`. Keeping the global form only where iteration needs it makes the hazard
 * structural rather than remembered.
 */
const GHSA_PATTERN_SOURCE = 'GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}';

/** Stateful by design — used only with `matchAll`, which does not share `lastIndex`. */
const ALL_GHSA = new RegExp(GHSA_PATTERN_SOURCE, 'gu');

/** Stateless — safe to reuse across single-line `exec` calls. */
const ONE_GHSA = new RegExp(GHSA_PATTERN_SOURCE, 'u');

/**
 * The GHSA IDs `pnpm audit` is told to suppress.
 *
 * @remarks
 * Read from the `ignoreGhsas` block by text rather than by parsing the YAML, because
 * `pnpm-workspace.yaml` is 200 lines of load-bearing prose around a handful of settings and the
 * surrounding comments mention retired IDs on purpose. Scoping to the block is what keeps a
 * *comment* about a retired advisory from reading as an active suppression — the same
 * prose-versus-declaration distinction `docblockWrapInWorkerOptions` makes.
 *
 * @returns The suppressed IDs, in file order.
 */
function suppressedIds(): readonly string[] {
	const source = readFileSync(resolve(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8');
	const block = /^auditConfig:\n(?<body>(?:[ \t]+.*\n?)+)/mu.exec(source);

	expect(block?.groups?.['body'], 'auditConfig block not found in pnpm-workspace.yaml').toBeDefined();

	return [...(block?.groups?.['body'] ?? '').matchAll(ALL_GHSA)].map((match) => match[0]);
}

/**
 * The GHSA IDs whose PRECONDITION is re-checkable by `scripts/recheck-accepted-advisories.mjs`.
 *
 * @remarks
 * The third place a suppression has to appear, and the one that makes an acceptance falsifiable rather
 * than merely explained. `ignoreGhsas` is what pnpm obeys, `SECURITY.md` is the human reasoning, and
 * the script holds the machine-checkable premise — "braces has no published fix", "no math extension is
 * enabled" — so the day a premise expires, something exits non-zero.
 *
 * 🔴 Requiring all three is what keeps a suppression from going dormant. A suppression whose recorded
 * trigger has fired, or one that suppresses nothing, produces no failure anywhere on its own, because
 * a no-op cannot fail. **A dormant claim is not a checked one.** An acceptance with no stated,
 * checkable premise is the shape that rots, so the guard refuses to let one exist.
 *
 * @returns The IDs the recheck script covers, in file order.
 */
function recheckedIds(): readonly string[] {
	const source = readFileSync(resolve(REPO_ROOT, 'scripts/recheck-accepted-advisories.mjs'), 'utf8');
	const table = /const ACCEPTED = \[(?<body>[\s\S]*?)\n\];/u.exec(source);

	expect(table?.groups?.['body'], 'ACCEPTED table not found in recheck-accepted-advisories.mjs').toBeDefined();

	return [...(table?.groups?.['body'] ?? '').matchAll(ALL_GHSA)].map((match) => match[0]);
}

/**
 * The GHSA IDs justified in `SECURITY.md`'s accepted-advisories table.
 *
 * @remarks
 * Table rows only — a row starts with `| [GHSA-`. The prose beneath the table deliberately names
 * RETIRED advisories so the record of why they went survives, and counting those would make the
 * guard demand that every retired entry be re-suppressed, which is backwards.
 *
 * @returns The justified IDs, in file order.
 */
function justifiedIds(): readonly string[] {
	return readFileSync(resolve(REPO_ROOT, 'SECURITY.md'), 'utf8')
		.split('\n')
		.filter((line) => line.startsWith('| [GHSA-'))
		.map((line) => ONE_GHSA.exec(line)?.[0] ?? '')
		.filter((id) => id !== '');
}

describe('accepted advisories — all three records agree', () => {
	const suppressed = suppressedIds();
	const justified = justifiedIds();
	const rechecked = recheckedIds();

	it('found entries in all three places, so the comparison has subjects', () => {
		// Vacuity guard. Empty lists are equal to each other, so the cases below pass loudest when they
		// are measuring nothing — a renamed heading, a reformatted table, a moved `auditConfig` block,
		// a restructured `ACCEPTED` array.
		expect(suppressed.length, 'no suppressed GHSA IDs parsed — has auditConfig moved?').toBeGreaterThan(0);
		expect(justified.length, 'no justified GHSA rows parsed — has the table moved?').toBeGreaterThan(0);
		expect(rechecked.length, 'no rechecked GHSA IDs parsed — has the ACCEPTED table moved?').toBeGreaterThan(0);
	});

	it('every suppression has a re-checkable precondition', () => {
		// 🔴 The case that answers "is it safe to hide a high?" — only if something will un-hide it.
		// `pnpm audit` cannot tell you a premise expired; suppression is precisely what stops it from
		// mentioning the package. So each acceptance must also appear in the recheck script, which fails
		// on the day its premise dies.
		const unchecked = suppressed.filter((id) => !rechecked.includes(id));
		const stale = rechecked.filter((id) => !suppressed.includes(id));

		expect(
			unchecked,
			'suppressed with no precondition in recheck-accepted-advisories.mjs — add one, or do not suppress it',
		).toStrictEqual([]);
		expect(
			stale,
			'the recheck script still carries a precondition for something no longer suppressed — drop it',
		).toStrictEqual([]);
	});

	it('suppresses exactly what it justifies', () => {
		// Set equality, reported as two directed differences so the failure says WHICH way it drifted:
		// a new suppression nobody documented, or a justification for something no longer suppressed
		// (a suppression that outlived its fix).
		const undocumented = suppressed.filter((id) => !justified.includes(id));
		const orphaned = justified.filter((id) => !suppressed.includes(id));

		expect(
			undocumented,
			'suppressed in pnpm-workspace.yaml but not justified in SECURITY.md — add a table row',
		).toStrictEqual([]);
		expect(
			orphaned,
			'justified in SECURITY.md but no longer suppressed — move it to the Retired prose instead',
		).toStrictEqual([]);
	});

	it('lists each advisory once', () => {
		// A duplicate is harmless to pnpm and corrosive to the record: two rows can disagree, and the
		// reviewer has no way to know which one was updated.
		expect(new Set(suppressed).size, 'duplicate GHSA in ignoreGhsas').toBe(suppressed.length);
		expect(new Set(justified).size, 'duplicate GHSA row in SECURITY.md').toBe(justified.length);
		expect(new Set(rechecked).size, 'duplicate GHSA in the ACCEPTED table').toBe(rechecked.length);
	});

	it('keeps the KaTeX acceptance true by keeping math disabled', () => {
		// The one precondition that needs no network, mirrored here because it is the only one a change
		// INSIDE this repo can invalidate — and it would invalidate it silently. Enabling a math
		// extension in `.markdownlint-cli2.yaml` makes KaTeX render, at which point "the vulnerable code
		// never executes" stops being true and GHSA-238p-pmpm-9mq7 must be re-decided rather than
		// inherited. The registry-dependent preconditions live only in the script, which needs the
		// network a unit test must not depend on.
		const config = readFileSync(resolve(REPO_ROOT, '.markdownlint-cli2.yaml'), 'utf8');

		expect(
			/^\s*(?:math|katex)\s*:/imu.test(config),
			'a math/katex setting appeared in .markdownlint-cli2.yaml — GHSA-238p-pmpm-9mq7 was accepted '
			+ 'on the grounds that KaTeX never runs, so that acceptance needs re-deciding',
		).toBe(false);
	});

	it('records a re-review date in SECURITY.md', () => {
		// Every entry's justification is conditional on a dependency tree that moves. The date is what
		// tells a reader whether the reasoning was checked against this month's tree or last quarter's.
		const security = readFileSync(resolve(REPO_ROOT, 'SECURITY.md'), 'utf8');

		expect(security, 'no "Last reviewed <date>" line near the accepted-advisories table').toMatch(
			/Last reviewed \d{4}-\d{2}-\d{2}/u,
		);
	});
});
