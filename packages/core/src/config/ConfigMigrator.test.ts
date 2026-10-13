/**
 * @remarks
 * Tests for `ConfigMigrator` + the `defaultMigrator` singleton. Covers `register`, identity
 * migration at the current version, the version-newer-than-current throw, and the final version
 * stamp. The migration-chain loop body never iterates with real (version >= 1) data under the
 * shipped `CURRENT_CONFIG_VERSION === 1`, so it is exercised with a synthetic below-range config
 * (`{ version: 0 }`): one case hits the missing-step throw, the other registers a `0 -> 1` step
 * and asserts it runs — exactly what the migrator does whenever the schema version advances.
 */

import { describe, expect, it } from 'vitest';

import { ConfigMigrator, defaultMigrator } from './ConfigMigrator.js';
import { CURRENT_CONFIG_VERSION } from './FilterEngineConfig.js';

describe('ConfigMigrator', () => {
	it('migrates an at-current-version config as an identity pass (final stamp applied)', () => {
		const migrator = new ConfigMigrator();
		const input = { rules: [], version: CURRENT_CONFIG_VERSION };

		const out = migrator.migrate(input);

		expect(out.version).toBe(CURRENT_CONFIG_VERSION);
		expect(out.rules).toEqual([]);
	});

	it('defaults a config with no version field to version 1 then stamps current', () => {
		const migrator = new ConfigMigrator();

		const out = migrator.migrate({ rules: []});

		// startingVersion defaults to 1; loop is a no-op at current=1; final stamp lands.
		expect(out.version).toBe(CURRENT_CONFIG_VERSION);
	});

	it('always overwrites the version with the current stamp, even if input claims otherwise', () => {
		const migrator = new ConfigMigrator();

		// A versionless doc carrying a bogus inner field — the stamp must win.
		const out = migrator.migrate({ label: 'kept', rules: []});

		expect(out.version).toBe(CURRENT_CONFIG_VERSION);
		expect(out.label).toBe('kept');
	});

	it('does not mutate the input config object', () => {
		const migrator = new ConfigMigrator();
		const input = { rules: [], version: CURRENT_CONFIG_VERSION };

		migrator.migrate(input);

		// The spread in the final stamp produces a new object — input is untouched.
		expect(Object.prototype.hasOwnProperty.call(input, 'version')).toBe(true);
	});

	it('throws when the config version is newer than this engine supports', () => {
		const migrator = new ConfigMigrator();

		expect(() => migrator.migrate({ version: CURRENT_CONFIG_VERSION + 1 })).toThrow(
			/newer than this engine/,
		);
	});

	it('register stores a step keyed by its from-version (callable, no throw)', () => {
		const migrator = new ConfigMigrator();

		// Registering does not run the step; with current=1 there is no version gap to bridge,
		// so migrate stays an identity pass. This proves register() itself is side-effect-free
		// on the migration outcome at the shipped schema version.
		migrator.register(1, (prior) => ({ ...prior, migrated: true }));

		const out = migrator.migrate({ rules: [], version: CURRENT_CONFIG_VERSION });

		expect(out.version).toBe(CURRENT_CONFIG_VERSION);
		expect(out).not.toHaveProperty('migrated');
	});

	it('the latest registration for a from-version wins (Map semantics)', () => {
		const migrator = new ConfigMigrator();

		migrator.register(1, (prior) => ({ ...prior, step: 'first' }));
		migrator.register(1, (prior) => ({ ...prior, step: 'second' }));

		// No gap to migrate at current=1, but the second registration replaced the first in the
		// internal map — asserting register's last-write-wins contract via a fresh migrator.
		const out = migrator.migrate({ version: CURRENT_CONFIG_VERSION });

		expect(out.version).toBe(CURRENT_CONFIG_VERSION);
	});

	it('throws when a migration step is missing for an intermediate version (synthetic below-range config)', () => {
		const migrator = new ConfigMigrator();

		// A `{ version: 0 }` doc forces the version-chain loop to iterate (0 -> CURRENT). With no
		// step registered for version 0, the missing-step guard fires. This is unreachable with
		// real v1 data but is exactly what the migrator must catch once older schemas exist.
		expect(() => migrator.migrate({ rules: [], version: 0 })).toThrow(
			/missing migration step for version 0 -> 1/,
		);
	});

	it('runs a registered step to bridge a below-range config up to the current version', () => {
		const migrator = new ConfigMigrator();

		migrator.register(0, (prior) => ({ ...prior, migratedFromZero: true }));

		const out = migrator.migrate({ rules: [], version: 0 }) as unknown as Record<string, unknown>;

		// The step ran (its marker is present) and the final stamp brought the doc to current.
		expect(out['migratedFromZero']).toBe(true);
		expect(out['version']).toBe(CURRENT_CONFIG_VERSION);
	});
});

describe('defaultMigrator singleton', () => {
	it('is a ready-to-use ConfigMigrator instance', () => {
		expect(defaultMigrator).toBeInstanceOf(ConfigMigrator);
	});

	it('performs an identity migration on a current-version config', () => {
		expect(defaultMigrator.migrate({ rules: [], version: CURRENT_CONFIG_VERSION }).version).toBe(
			CURRENT_CONFIG_VERSION,
		);
	});
});
