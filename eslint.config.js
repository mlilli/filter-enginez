/**
 * eslint.config.js (repo root)
 *
 * Re-exports the shared `base` preset from `@filter-enginez/eslint/config`, layered
 * with the repo-root `.gitignore`. All framework + isomorphic rules live in the
 * package presets (`react` / `nodeIsomorphic`); each package's own `eslint.config.js`
 * imports the right one.
 *
 * **Flat config does NOT cascade.** ESLint applies a single nearest config to its cwd —
 * it never merges per-directory configs the way legacy `.eslintrc` did. That is why
 * per-package linting runs through `turbo run lint` (which invokes ESLint with each
 * package directory as cwd, activating that package's `eslint.config.js`). This root
 * config therefore governs only repo-ROOT files (this config, root `*.config.*`, `tests/**`
 * and `scripts/**`); `packages/**` is ignored here
 * because turbo owns it per-package. The root `lint` script runs `eslint .` after the turbo
 * pass so these root-governed files are covered by `pnpm lint`, not only the pre-commit hook.
 */

import { includeIgnoreFile } from '@eslint/config-helpers';
import { base } from '@filter-enginez/eslint/config';
import { globalIgnores } from 'eslint/config';
import { fileURLToPath } from 'node:url';

const gitignorePath = fileURLToPath(new URL('./.gitignore', import.meta.url));

export default [
	includeIgnoreFile(gitignorePath),
	// Repo-root ignores (these are root-specific, so they live here rather than in the
	// portable `base` preset):
	//   - `packages/**`        — linted per-package by `turbo run lint` (own cwd + preset)
	//   - `public/**` / `files/mnt/**` — static-asset + ephemeral tool-output roots
	globalIgnores([
		'packages/**',
		// Design deliverables + mockups (logo sketches, UI-kit reference impls): not engine
		// source, deliberately off the project's strict style. Markdown spelling is still
		// covered by cspell separately.
		'docs/**',
		'mockups/**',
		'public/**',
		'**/files/mnt/**',
	]),
	...base,
];
