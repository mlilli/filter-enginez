/**
 * Recommended config presets for `@filter-enginez/eslint/plugin`.
 *
 * @remarks
 * Per `docs/architecture.md` §17.4. Two presets ship:
 *
 *   - **`recommended`** — turns on `no-direct-mirror-mutation` (always-on safety rule). Does
 *     NOT enable `no-browser-api-in-core` — that's applied via project-specific overrides
 *     because the path globs vary per consumer monorepo. Filter EngineZ's own
 *     `eslint.config.js` wires it package-by-package.
 *   - **`strict`** — adds `filter-rule-naming-convention` on top. For projects that want the
 *     full house style.
 *
 * `buildConfigs(pluginInstance)` wires the presets to the actual rules; the barrel calls it with
 * the plugin object so consumers see a fully-wired `configs.recommended` / `configs.strict`.
 *
 * @packageDocumentation
 */

/**
 * The shape of an ESLint flat-config preset entry that this plugin exports.
 *
 * @remarks
 * Structurally typed to avoid a hard dependency on `eslint`'s `Linter.Config` (which has had
 * shifting type signatures across major versions). Consumers spread these into their flat
 * config without TypeScript caring about the exact upstream type.
 */
export interface FlatConfigPreset {
	readonly name?: string;
	readonly plugins?: Readonly<Record<string, unknown>>;
	readonly rules?: Readonly<Record<string, 'error' | 'off' | 'warn' | readonly unknown[]>>;
}

// #region docs:build-configs
/**
 * Factory that builds the preset objects, parameterized over the plugin instance. The barrel
 * calls these immediately after constructing the plugin object so consumers see a fully-
 * wired `configs.recommended` / `configs.strict` on the plugin export.
 *
 * @param pluginInstance - The plugin object itself (with its `rules` map)
 * @returns The preset bundle
 */
export function buildConfigs(pluginInstance: Readonly<Record<string, unknown>>): {
	readonly recommended: FlatConfigPreset;
	readonly strict: FlatConfigPreset;
} {
	return {
		recommended: {
			name: '@filter-enginez/recommended',
			plugins: { '@filter-enginez': pluginInstance },
			rules: {
				'@filter-enginez/no-direct-mirror-mutation': 'error',
			},
		},
		strict: {
			name: '@filter-enginez/strict',
			plugins: { '@filter-enginez': pluginInstance },
			rules: {
				'@filter-enginez/filter-rule-naming-convention': 'warn',
				'@filter-enginez/no-direct-mirror-mutation': 'error',
				// no-browser-api-in-core stays project-scoped — the path globs vary per repo
			},
		},
	};
}
// #endregion docs:build-configs
