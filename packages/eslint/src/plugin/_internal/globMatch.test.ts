/**
 * @remarks
 * Unit coverage for the self-contained glob matcher backing the rules' `allowedSubpaths` /
 * location options. Exercises every branch of the internal `compileGlob` (the `**\/`
 * zero-or-more-segment prefix, the plain `**` globstar, the within-segment `*`, and the
 * regex-metacharacter escape of literal segments), the compile-cache reuse path, and Windows
 * separator normalization.
 */

import { describe, expect, it } from 'vitest';

import { globMatchesAny, globMatchesPath } from './globMatch.js';

describe('globMatchesPath', () => {
	it('matches a `**/foo/**` pattern at both the path root and nested depths', () => {
		// Zero preceding segments — `rules/` sits at the very start of the path.
		expect(globMatchesPath('rules/PriceRule.ts', '**/rules/**')).toBe(true);
		// Nested — `rules/` appears several segments deep.
		expect(globMatchesPath('packages/core/src/rules/PriceRule.ts', '**/rules/**')).toBe(true);
		// No `rules/` segment anywhere — no match.
		expect(globMatchesPath('packages/core/src/engine/Engine.ts', '**/rules/**')).toBe(false);
	});

	it('treats a single `*` as within-segment (never crosses a `/`)', () => {
		expect(globMatchesPath('src/foo.ts', 'src/*.ts')).toBe(true);
		// `*` cannot swallow the `nested/` segment, so the deeper file does not match.
		expect(globMatchesPath('src/nested/foo.ts', 'src/*.ts')).toBe(false);
	});

	it('matches a trailing plain `**` globstar including slashes', () => {
		expect(globMatchesPath('src/a/b/c.ts', 'src/**')).toBe(true);
		expect(globMatchesPath('other/a/b.ts', 'src/**')).toBe(false);
	});

	it('escapes regex metacharacters in literal segments (a `.` is a literal dot)', () => {
		expect(globMatchesPath('a.b', 'a.b')).toBe(true);
		// If the dot were treated as the regex `.`, `axb` would match — it must not.
		expect(globMatchesPath('axb', 'a.b')).toBe(false);
	});

	it('normalizes Windows backslash separators before matching', () => {
		expect(globMatchesPath('packages\\core\\src\\rules\\X.ts', '**/rules/**')).toBe(true);
	});

	it('reuses the compiled regex on a repeated call with the same pattern (cache hit)', () => {
		// First call compiles + caches; the second call takes the cache-hit branch.
		expect(globMatchesPath('a/rules/x.ts', '**/rules/**')).toBe(true);
		expect(globMatchesPath('b/rules/y.ts', '**/rules/**')).toBe(true);
	});
});

describe('globMatchesAny', () => {
	it('returns true when at least one pattern matches', () => {
		expect(globMatchesAny('src/rules/X.ts', ['**/browser/**', '**/rules/**'])).toBe(true);
	});

	it('returns false when no pattern matches', () => {
		expect(globMatchesAny('src/engine/E.ts', ['**/browser/**', '**/rules/**'])).toBe(false);
	});

	it('returns false for an empty pattern list', () => {
		expect(globMatchesAny('anything/at/all.ts', [])).toBe(false);
	});
});
