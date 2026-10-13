/**
 * @remarks
 * Smoke test for the `@filter-enginez/eslint/config` presets. These live in `src/config/*.js`
 * (plain JS, deliberately outside the TypeScript program + the coverage denominator), so a
 * dropped or renamed export wouldn't be caught by `tsc`. This asserts all three presets still
 * resolve at runtime.
 *
 * The module is loaded via a runtime-computed specifier (not a string literal) so TypeScript
 * doesn't try to resolve the untyped `.js` and emit a spurious TS7016.
 */

import { describe, expect, it } from 'vitest';

describe('@filter-enginez/eslint/config presets', () => {
	// Generous timeout: importing the barrel eagerly evaluates all three presets, which pull in
	// the full lint-plugin graph (@stylistic, perfectionist, @eslint-react, jsx-a11y-x, compat, …) — a
	// legitimately heavy load, especially on a cold module cache in a constrained CI container.
	it('resolves base, react, and nodeIsomorphic as defined config presets', async () => {
		const specifier = new URL('../config/index.js', import.meta.url).href;
		const presets = (await import(specifier)) as {
			base: unknown;
			nodeIsomorphic: unknown;
			react: unknown;
		};

		for (const preset of [presets.base, presets.nodeIsomorphic, presets.react]) {
			expect(preset).toBeDefined();
			expect(typeof preset).toBe('object');
		}
	}, 20_000);
});
