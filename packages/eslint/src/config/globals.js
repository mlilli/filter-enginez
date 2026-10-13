/**
 * globals.js
 * Location: packages/eslint/src/config
 *
 * Shared `languageOptions.globals` bundles for the Filter EngineZ flat-config presets.
 *
 * The `lo*` prefix is short for "languageOption". Browser globals live ONLY in
 * `loBrowserGlobals` (consumed by the `react` preset); the `base` + `nodeIsomorphic`
 * presets deliberately expose Node + ECMA globals only, so a stray `window` /
 * `document` reference in an isomorphic package trips `no-undef` as well as the
 * custom `@filter-enginez/no-browser-api-in-core` AST rule.
 */

import vitestPlugin from '@vitest/eslint-plugin';
import globals from 'globals';

export const loEcmaGlobals = {
	...globals.es2022,
};

/**
 * Type-only ambient names needed because ESLint core `no-undef` does not use
 * TypeScript's `lib`, `types`, or ambient namespace resolution.
 *
 * These are not runtime globals. They exist here only to prevent false positives
 * while intentionally keeping `no-undef` enabled for non-TS files.
 */
export const loTypeOnlyGlobalsForNoUndef = {
	CustomElementConstructor: 'readonly',
	MutationCallback: 'readonly',
	NodeJS: 'readonly',
	NodeListOf: 'readonly',
	RequestInfo: 'readonly',
	RequestInit: 'readonly',
	VoidFunction: 'readonly',
};

export const loBrowserGlobals = {
	...loEcmaGlobals,
	...globals.browser,
	...loTypeOnlyGlobalsForNoUndef,
};

export const loNodeGlobals = {
	...loEcmaGlobals,
	...globals.node,
	// Needed only because `no-undef` is intentionally enabled for non-TS files.
	NodeJS: 'readonly',
};

export const loTestGlobals = {
	...loBrowserGlobals,
	...globals.node,
	...vitestPlugin.environments.env.globals,
};
