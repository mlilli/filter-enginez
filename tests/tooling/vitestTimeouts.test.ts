/**
 * The suite's timeout budgets, asserted against the config that declares them.
 *
 * @remarks
 * This repo's `mock-data` generates real corpora: the wine full tier is 150k records (about 130 MB as
 * JSON, generated in about a second), and a locally imported real corpus is 8.6 MB (default tier) and
 * 116 MB (full tier) of JSON to parse. Most suites that import one of them live in the examples
 * repository, which pins the same floor; this repo keeps it because any engine suite that loads a
 * corpus has the same exposure. Vitest's default per-test budget is 5s, which is sized for I/O-free unit tests and is
 * not enough for a corpus parse.
 *
 * ### The failure this pins
 *
 * A test that calls `loadWineCorpus()` — a dynamic import of the 8.6 MB default tier — from inside
 * its body pays that cost against the per-test budget: **about 2.1 s** in isolation, a margin of
 * barely 2.3x against the 5s default. A full parallel run competing for CPU closes that gap, and the
 * result is an intermittent timeout in a suite that passes on its own.
 *
 * A corpus importer that loads at module top level is safe only by accident of structure — the cost
 * lands in file-import time and counts against no test. Move that load into a test body or a
 * `beforeAll` and the same flake appears there.
 *
 * ### Why this file rather than trusting the comment in the config
 *
 * A generous timeout looks like slack. It reads as something to tighten during a cleanup pass, and
 * the failure it prevents is intermittent and appears in a file nobody was editing — so the person
 * who reverts it will not connect the two. The config carries the full rationale; this makes
 * removing it fail immediately and loudly instead of three weeks later on someone else's branch.
 *
 * Asserted as a FLOOR, not an equality: raising the budget further is always safe, and pinning an
 * exact value would turn a harmless increase into a failing gate.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * The floor both budgets must clear, in ms.
 *
 * @remarks
 * Well above the ~2.1 s a corpus import takes in isolation, because the point is headroom rather than a tuned fit — the
 * corpora are regenerable (`pnpm regen:mock-data:full`) and a budget sized to today's numbers is a
 * budget that breaks the next time they grow.
 */
const MINIMUM_TIMEOUT_MS = 20_000;

/** The root Vitest config, read as text — the invariant is about what it DECLARES. */
const configSource = readFileSync(resolve(REPO_ROOT, 'vitest.config.ts'), 'utf8');

/**
 * Read a numeric option off the config source, tolerating numeric separators.
 *
 * @remarks
 * Parsed from source rather than imported: importing the config would evaluate it and hand back
 * resolved defaults, so a DELETED option would read as whatever Vitest fills in — which is exactly
 * the deletion this file exists to catch. Text is the honest source here.
 *
 * @param option - The option name, e.g. `testTimeout`.
 * @returns The declared value in ms, or `null` when the option is absent.
 */
function declaredTimeout(option: string): number | null {
	const match = new RegExp(`^\\s*${option}:\\s*([0-9_]+)\\s*,`, 'mu').exec(configSource);

	if (match?.[1] === undefined) {
		return null;
	}

	return Number(match[1].replace(/_/gu, ''));
}

describe('vitest timeout budgets', () => {
	it.each(['testTimeout', 'hookTimeout'])('declares %s explicitly', (option) => {
		// Absent means Vitest's 5s default applies, which is the flaky state this pins against.
		expect(
			declaredTimeout(option),
			`vitest.config.ts must set ${option} — without it the 5s default applies and the 8.6 MB wine-corpus import flakes. See the comment on testTimeout.`,
		).not.toBeNull();
	});

	it.each(['testTimeout', 'hookTimeout'])('gives %s real headroom over a corpus parse', (option) => {
		expect(
			declaredTimeout(option) ?? 0,
			`${option} must be at least ${MINIMUM_TIMEOUT_MS}ms — the 8.6 MB default-tier wine corpus takes ~2.1s to import in isolation, and a full parallel run can exceed a 5s budget.`,
		).toBeGreaterThanOrEqual(MINIMUM_TIMEOUT_MS);
	});

	it('keeps the two budgets in step', () => {
		// The natural fix for a slow body-level await is to hoist it into `beforeAll`. If the hook
		// budget were the smaller of the two, that move would trade one flake for an identical one a
		// line higher up — so the hook budget must be at least as generous as the test budget.
		expect(declaredTimeout('hookTimeout') ?? 0).toBeGreaterThanOrEqual(
			declaredTimeout('testTimeout') ?? 0,
		);
	});
});
