/**
 * eslint.config.js
 * Location: packages/reactive-signals
 *
 * Isomorphic package — consumes the shared `nodeIsomorphic` preset (Node + ECMA
 * globals only, plus the `@filter-enginez` boundary rules: no-browser-api-in-core
 * + no-direct-mirror-mutation).
 */
import { nodeIsomorphic } from '@filter-enginez/eslint/config';

export default nodeIsomorphic;
