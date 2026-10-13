/**
 * eslint.config.js
 * Location: packages/svelte-signals
 *
 * Browser, non-React, non-isomorphic package — consumes the shared `base` preset (no React/JSX/a11y
 * stack, no `nodeIsomorphic` browser-API boundary). The binding is pure TS store adapters; the Svelte
 * app that consumes it lives in its own package.
 */
import { base } from '@filter-enginez/eslint/config';

export default base;
