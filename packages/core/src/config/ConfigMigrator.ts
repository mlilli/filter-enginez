/**
 * `ConfigMigrator` — forward-migrate older `FilterEngineConfig` documents to the current
 * schema version.
 *
 * @remarks
 * Per `docs/architecture.md` §9.4. Configs persist (in URL state, in backend storage, in
 * devtools snapshots) and the schema evolves; this module bridges old and new shapes so
 * stored configs don't break when the engine ships.
 *
 * The current schema version is `1` and the engine registers no built-in steps, so for built-in
 * configs the migrator is an identity pass with a version-mismatch guard. Each step is a pure function
 * `(prior) => next` that advances the document by one version.
 *
 * **Why a class.** The migrator is a class (not just a function) so consumers can register
 * custom migration steps for their own extensions to the config shape — for example, a
 * downstream app that adds a `theme: 'dark' | 'light'` field to `metadata` can register a
 * `1 -> 2` migration that fills in a default value.
 *
 * @packageDocumentation
 */

import { FilterEngineConfigError } from '../errors/index.js';
import { CURRENT_CONFIG_VERSION, type FilterEngineConfig } from './FilterEngineConfig.js';

/**
 * A single migration step — `(prior config of version N) => (next config of version N+1)`.
 *
 * Implementations should be pure (no side effects) and leave the input config untouched.
 */
export type ConfigMigrationStep = (
	priorConfig: Record<string, unknown>,
) => Record<string, unknown>;

/**
 * Forward-migrate configs to the current schema version.
 *
 * Built-in steps are registered automatically; consumers may register additional steps for
 * their own custom fields via `register(fromVersion, step)`.
 */
export class ConfigMigrator {
	/** Migration steps keyed by their `from` version — `migrations[1]` migrates v1 to v2. */
	private readonly _migrations = new Map<number, ConfigMigrationStep>();

	/**
	 * Register a migration step.
	 *
	 * @param fromVersion - The version this step migrates FROM (it produces `fromVersion + 1`)
	 * @param step - The pure migration function
	 */
	register(fromVersion: number, step: ConfigMigrationStep): void {
		this._migrations.set(fromVersion, step);
	}

	/**
	 * Apply all registered migration steps to bring the config up to
	 * `CURRENT_CONFIG_VERSION`.
	 *
	 * @param rawConfig - A config document of any version
	 * @returns A config document at the current schema version
	 * @throws `FilterEngineConfigError` with code `CONFIG_VERSION_UNSUPPORTED` if `rawConfig.version`
	 *   is greater than `CURRENT_CONFIG_VERSION` (this engine is older than the config — consumer
	 *   should upgrade their engine version)
	 * @throws `FilterEngineConfigError` with code `CONFIG_MIGRATION_MISSING` if a migration step is
	 *   missing for an intermediate version (gap in the chain)
	 */
	migrate(rawConfig: Record<string, unknown>): FilterEngineConfig {
		const startingVersion = typeof rawConfig['version'] === 'number'
			? (rawConfig['version'])
			: 1;

		if (startingVersion > CURRENT_CONFIG_VERSION) {
			throw new FilterEngineConfigError(
				'CONFIG_VERSION_UNSUPPORTED',
				`ConfigMigrator: config version ${startingVersion} is newer than this engine ` +
				`supports (current = ${CURRENT_CONFIG_VERSION}). Upgrade @filter-enginez/core.`,
			);
		}

		let working = rawConfig;

		for (let v = startingVersion; v < CURRENT_CONFIG_VERSION; v++) {
			const step = this._migrations.get(v);

			if (!step) {
				throw new FilterEngineConfigError(
					'CONFIG_MIGRATION_MISSING',
					`ConfigMigrator: missing migration step for version ${v} -> ${v + 1}. ` +
					`Register one via ConfigMigrator.register(${v}, step).`,
				);
			}
			working = step(working);
		}

		// Final version stamp — defensive in case a step forgot to bump it.
		working = { ...working, version: CURRENT_CONFIG_VERSION };

		return working as unknown as FilterEngineConfig;
	}
}

/**
 * The default singleton migrator. Pre-registered with all built-in migration steps (none, since
 * the current schema is v1). Consumers can register additional steps on this
 * instance, or instantiate their own.
 */
export const defaultMigrator = new ConfigMigrator();
