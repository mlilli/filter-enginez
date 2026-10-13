/**
 * Nothing in this public repository names the maintainer in the third person, or names the tools
 * used to build it.
 *
 * @remarks
 * Project prose speaks in the project's own voice. Narrative about who decided something or who runs
 * a script ("decided by …", "… runs this script") and about the tooling used to write the code is
 * not useful to a reader, and the maintainer is not written about in the third person in his own
 * repository. This guard keeps both out.
 *
 * Forbidden, case-insensitively unless noted:
 *
 * - the maintainer's first name on its own, case-sensitive, including the possessive. His full
 *   name stays allowed — it is the copyright holder in `LICENSE.md` / `NOTICE.md` and the
 *   author credit in `README.md`, which are attributions, not narrative;
 * - the names of the AI vendor, its assistant, and its desktop agent product;
 * - the site's domain spelled with the hyphen the npm scope and repositories use (the domain has none);
 * - launch-countdown wording: a countdown to the first npm release or to the repositories going
 *   public. Both have happened by the time anyone reads them, so such wording is stale on arrival. A
 *   procedure that recurs — publishing a brand-new package, say — is written as a procedure instead.
 *
 * Every text file is scanned, generated ones included, except dependency, build and cache
 * directories, binary assets, and the local-only wine corpus files (gitignored real-world data whose
 * wine and producer names legitimately contain these strings).
 *
 * The forbidden words are assembled from fragments so this file does not trip its own check.
 *
 * @packageDocumentation
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { isBinaryPath, REPO_ROOT, walkRepoFiles } from './support/repoFiles.js';

/** The rules, each built from fragments. */
// cspell:ignore anth ropic regis lished lish nch -- the fragments themselves, which are not words.
const FORBIDDEN: readonly { readonly label: string; readonly pattern: RegExp }[] = [
	{ label: 'maintainer first name', pattern: new RegExp(`\\b${['Mi', 'ke'].join('')}\\b(?! Lilli)`, 'u') },
	{ label: 'AI vendor', pattern: new RegExp(['anth', 'ropic'].join(''), 'iu') },
	{ label: 'AI assistant', pattern: new RegExp(`\\b${['cla', 'ude'].join('')}\\b`, 'iu') },
	{ label: 'AI desktop agent', pattern: new RegExp(['co', 'work'].join(''), 'iu') },
	// The site is filterenginez.com — no hyphen, unlike the npm scope and the repository names.
	{ label: 'wrong domain', pattern: new RegExp(`filter-enginez\\.${['c', 'om'].join('')}`, 'iu') },
	// Launch-countdown wording. Each phrase is split in two so this file does not match itself.
	...[
		['not yet pub', 'lished'],
		['not (?:yet )?on (?:npm|the regis', 'try)'],
		['on (?:npm|the registry) y', 'et'],
		["before (?:they are|they're|it is|it's) on n", 'pm'],
		['(?:until|before|after) the first (?:npm )?(?:release|pub', 'lish)'],
		['pre-pub', 'lic'],
		['pre-lau', 'nch'],
		['never yet r', 'un'],
	].map(([head, tail]) => ({ label: 'launch countdown', pattern: new RegExp(`${head}${tail}`, 'iu') })),
];

/**
 * Every text file the walk finds — the shared walker's skip rules, minus binary assets.
 *
 * @remarks
 * The walker is shared with `noCommittedSecrets.test.ts` so the two whole-tree scans cannot disagree
 * about what the tree is; see `support/repoFiles.ts`.
 */
const FILES = walkRepoFiles().filter((file) => !isBinaryPath(file));

describe('public voice', () => {
	it('scans the repository, so the check below is not vacuous', () => {
		expect(FILES.length).toBeGreaterThan(300);
		expect(FILES).toContain('README.md');
	});

	it('never names the maintainer in the third person, the tooling used to build the repo, or a launch countdown', () => {
		const findings: string[] = [];

		for (const file of FILES) {
			const lines = readFileSync(resolve(REPO_ROOT, file), 'utf8').split('\n');

			for (const [index, line] of lines.entries()) {
				for (const { label, pattern } of FORBIDDEN) {
					if (pattern.test(line)) {
						findings.push(`${file}:${index + 1} (${label}): ${line.trim().slice(0, 120)}`);
					}
				}
			}
		}

		expect(findings, findings.join('\n')).toEqual([]);
	});
});
