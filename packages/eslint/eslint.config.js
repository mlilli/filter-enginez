/**
 * eslint.config.js
 * Location: packages/eslint
 *
 * This tooling package lints itself with the framework-agnostic `base` preset,
 * imported via a relative path — no self-referential package resolution, and it
 * avoids pulling in `node.js` (which imports the built plugin).
 */
import base from './src/config/base.js';

export default base;
