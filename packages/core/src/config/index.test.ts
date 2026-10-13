/**
 * @remarks
 * Barrel live-binding test for `config/index.ts` — asserts every re-exported runtime symbol is
 * present and wired to the same implementation as the source module.
 */

import { describe, expect, it } from 'vitest';

import {
	ConfigMigrator,
	CURRENT_CONFIG_VERSION,
	defaultMigrator,
	exportConfig,
	loadConfig,
	resolveConfig,
} from './index.js';

describe('config barrel', () => {
	it('re-exports all runtime symbols', () => {
		expect(CURRENT_CONFIG_VERSION).toBe(1);
		expect(typeof loadConfig).toBe('function');
		expect(typeof resolveConfig).toBe('function');
		expect(typeof exportConfig).toBe('function');
		expect(typeof ConfigMigrator).toBe('function');
		expect(defaultMigrator).toBeInstanceOf(ConfigMigrator);
	});
});
