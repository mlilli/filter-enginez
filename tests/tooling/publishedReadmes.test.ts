/**
 * Every published package has a README that is true and that survives leaving the repo.
 *
 * @remarks
 * ## Why this is not cosmetic
 *
 * A package's README **is its npm registry page**. It is the first and often only thing a consumer
 * reads, npm auto-includes it with no `files` entry required, and nothing in a monorepo's own gates
 * ever looks at it — so it drifts further than any other published artifact.
 *
 * 🔴 **The three ways it goes wrong:**
 *
 * - **A stale status line.** A `Status: Pre-implementation scaffold stub` line on a finished package
 *   tells a consumer landing on its registry page that it is not built yet.
 * - **A repo-relative link.** A tarball contains no `docs/` tree, so `../../docs/architecture.md` in a
 *   package README is broken for every consumer.
 * - **No README at all**, which renders the package's registry page blank.
 *
 * ## What it asserts, and what it deliberately does not
 *
 * Three mechanical properties: a README exists, it makes no stale implementation-status claim, and it
 * contains no repo-relative link. ⚠ It cannot judge whether the prose is any *good* — that is review,
 * not a guard. The point is that the three failures above are all machine-detectable, so none of them
 * should depend on somebody happening to notice.
 *
 * 🟢 The link rule is absolute rather than "no link to an unpublished doc". A relative link is dead
 * in a tarball whatever it points at, so the narrower rule would let `../../docs/architecture.md`
 * through — which is public, and still broken for every consumer.
 *
 * @packageDocumentation
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The 13 engine packages — the ones that become npm registry pages. */
const ENGINE_PACKAGES = [
	'core',
	'reactive-signals',
	'reactive-rxjs',
	'react-signals',
	'react-rxjs',
	'svelte-signals',
	'vue-signals',
	'angular-rxjs',
	'redux-bridge',
	'url-state-router',
	'worker-bridge',
	'eslint',
	'mock-data',
] as const;

/**
 * Phrases that assert the package is unfinished.
 *
 * @remarks
 * Matched case-insensitively. These are the stock scaffold-template phrases; the list is not an
 * attempt to catch every possible way of saying "unfinished", because a guard that tried would
 * fire on legitimate prose about a feature being unimplemented.
 */
const STALE_STATUS_CLAIMS = ['pre-implementation', 'scaffold stub', 'not yet implemented', 'coming soon'] as const;

describe.each(ENGINE_PACKAGES)('published README — %s', (name) => {
	const path = resolve(REPO_ROOT, `packages/${name}/README.md`);

	it('exists', () => {
		// Without one, npm shows an empty page. npm needs no `files` entry for a README — absence is the
		// only way to lose it.
		expect(existsSync(path), `packages/${name}/README.md is missing — its npm page would be blank`).toBe(true);
	});

	it('claims no stale implementation status', () => {
		const text = readFileSync(path, 'utf8').toLowerCase();
		const found = STALE_STATUS_CLAIMS.filter((claim) => text.includes(claim));

		expect(
			found,
			`packages/${name}/README.md still describes itself as unfinished. This is the npm registry `
			+ 'page: a consumer reads it before deciding whether the package is usable.',
		).toStrictEqual([]);
	});

	it('contains no repo-relative link, which a tarball cannot resolve', () => {
		const offenders = readFileSync(path, 'utf8')
			.split('\n')
			.map((line, index) => ({ index: index + 1, line }))
			// `\]` must be escaped: an unescaped `]` is a lone quantifier bracket under the `u` flag.
			.filter(({ line }) => /\]\(\.\.?\//u.test(line));

		expect(
			offenders.map(({ index, line }) => `${name}/README.md:${String(index)} ${line.trim().slice(0, 70)}`),
			'a relative link is dead once the package is extracted from a tarball — name the target as '
			+ 'text, or use an absolute URL that is actually public',
		).toStrictEqual([]);
	});
});

describe('published README — roster', () => {
	it('covers all 13', () => {
		// Vacuity guard: `describe.each` over a truncated roster reports success.
		expect(ENGINE_PACKAGES).toHaveLength(13);
	});

	it('has a non-empty list of stale-status phrases to look for', () => {
		// The second half of the vacuity problem: an empty phrase list makes every status case pass.
		expect(STALE_STATUS_CLAIMS.length).toBeGreaterThan(2);
	});
});
