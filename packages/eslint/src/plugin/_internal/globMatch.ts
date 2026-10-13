/**
 * Tiny self-contained glob matcher used by the rules to test file paths against the
 * `allowedSubpaths` option globs (e.g., `'**\/storage/browser/**'`).
 *
 * @remarks
 * We avoid pulling in `picomatch` / `minimatch` to keep the plugin's dependency footprint
 * lean — lint plugins should be near-zero-dep for fast install. The matcher supports just
 * enough of the glob syntax to handle our patterns:
 *
 *   - `**` matches any sequence of characters including `/`
 *   - `*`  matches any sequence of characters except `/`
 *   - Everything else is a literal
 *
 * Windows-style backslash separators are normalized to forward slashes before matching, so
 * the same patterns work on both platforms.
 *
 * @packageDocumentation
 */

/**
 * Compile a glob pattern into a `RegExp` for fast repeated matching.
 *
 * @remarks
 * Three wildcard expansions, mirroring the conventional `picomatch` semantics so consumers'
 * intuitions transfer:
 *
 *   - `**\/` (globstar followed by `/`) → `(?:.*\/)?` — matches **zero or more** path
 *     segments. Critical for the common pattern `**\/foo/**` to match both `foo/bar` (where
 *     `foo` is at the path root) and `a/b/foo/bar` (where `foo` is nested). Without this
 *     special case, the leading `**` would require at least one preceding segment.
 *   - `**` (globstar standalone or `/**` at end) → `.*` — matches any sequence including `/`
 *   - `*` (single star) → `[^/]*` — matches anything except `/`
 *
 * Everything else is a regex-escaped literal. Doing it manually (vs a big String.replace) is
 * the only way to safely handle the `**\/` and `**` distinction without false-matching inside
 * literal text.
 *
 * @param pattern - The glob pattern, e.g. `'**\/storage/browser/**'`
 * @returns A compiled `RegExp` that matches paths conforming to the glob (anchored both ends)
 */
function compileGlob(pattern: string): RegExp {
	let regexSource = '^';
	let index = 0;

	while (index < pattern.length) {
		const char = pattern.charAt(index);

		if (char === '*' && pattern[index + 1] === '*') {
			// `**/` → optional segment-prefix, supports zero-segment match
			if (pattern[index + 2] === '/') {
				regexSource += '(?:.*\\/)?';
				index += 3;
				continue;
			}
			// Plain `**` → match anything including slashes
			regexSource += '.*';
			index += 2;
			continue;
		}
		if (char === '*') {
			regexSource += '[^/]*';
			index += 1;
			continue;
		}
		// Escape any regex metacharacter the literal might contain.
		regexSource += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
		index += 1;
	}
	regexSource += '$';

	return new RegExp(regexSource);
}

/**
 * Internal cache so repeated `globMatchesPath` calls with the same pattern don't recompile.
 * ESLint rules are invoked per-file across thousands of files; compiled regex caching keeps
 * the rule's overhead negligible.
 */
const COMPILED_GLOB_CACHE: Map<string, RegExp> = new Map();

/**
 * Test whether a file path matches a glob pattern.
 *
 * @param filePath - Absolute or relative file path (Windows separators are auto-normalized)
 * @param pattern - The glob pattern
 * @returns `true` if the path matches the pattern
 *
 * @example
 *   globMatchesPath('/repo/packages/core/src/storage/browser/IndexedDBAdapter.ts',
 *                   '**\/storage/browser/**'); // true
 *   globMatchesPath('/repo/packages/core/src/FilterEngine.ts', '**\/storage/browser/**'); // false
 */
export function globMatchesPath(filePath: string, pattern: string): boolean {
	let compiled = COMPILED_GLOB_CACHE.get(pattern);

	if (!compiled) {
		compiled = compileGlob(pattern);
		COMPILED_GLOB_CACHE.set(pattern, compiled);
	}
	// Normalize Windows path separators so the same glob works on both platforms.
	const normalizedPath = filePath.replace(/\\/g, '/');

	return compiled.test(normalizedPath);
}

/**
 * Test whether a file path matches ANY of the supplied glob patterns. Convenience helper for
 * the `allowedSubpaths`-style option shape used by the rules.
 *
 * @param filePath - Absolute or relative file path
 * @param patterns - The glob patterns to test against
 * @returns `true` if at least one pattern matches
 */
export function globMatchesAny(filePath: string, patterns: readonly string[]): boolean {
	for (const pattern of patterns) {
		if (globMatchesPath(filePath, pattern)) {
			return true;
		}
	}

	return false;
}
