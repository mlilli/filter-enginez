/**
 * No committable file contains a recognizable credential.
 *
 * @remarks
 * ## Why this is in the test suite and not only in the pre-publish script
 *
 * `scripts/secret-scan.sh` covers three surfaces — the tree, the commit messages, and every diff —
 * and is slow enough to be a deliberate step. That is the right shape for a pre-publish gate and the
 * wrong shape for something that should run constantly.
 *
 * 🔴 **A committed credential is the one mistake in this repo that cannot be undone.** Every other
 * defect — a wrong export map, a dead link, an oversized tarball — is fixable by editing a file. A
 * secret that reaches a public commit is published the moment the push lands, and rewriting history
 * does not unpublish it. So the cheap half of the scan belongs where it runs on every commit, and the
 * expensive half stays a deliberate pre-publish step.
 *
 * ⚠ This is the TREE only. It cannot see a credential that was committed and later deleted — that
 * lives in history, and history is `secret-scan.sh`'s third surface. The division is deliberate and
 * stated so nobody mistakes a green suite for a clean history.
 *
 * ## Which files count as the tree
 *
 * Inside a git work tree, the files `git ls-files` reports: what is tracked is what gets pushed.
 *
 * 🔴 **Outside one, the filesystem walk shared with `publicVoice.test.ts`, and never an empty list.**
 * With no index to ask — no repository yet, or no `git` binary — the guard must still run rather than
 * crash, because a guard that cannot run is a guard that gets skipped. The walk skips only gitignored
 * directories and the gitignored local corpus, so it reads a SUPERSET of what any commit could hold;
 * see `support/repoFiles.ts`.
 *
 * ## What it will miss
 *
 * It matches known vendor prefixes. A high-entropy string with no recognizable format, or a passphrase
 * that looks like a word, is invisible to it. 🟢 Stated plainly because the failure mode of a scanner
 * is false confidence: the honest claim is "no *recognizable* credential", and the negative controls
 * below are what establish that the patterns fire at all.
 *
 * @packageDocumentation
 */

import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { isBinaryPath, REPO_ROOT, walkRepoFiles } from './support/repoFiles.js';

/**
 * Known credential formats, kept in step with `scripts/secret-scan.sh`.
 *
 * @remarks
 * ⚠ Duplicated from that script rather than shared. A module importable by both would have to live
 * somewhere a Bash script and a TypeScript spec can both read, and there is no such place that is not
 * a third file to keep in step. The pattern set is stable enough that drift costs little, and
 * `secret-scan.sh` remains the authoritative version because it is the one that gates publication.
 */
const CREDENTIAL_PATTERNS: readonly { readonly label: string; readonly pattern: RegExp }[] = [
	{ label: 'PEM private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/u },
	{ label: 'AWS access key id', pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/u },
	{ label: 'GitHub token', pattern: /\b(ghp|gho|ghs)_[A-Za-z0-9]{36}\b/u },
	{ label: 'GitHub fine-grained PAT', pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}/u },
	{ label: 'npm token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/u },
	{ label: 'OpenAI-style key', pattern: /\bsk-[A-Za-z0-9]{32,}/u },
	{ label: 'Stripe live key', pattern: /\bsk_live_[A-Za-z0-9]{24,}/u },
	{ label: 'Slack token', pattern: /(^|[^A-Za-z0-9])xox[a-z]-[A-Za-z0-9-]{10,}/u },
	{ label: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/u },
	{ label: 'JWT', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./u },
	{ label: 'GitLab PAT', pattern: /(^|[^A-Za-z0-9])glpat-[A-Za-z0-9_-]{20}/u },
	{ label: 'SendGrid key', pattern: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/u },
];

/**
 * Filenames that are credential stores by convention — present is the finding, content aside.
 *
 * @remarks
 * ⚠ `.npmrc` is deliberately NOT here. It is committed and holds only configuration
 * (`engine-strict`, `auto-install-peers`, `loglevel`), so the filename is not the hazard — an
 * `_authToken` line inside it is, and that is what the separate case below checks.
 */
const CREDENTIAL_FILENAMES
	= /(^|\/)(\.env(\..*)?|\.dev\.vars|id_rsa|id_ed25519|.*\.pem|.*\.key|.*\.p12|.*\.pfx|credentials|secrets?\.(json|ya?ml|ts|js))$/u;

/** Auth material that must never appear in a committed `.npmrc`. */
const NPMRC_AUTH = /_authToken|_auth[^o]|_password|\/\/.*:_/u;

/** Which listing a run used — reported in failure messages so a reader knows what was scanned. */
type ListingSource = 'filesystem walk (no git work tree)' | 'git ls-files';

/**
 * Is the repo root the top of its own git work tree?
 *
 * @remarks
 * Compared by real path rather than trusted from `--is-inside-work-tree`: a checkout nested inside
 * some OTHER repository is inside a work tree too, and `git ls-files` there would list that
 * repository's index — silently the wrong set of files.
 *
 * @returns `true` only when `git` runs and names this directory as the work-tree root.
 */
function isOwnGitWorkTree(): boolean {
	try {
		const topLevel = execFileSync('git', ['rev-parse', '--show-toplevel'], {
			cwd: REPO_ROOT,
			stdio: ['ignore', 'pipe', 'ignore'],
		})
			.toString('utf8')
			.trim();

		return realpathSync(topLevel) === realpathSync(REPO_ROOT);
	} catch {
		// Not a repository yet, or no `git` binary. Both mean "there is no index to ask", and the walk
		// below is the answer to that — not an empty list.
		return false;
	}
}

/**
 * The files this guard treats as the tree, and where the list came from.
 *
 * @returns Repo-relative paths plus the source of the listing.
 */
function committableFiles(): { readonly files: readonly string[]; readonly source: ListingSource } {
	if (isOwnGitWorkTree()) {
		const files = execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 })
			.toString('utf8')
			.split('\0')
			.filter((path) => path !== '');

		return { files, source: 'git ls-files' };
	}

	return { files: walkRepoFiles(), source: 'filesystem walk (no git work tree)' };
}

/**
 * The first credential-shaped line in `text`, labelled.
 *
 * @remarks
 * Takes a STRING so the negative controls below can put a planted credential through the identical
 * matcher. A scanner that has only ever run over clean input has not been shown to work.
 *
 * @param text - File contents.
 * @returns `label: line` for each line that matches, at most one finding per line.
 */
function credentialFindings(text: string): readonly string[] {
	return text.split('\n').flatMap((line) => {
		const matched = CREDENTIAL_PATTERNS.find(({ pattern }) => pattern.test(line));

		return matched === undefined ? [] : [`${matched.label}: ${line.trim().slice(0, 120)}`];
	});
}

/**
 * Read a listed path as text, or `undefined` when it is not a regular text file.
 *
 * @remarks
 * `git ls-files` lists symbolic links and submodules as entries; reading one either follows the link
 * out of the repo or throws on a directory. Neither is content this repository commits.
 *
 * @param path - Repo-relative path.
 * @returns The contents, or `undefined` for a binary asset, a link or a missing file.
 */
function readTextFile(path: string): string | undefined {
	const absolute = resolve(REPO_ROOT, path);

	try {
		return !isBinaryPath(path) && lstatSync(absolute).isFile() ? readFileSync(absolute, 'utf8') : undefined;
	} catch {
		// Listed by the index but deleted in the work tree — nothing on disk to leak.
		return undefined;
	}
}

describe('no committed secrets', () => {
	const { files, source } = committableFiles();

	it('is actually reading the tree, by whichever listing applies', () => {
		// Vacuity guard. An empty or truncated list makes every case below pass over nothing, which is
		// the shape of a scanner that reassures and checks nothing. Anchored on files that must exist in
		// either listing — including this spec itself — rather than on a count somebody has to keep true.
		expect(files, `${source} did not list the root manifest`).toContain('package.json');
		expect(files, `${source} did not list README.md`).toContain('README.md');
		expect(files, `${source} did not list this spec`).toContain('tests/tooling/noCommittedSecrets.test.ts');
		expect(files.some((path) => path.startsWith('packages/')), `${source} listed nothing under packages/`).toBe(
			true,
		);
	});

	it('never lists a dependency, build or cache directory', () => {
		// The walk's skip rules are what keep it from scanning thousands of third-party files. A listing
		// that DID reach into node_modules would still pass the case below — slowly — so this is the
		// control that the listing is the one described above rather than everything on disk.
		const leaked = files.filter((path) => path.split('/').some((segment) => segment === 'node_modules'));

		expect(leaked.slice(0, 5), `${source} reached into node_modules`).toStrictEqual([]);
	});

	it('recognizes each credential format it claims to', () => {
		// 🔴 The negative control. Every case below asserts an empty list, and an empty list is also what
		// a broken matcher produces. Each sample is assembled from fragments so this file does not trip
		// its own scan.
		const samples = [
			['-----BEGIN RSA ', 'PRIVATE KEY-----'],
			['AKIA', 'ABCDEFGHIJKLMNOP'],
			['ghp_', 'a'.repeat(36)],
			['npm_', 'b'.repeat(36)],
			['eyJ', 'abcdefghijk.', 'eyJ', 'abcdefghijk.sig'],
		].map((fragments) => fragments.join(''));

		for (const sample of samples) {
			expect(credentialFindings(`const value = '${sample}';`), `missed ${sample.slice(0, 12)}…`).toHaveLength(1);
		}
		expect(credentialFindings('const value = "an ordinary sentence";')).toStrictEqual([]);
		expect(CREDENTIAL_FILENAMES.test('packages/core/.env.local'), '.env.local is a credential store').toBe(true);
		expect(CREDENTIAL_FILENAMES.test('packages/core/src/environment.ts'), 'a source file is not').toBe(false);
	});

	it('contains no recognizable credential in any file', () => {
		const offenders = files.flatMap((path) =>
			credentialFindings(readTextFile(path) ?? '').map((finding) => `${path}: ${finding}`),
		);

		expect(
			offenders.slice(0, 5),
			`a recognizable credential is in the tree (${source}). If it was ever committed, rotate it `
			+ 'first — it is already in history — then remove it, then re-run `bash scripts/secret-scan.sh`.',
		).toStrictEqual([]);
	});

	it('holds no credential-store filename', () => {
		const offenders = files.filter((path) => CREDENTIAL_FILENAMES.test(path));

		expect(offenders, `a credential-store filename is in the tree (${source})`).toStrictEqual([]);
	});

	it('keeps auth material out of .npmrc', () => {
		// 🔴 The highest-consequence single line this repo could grow. `.npmrc` is committed, and an
		// `_authToken` in it is a publish credential — committed, it would let anyone push to the
		// `@filter-enginez` scope. The file is legitimate and stays; only the auth keys are forbidden.
		expect(files, `${source} did not list .npmrc`).toContain('.npmrc');

		const offenders = (readTextFile('.npmrc') ?? '').split('\n').filter((line) => NPMRC_AUTH.test(line));

		expect(offenders, '.npmrc contains auth material — move it to ~/.npmrc, which is never committed').toStrictEqual(
			[],
		);
	});
});
