/**
 * @remarks
 * Tests for the type-only `FilterEngineConfig` module — asserts the runtime-exported
 * `CURRENT_CONFIG_VERSION` constant value and a thin live-binding sanity check that the symbol
 * is importable and usable in a `FilterEngineConfig`-shaped literal.
 */

import { describe, expect, it } from 'vitest';

import { CURRENT_CONFIG_VERSION, type FilterEngineConfig } from './FilterEngineConfig.js';

describe('FilterEngineConfig', () => {
	it('exports CURRENT_CONFIG_VERSION as 1', () => {
		expect(CURRENT_CONFIG_VERSION).toBe(1);
	});

	it('the constant is usable as the version field of a config literal', () => {
		const config: FilterEngineConfig = {
			rules: [],
			version: CURRENT_CONFIG_VERSION,
		};

		expect(config.version).toBe(1);
	});
});
