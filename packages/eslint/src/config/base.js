/**
 * base.js
 * Location: packages/eslint/src/config
 *
 * The framework-agnostic ESLint flat-config base preset for Filter EngineZ:
 * general + TypeScript (type-aware) + @stylistic + perfectionist + eslint-comments.
 *
 * Layered presets (applied to TS files via block-scoped `extends:`):
 *   - typescript-eslint recommended + recommendedTypeChecked + strict
 *   - @eslint-community/eslint-comments recommended (eslint-disable hygiene)
 *   - @stylistic/eslint-plugin (formatting — single source of truth)
 *   - eslint-plugin-perfectionist (auto-fixable sort rules)
 *
 * **Type-aware linting uses `projectService`.** typescript-eslint resolves each
 * file to its owning package `tsconfig.json` automatically — no per-package
 * `tsconfig.eslint.json` and no `tsconfigRootDir` injection. Under `turbo run
 * lint`, ESLint runs with the package directory as cwd, so the service finds
 * that package's tsconfig. `allowDefaultProject` covers the handful of root-level
 * files the build tsconfigs exclude (config + eslint.config.js).
 *
 * **Globals are Node + ECMA only here.** Browser globals are added by the `react`
 * preset alone, so a stray `window` / `document` in an isomorphic package trips
 * both `no-undef` (for non-TS files) and the `@filter-enginez/no-browser-api-in-core`
 * AST rule (wired in the `nodeIsomorphic` preset).
 *
 * References:
 *   https://eslint.org/docs/latest/use/configure/configuration-files
 *   https://typescript-eslint.io/getting-started/typed-linting/
 *   https://eslint.style/guide/getting-started
 *   https://perfectionist.dev
 */

import commentsConfig from '@eslint-community/eslint-plugin-eslint-comments/configs';
import stylisticPlugin from '@stylistic/eslint-plugin';
import perfectionistPlugin from 'eslint-plugin-perfectionist';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

import { loNodeGlobals, loTestGlobals } from './globals.js';
import { generalRules } from './rules/general.js';
import { perfectionistRules } from './rules/perfectionist.js';
import { stylisticRules } from './rules/stylistic.js';
import { tsRules } from './rules/typescript.js';

// ─── Global Ignores ──────────────────────────────────────────────────────────
//
// Portable glob patterns only — path-independent so the preset works from any
// package's cwd. (The repo-root `.gitignore` is layered in by the root
// `eslint.config.js` via `includeIgnoreFile`, which is the only place that knows
// where the repo root is.)

const ignores = [
	// Logs
	'**/logs',
	'**/*.log',
	'**/*.local',
	'**/npm-debug.log*',
	'**/pnpm-debug.log*',

	// Build / artifact dirs
	'**/coverage',
	'**/dist',
	'**/dist-ssr',
	'**/node_modules',
	'build',
	'output',

	// Env files (lint .env.example, ignore everything else)
	'**/.env',
	'**/.env.*',
	'!**/.env.example',
	'!**/.env.test',

	// IDE / OS noise
	'**/.idea',
	'**/.DS_Store',
	'**/Thumbs.db',
	'**/*.sw?',
	'.vscode/settings.json',

	// Vite / Vitest generated artifacts
	'**/vite.config.js.timestamp-*',
	'**/vite.config.ts.timestamp-*',
	'__snapshots__/**',

	// Vendored / generated files served verbatim from an app's `public/` — never authored here.
	// MSW ships `mockServiceWorker.js` (its own `/* eslint-disable */` header trips the
	// eslint-comments rules); TypeDoc emits a minified `public/api/` bundle (`pnpm docs:api`).
	'**/public/mockServiceWorker.js',
	'**/public/api/**',

	// Lockfiles + ephemeral output roots
	'package-lock.json',
	'pnpm-lock.yaml',
];

export const base = defineConfig(
	// Ignores must be first (and as separate top-level entries).
	globalIgnores(ignores),

	// eslint-comments hygiene — flat-config-style preset.
	commentsConfig.recommended,

	// Layered on top of the recommended preset: require a `-- <rationale>`
	// description after every `eslint-disable*` directive so future bare
	// disables fail CI rather than slipping in. `eslint-enable` is exempt —
	// the description on the paired disable is sufficient context.
	{
		rules: {
			'@eslint-community/eslint-comments/require-description': [
				'error',
				{
					ignore: ['eslint-enable'],
				},
			],
		},
	},

	// General rules + Node/ECMA-globals default — apply to every file.
	{
		languageOptions: {
			globals: loNodeGlobals,
		},
		rules: generalRules,
	},

	// TypeScript files — type-aware linting via `projectService`.
	// Presets via block-scoped `extends:` (only apply to .ts/.tsx files).
	// Order matters: recommended → recommendedTypeChecked → strict. `tsRules`
	// then layers the project's custom overrides on top.
	//
	// We deliberately do NOT extend `tseslint.configs.stylistic` —
	// @stylistic/eslint-plugin (configured below) covers that work.
	{
		extends: [
			tseslint.configs.recommended,
			tseslint.configs.recommendedTypeChecked,
			tseslint.configs.strict,
		],
		files: ['**/*.ts', '**/*.tsx'],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: {
				projectService: {
					// Only the handful of root-level tooling files that no package
					// tsconfig includes (Vite / Vitest / ESLint config files). Test
					// files are deliberately NOT listed here: each package's
					// `tsconfig.json` INCLUDES `**/*.test.ts(x)` (it is
					// non-composite + noEmit), so the project service resolves every
					// test to that real program — accurate types AND no 8-file
					// default-project cap. The sibling `tsconfig.build.json` (composite,
					// emits `dist`) excludes tests so they never ship. Globs are
					// cwd-relative (ESLint runs per package via `turbo run lint`) and
					// `**`-free per typescript-eslint.
					allowDefaultProject: [
						'*.config.js',
						'*.config.mjs',
						'*.config.ts',
						'eslint.config.js',
					],
				},
			},
		},
		rules: tsRules,
	},

	// Stylistic — disable ESLint's deprecated legacy formatting rules + apply
	// the @stylistic equivalents.
	stylisticPlugin.configs['disable-legacy'],
	{
		plugins: {
			stylistic: stylisticPlugin,
		},
		rules: stylisticRules,
	},

	// Perfectionist — auto-fixable sort rules.
	{
		plugins: {
			perfectionist: perfectionistPlugin,
		},
		rules: perfectionistRules,
	},

	// scripts/**/*.{cjs,js,mjs} — Node CLI helpers (build / dev / release scripts).
	// They run via `node` directly with CLI-specific idioms: legitimate
	// `console.log` for stdout, top-of-file orchestration calling
	// below-defined helpers (function-hoisting is fine), and naturally higher
	// branch counts than library code.
	{
		files: ['scripts/**/*.{cjs,js,mjs}'],
		rules: {
			complexity: ['error', { max: 25 }],
			'no-console': 'off',
			'no-use-before-define': [
				'error',
				{ classes: true, functions: false, variables: true },
			],
			'sort-keys': 'off',
		},
	},

	// Test files — relax a couple of rules that don't carry their weight in
	// unit-test code (the file-size cap and magic-number assertions). All other
	// rules stay active — tests should still be clean and consistent.
	{
		files: ['**/*.test.ts', '**/*.test.tsx'],
		languageOptions: {
			globals: loTestGlobals,
		},
		rules: {
			'@typescript-eslint/no-magic-numbers': 'off',
			'max-lines': 'off',
		},
	},
);

export default base;
