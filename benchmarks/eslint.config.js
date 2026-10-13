/**
 * eslint.config.js
 * Location: benchmarks
 *
 * Node-only tooling package — consumes the shared `nodeIsomorphic` preset (Node + ECMA
 * globals, plus the `@filter-enginez` boundary rules). The benchmark harness deliberately
 * uses `node:` builtins + `process` + `console`, all of which the preset permits.
 */
import { nodeIsomorphic } from '@filter-enginez/eslint/config';

export default nodeIsomorphic;
