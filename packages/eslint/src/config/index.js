/**
 * index.js
 * Location: packages/eslint/src/config
 *
 * Barrel for the `@filter-enginez/eslint/config` subpath export. Ships the three
 * shared flat-config presets:
 *
 *   - `base`          — framework-agnostic (general + TS + stylistic + perfectionist)
 *   - `react`         — `base` + browser globals + React / JSX / a11y stack
 *   - `nodeIsomorphic` — `base` + the custom isomorphic-boundary / mirror rules
 *
 * @example
 *   // a React package's eslint.config.js
 *   import { react } from '@filter-enginez/eslint/config';
 *   export default react;
 */

export { base } from './base.js';
export { nodeIsomorphic } from './node.js';
export { react } from './react.js';
