/**
 * eslint.config.js
 * Location: packages/angular-rxjs
 *
 * The shared `base` preset is sufficient: this package is plain TypeScript (an `InjectionToken`, a
 * provider factory, and a thin service) with no templates and no decorators, so none of the
 * `angular-eslint` template tooling applies here. The Angular EXAMPLE app wires that separately.
 *
 * Browser globals are layered in because the binding is browser-only (Angular DI in a browser app),
 * and the `base` preset deliberately withholds them from isomorphic code.
 */
import { base } from '@filter-enginez/eslint/config';
import globals from 'globals';

export default [
	{
		ignores: ['dist/**'],
	},
	...base,
	{
		files: ['src/**/*.ts'],
		languageOptions: {
			globals: {
				...globals.browser,
			},
		},
	},
];
