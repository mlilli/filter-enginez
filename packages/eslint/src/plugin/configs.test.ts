/**
 * @remarks
 * Unit coverage for `buildConfigs` — the factory that wires the plugin instance into the
 * `recommended` / `strict` flat-config presets. Asserts each preset's name, that it registers
 * the plugin under the `@filter-enginez` namespace, and the exact rule severities it turns on.
 */

import { describe, expect, it } from 'vitest';

import { buildConfigs } from './configs.js';

describe('buildConfigs', () => {
	const pluginStub = { rules: {}};
	const configs = buildConfigs(pluginStub);

	it('builds a recommended preset that enables the mirror-mutation rule only', () => {
		expect(configs.recommended.name).toBe('@filter-enginez/recommended');
		expect(configs.recommended.plugins?.['@filter-enginez']).toBe(pluginStub);
		expect(configs.recommended.rules?.['@filter-enginez/no-direct-mirror-mutation']).toBe('error');
		expect(configs.recommended.rules?.['@filter-enginez/filter-rule-naming-convention']).toBeUndefined();
	});

	it('builds a strict preset that adds the naming-convention rule as a warning', () => {
		expect(configs.strict.name).toBe('@filter-enginez/strict');
		expect(configs.strict.plugins?.['@filter-enginez']).toBe(pluginStub);
		expect(configs.strict.rules?.['@filter-enginez/no-direct-mirror-mutation']).toBe('error');
		expect(configs.strict.rules?.['@filter-enginez/filter-rule-naming-convention']).toBe('warn');
	});
});
