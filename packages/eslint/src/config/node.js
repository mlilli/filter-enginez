/**
 * node.js
 * Location: packages/eslint/src/config
 *
 * The isomorphic / Node flat-config preset: `base` plus the Filter EngineZ
 * boundary-enforcement rules. Consumed by every package that MUST run in any JS
 * runtime (`core`, `reactive-signals`, `reactive-rxjs`, `redux-bridge`,
 * `mock-data`, `worker-bridge`) and by this `@filter-enginez/eslint` package
 * itself.
 *
 * Consumers reduce to a one-liner:
 *
 *   import { nodeIsomorphic } from '@filter-enginez/eslint/config';
 *   export default nodeIsomorphic;
 *
 * This is where the custom rules finally switch on. `base` already exposes Node +
 * ECMA globals only (no browser globals), so the isomorphic boundary is enforced
 * two ways: `no-undef` flags bare browser globals in non-TS files, and
 * `@filter-enginez/no-browser-api-in-core` catches `window` / `document` /
 * `localStorage` / … usage in the AST (with the `**\/browser/**` sub-export
 * escape hatch baked into the rule's defaults).
 *
 * The plugin is imported via the package's own `./plugin` subpath export, which
 * resolves to the BUILT `dist/plugin/index.js` — hence `turbo run lint` depends
 * on `@filter-enginez/eslint#build`.
 */

import filterEnginez from '@filter-enginez/eslint/plugin';

import base from './base.js';

export const nodeIsomorphic = [
	// Inherit the framework-agnostic base (Node + ECMA globals; no browser).
	...base,

	{
		plugins: {
			'@filter-enginez': filterEnginez,
		},
		rules: {
			// Isomorphic boundary: forbid browser-only globals (the preset itself
			// is the per-package scoping the rule's docs call for).
			'@filter-enginez/no-browser-api-in-core': 'error',
			// Redux mirror immutability: the mirror slice is mutated only by the
			// bridge in response to engine events.
			'@filter-enginez/no-direct-mirror-mutation': 'error',
		},
	},
];

export default nodeIsomorphic;
