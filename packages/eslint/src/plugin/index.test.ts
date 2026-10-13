/**
 * @remarks
 * Barrel-export sanity for `@filter-enginez/eslint`'s `./plugin` entry. Asserts the default
 * plugin object exposes the three rules under their kebab-case names, carries `meta` + wired
 * `configs.recommended` / `configs.strict`, and that the named re-exports (rule modules + option
 * default constants) resolve to live values. Type-only re-exports have no runtime presence and
 * are covered by `tsc` over this file's imports.
 */

import { describe, expect, it } from 'vitest';

import plugin, {
	DEFAULT_FORBIDDEN_GLOBALS,
	DEFAULT_NO_BROWSER_API_ALLOWED_SUBPATHS,
	DEFAULT_NO_DIRECT_MIRROR_MUTATION_ALLOWED_SUBPATHS,
	filterRuleNamingConvention,
	noBrowserApiInCore,
	noDirectMirrorMutation,
} from './index.js';

describe('@filter-enginez/eslint plugin barrel', () => {
	it('exposes the three rules under their kebab-case names', () => {
		expect(Object.keys(plugin.rules).sort()).toEqual([
			'filter-rule-naming-convention',
			'no-browser-api-in-core',
			'no-direct-mirror-mutation',
		]);
		expect(plugin.rules['no-browser-api-in-core']).toBe(noBrowserApiInCore);
		expect(plugin.rules['no-direct-mirror-mutation']).toBe(noDirectMirrorMutation);
		expect(plugin.rules['filter-rule-naming-convention']).toBe(filterRuleNamingConvention);
	});

	it('carries meta + config presets wired to its own rule map', () => {
		expect(plugin.meta.name).toBe('@filter-enginez/eslint');
		expect(typeof plugin.meta.version).toBe('string');
		expect(plugin.configs.recommended.rules?.['@filter-enginez/no-direct-mirror-mutation']).toBe('error');
		expect(plugin.configs.strict.rules?.['@filter-enginez/filter-rule-naming-convention']).toBe('warn');

		// The preset registers a plugin object whose rule map is the barrel's own `rules`.
		const wired = plugin.configs.recommended.plugins?.['@filter-enginez'] as { rules: unknown };

		expect(wired.rules).toBe(plugin.rules);
	});

	it('re-exports the rule option defaults as live values', () => {
		expect(Array.isArray(DEFAULT_FORBIDDEN_GLOBALS)).toBe(true);
		expect(DEFAULT_FORBIDDEN_GLOBALS).toContain('window');
		expect(Array.isArray(DEFAULT_NO_BROWSER_API_ALLOWED_SUBPATHS)).toBe(true);
		expect(Array.isArray(DEFAULT_NO_DIRECT_MIRROR_MUTATION_ALLOWED_SUBPATHS)).toBe(true);
	});
});
