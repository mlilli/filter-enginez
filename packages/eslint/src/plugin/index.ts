/**
 * @filter-enginez/eslint/plugin
 *
 * Custom ESLint rules for Filter EngineZ:
 *
 *   - `no-browser-api-in-core` — enforces the isomorphic boundary (enabled for this repo's
 *     isomorphic packages by the `nodeIsomorphic` preset in `@filter-enginez/eslint/config`)
 *   - `no-direct-mirror-mutation` — enforces redux-bridge mirror read-only contract
 *   - `filter-rule-naming-convention` — encourages `*Rule` naming + `**\/rules/**` location
 *     (off-by-default)
 *
 * Plus two config presets: `configs.recommended` (the always-on safety rule) and
 * `configs.strict` (adds the optional convention rule).
 *
 * @remarks
 * Each rule's `meta.docs.url` points at its section of the package README.
 *
 * @example
 *   // eslint.config.js
 *   import filterEnginez from '@filter-enginez/eslint/plugin';
 *
 *   export default [
 *     filterEnginez.configs.recommended,
 *     // or for the strict preset:
 *     filterEnginez.configs.strict,
 *   ];
 *
 * See `docs/architecture.md` §17.
 *
 * @packageDocumentation
 */

import { buildConfigs, type FlatConfigPreset } from './configs.js';
import { filterRuleNamingConvention } from './rules/filter-rule-naming-convention.js';
import { noBrowserApiInCore } from './rules/no-browser-api-in-core.js';
import { noDirectMirrorMutation } from './rules/no-direct-mirror-mutation.js';

// Re-export rule modules + per-rule option types for consumers that want to wire rules manually.
export {
	DEFAULT_FORBIDDEN_GLOBALS,
	DEFAULT_ALLOWED_SUBPATHS as DEFAULT_NO_BROWSER_API_ALLOWED_SUBPATHS,
	noBrowserApiInCore,
	type NoBrowserApiInCoreOptions,
} from './rules/no-browser-api-in-core.js';

export {
	DEFAULT_ALLOWED_SUBPATHS as DEFAULT_NO_DIRECT_MIRROR_MUTATION_ALLOWED_SUBPATHS,
	noDirectMirrorMutation,
	type NoDirectMirrorMutationOptions,
} from './rules/no-direct-mirror-mutation.js';

export {
	filterRuleNamingConvention,
	type FilterRuleNamingConventionOptions,
} from './rules/filter-rule-naming-convention.js';

export { type FlatConfigPreset } from './configs.js';

/**
 * The plugin's rule map — keys are the rule names as they appear in consumer config
 * (`'@filter-enginez/<rule-name>'`).
 */
const rules = {
	'filter-rule-naming-convention': filterRuleNamingConvention,
	'no-browser-api-in-core': noBrowserApiInCore,
	'no-direct-mirror-mutation': noDirectMirrorMutation,
};

/**
 * The plugin instance. Default export so consumers can `import filterEnginez from
 * '@filter-enginez/eslint-plugin'` and reference both `filterEnginez.rules` and
 * `filterEnginez.configs.recommended`.
 */
const plugin: {
	readonly configs: {
		readonly recommended: FlatConfigPreset;
		readonly strict: FlatConfigPreset;
	};
	readonly meta: { readonly name: string; readonly version: string };
	readonly rules: typeof rules;
} = {
	// `buildConfigs` is called eagerly here — the config presets capture a reference to
	// `plugin` itself (cyclic but resolved by JS object-literal hoisting).
	configs: buildConfigs({ rules }),
	meta: {
		name: '@filter-enginez/eslint',
		version: '0.0.1',
	},
	rules,
};

export default plugin;
