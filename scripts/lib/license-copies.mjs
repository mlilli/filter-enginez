/**
 * What the copy of a root license file inside a published package says.
 *
 * @remarks
 * `scripts/sync-licenses.mjs` writes these copies at release time; `tests/tooling/packedLicenseTerms.test.ts` reads
 * what they WOULD say, without needing the gitignored copies to exist. Both import {@link packageCopyOf}, so the copy
 * the guard checks is the copy that ships. Pure: no file system access, nothing runs on import.
 */

/**
 * Files that DO travel alongside the copy, so a repo-relative link to them still resolves.
 *
 * @remarks
 * `LICENSE.md` is itself synced into every package and named in every `files` array, so
 * `[LICENSE.md](./LICENSE.md)` is correct inside a tarball. Nothing else in the repo is.
 */
const CO_LOCATED = new Set(['./LICENSE.md']);

/**
 * The comment that opens a part of a root file the package copies leave out. Text may follow the marker name inside
 * the comment, to tell a reader of the root file what the marker does.
 */
const REPOSITORY_ONLY_START = /<!-- repository-only:start\b[^>]*-->/gu;

/** The comment that closes a part opened by {@link REPOSITORY_ONLY_START}. */
const REPOSITORY_ONLY_END = '<!-- repository-only:end -->';

/** One marked part, with the blank lines around it. */
const REPOSITORY_ONLY_PART = /\n*<!-- repository-only:start\b[^>]*-->[\s\S]*?<!-- repository-only:end -->\n*/gu;

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

/**
 * Remove every part of a root file marked as true of the repository only.
 *
 * @remarks
 * 🔴 **Consumer-facing.** The root `NOTICE.md` describes the whole repository, including a local-only import of a
 * third-party dataset whose license is not permissive. That dataset ships in no package, but a package copy that
 * NAMES its license reads, to a supply-chain license scanner, as a package that carries it. So the root file marks
 * such parts with `<!-- repository-only:start -->` … `<!-- repository-only:end -->`, and the copies leave them out.
 * The blank lines around a part collapse to one, so the copy reads as if the part had never been written.
 *
 * ⚠ An unbalanced or out-of-order marker throws. Keeping an unclosed part would ship exactly the text the marker exists
 * to keep out, and dropping everything after it would ship a truncated notice.
 *
 * @param {string} body - The root file's contents.
 * @param {string} name - Its name, for the error.
 * @returns {string} The same text without its repository-only parts.
 * @throws {Error} When the markers do not pair up.
 */
function stripRepositoryOnly(body, name) {
	const starts = body.match(REPOSITORY_ONLY_START)?.length ?? 0;
	const ends = body.split(REPOSITORY_ONLY_END).length - 1;

	if (starts !== ends) {
		throw new Error(`${name}: ${String(starts)} repository-only:start marker(s) but ${String(ends)} repository-only:end`);
	}
	// A file without markers is copied byte for byte: `LICENSE.md` is a verbatim legal text.
	if (starts === 0) {
		return body;
	}

	const stripped = body.replaceAll(REPOSITORY_ONLY_PART, '\n\n').replace(/\n+$/u, '\n');

	if (stripped.includes('repository-only:')) {
		throw new Error(`${name}: a repository-only:end marker comes before its start`);
	}

	return stripped;
}

/**
 * The text the copy of one root file inside a published package carries: the root file without its
 * repository-only parts, with links to files that do not ship flattened to their labels.
 *
 * @param {string} body - The root file's contents.
 * @param {string} name - Its name, for errors.
 * @returns {string} The copy's contents.
 * @throws {Error} When the root file's repository-only markers do not pair up.
 */
export function packageCopyOf(body, name) {
	return flattenRepoRelativeLinks(stripRepositoryOnly(body, name));
}
