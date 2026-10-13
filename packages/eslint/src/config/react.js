/**
 * react.js
 * Location: packages/eslint/src/config
 *
 * The browser + React flat-config preset: `base` plus browser globals, browser-
 * compatibility checking (eslint-plugin-compat), and the React / JSX / a11y
 * plugin stack. Consumed by every browser-only package with JSX — here
 * `react-signals`, `react-rxjs` and `url-state-router`, plus the React packages
 * in the separate examples repository.
 *
 * Consumers reduce to a one-liner:
 *
 *   import { react } from '@filter-enginez/eslint/config';
 *   export default react;
 *
 * Every plugin is registered MANUALLY via the `plugins:` map and only each
 * plugin's `.rules` are spread, rather than `extends:`-ing their presets. Preset
 * shapes have drifted between majors before (`eslint-plugin-react-hooks@5`
 * shipped an eslintrc-shaped `configs.recommended` that flat config rejects), and
 * spreading rules alone is immune to that.
 *
 * Every plugin here declares ESLint 10 in its own peer range — no compatibility
 * shims, no peer-range overrides:
 *
 *   - `@eslint-react/eslint-plugin` (`recommended-type-checked`) replaced
 *     `eslint-plugin-react`, whose latest release (7.37.5) calls APIs ESLint 10
 *     removed and crashed on load without a shim.
 *   - `eslint-plugin-jsx-a11y-x` replaced `eslint-plugin-jsx-a11y` (latest 6.10.2,
 *     peer range `^9` at most). It is a maintained fork with the same rules under a
 *     `jsx-a11y-x/` prefix.
 *   - `eslint-plugin-react-hooks` contributes its full `recommended` set: the Rules
 *     of Hooks plus the React Compiler checks (`set-state-in-effect`, `refs`,
 *     `purity`, `immutability`, …).
 *
 * 🔴 `@eslint-react` ships its own ports of those same hooks and compiler rules.
 * They are switched off below (`HOOKS_RULES_OWNED_BY_REACT_HOOKS`) so each problem
 * is reported once, by the React team's own plugin — two plugins reporting the
 * same line under different names would make every suppression comment ambiguous.
 *
 * Type-checked: the `@eslint-react` preset needs type information, which `base`
 * already provides for `.ts` / `.tsx` through typescript-eslint's project service.
 */

import eslintReactPlugin from '@eslint-react/eslint-plugin';
import compatPlugin from 'eslint-plugin-compat';
import jsxA11yXPlugin from 'eslint-plugin-jsx-a11y-x';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

import base from './base.js';
import { loBrowserGlobals } from './globals.js';
import { reactRules } from './rules/react.js';

/**
 * `@eslint-react` rules that duplicate an `eslint-plugin-react-hooks` rule of the same
 * name. Kept in step with `@eslint-react`'s own `disable-conflict-eslint-plugin-react-hooks`
 * preset, inverted: that preset silences the React team's plugin, and this list silences
 * the port instead.
 */
const HOOKS_RULES_OWNED_BY_REACT_HOOKS = [
	'error-boundaries',
	'exhaustive-deps',
	'globals',
	'immutability',
	'purity',
	'refs',
	'rules-of-hooks',
	'set-state-in-effect',
	'set-state-in-render',
	'static-components',
	'unsupported-syntax',
	'use-memo',
];

const eslintReactPreset = eslintReactPlugin.configs['recommended-type-checked'];

/**
 * Raise every rule a preset enables to `error`.
 *
 * @remarks
 * Package `lint` scripts run without `--max-warnings=0`, so a preset rule left at `warn`
 * would report and still pass CI. Every rule this preset enables is meant to block, the
 * same as the `react/*` rules it replaced.
 *
 * @param {Readonly<Record<string, unknown>>} rules - A preset's `rules` map.
 * @returns {Record<string, unknown>} The same map with every `warn` / `1` entry raised to `error`.
 */
const asErrors = (rules) =>
	Object.fromEntries(
		Object.entries(rules).map(([name, entry]) => {
			const [severity, ...options] = Array.isArray(entry) ? entry : [entry];
			const raised = severity === 'warn' || severity === 1 ? 'error' : severity;

			return [name, Array.isArray(entry) ? [raised, ...options] : raised];
		}),
	);

export const react = [
	// Inherit the framework-agnostic base.
	...base,

	// Browser compatibility checking (against the repo browserslist).
	compatPlugin.configs['flat/recommended'],
	{
		files: ['src/**/*.ts', 'src/**/*.tsx'],
		rules: {
			'compat/compat': 'error',
		},
		settings: {
			// The repo browserslist includes "maintained node versions" (for the isomorphic packages),
			// which makes `compat` flag browser-only APIs as "unsupported in Node". The Clipboard API is
			// supported in every real browser target ("defaults and fully supports es6-module") and
			// callers degrade gracefully on rejection, so declare it handled rather than disable the rule.
			polyfills: ['navigator.clipboard', 'navigator.clipboard.writeText'],
		},
	},

	// Browser globals — added ONLY in the React preset, so isomorphic packages
	// (which use `base` / `nodeIsomorphic`) never silently gain `window` et al.
	{
		languageOptions: {
			globals: loBrowserGlobals,
		},
	},

	// React + accessibility — `.tsx` files only.
	{
		files: ['**/*.tsx'],
		plugins: {
			...eslintReactPreset.plugins,
			'jsx-a11y-x': jsxA11yXPlugin,
			'react-hooks': reactHooksPlugin,
		},
		rules: {
			...asErrors(eslintReactPreset.rules),
			...Object.fromEntries(HOOKS_RULES_OWNED_BY_REACT_HOOKS.map((name) => [`@eslint-react/${name}`, 'off'])),
			...asErrors(jsxA11yXPlugin.configs.strict.rules),
			...asErrors(reactHooksPlugin.configs.recommended.rules),
			...reactRules,
		},
		settings: {
			...eslintReactPreset.settings,
		},
	},
];

export default react;
