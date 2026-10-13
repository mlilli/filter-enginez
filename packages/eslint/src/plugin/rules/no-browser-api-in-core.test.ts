/**
 * @remarks
 * RuleTester coverage for `no-browser-api-in-core`. Exercises the forbidden-global set, the
 * `extraGlobals` + `allowedSubpaths` options, the `isResolvedToLocal` shadowing guard (local
 * const / function param / import binding / `/* global *\/`-declared global-scope resolution),
 * the nested-scope walk, and the file-level subpath skip. Uses ESLint's built-in `RuleTester`
 * with the default espree parser — the rule is scope/AST-based and needs no type information.
 *
 * Two branches are not reachable from here and carry a `v8 ignore` comment in the rule
 * (§22.3 Form 1): the `isResolvedToLocal` scope-walk's `return true` (reachable only under the
 * typescript-eslint parser's `declare const` shadowing, which espree cannot emit) and the
 * defensive `globalScope === null` guard.
 */

import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';

import { noBrowserApiInCore } from './no-browser-api-in-core.js';

// Wire RuleTester's static hooks to Vitest so each case registers as a Vitest test.
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
	languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
});

const CORE_FILE = 'packages/core/src/Engine.ts';

ruleTester.run('no-browser-api-in-core', noBrowserApiInCore, {
	invalid: [
		{
			// Bare browser global referenced (unresolved) in a core-path file.
			code: 'window.matchMedia("(min-width: 0px)");',
			errors: [{ data: { name: 'window' }, messageId: 'forbiddenGlobal' }],
			filename: CORE_FILE,
		},
		{
			// Two distinct forbidden globals → two reports, in source order.
			code: 'document.querySelector("a"); navigator.userAgent;',
			errors: [
				{ data: { name: 'document' }, messageId: 'forbiddenGlobal' },
				{ data: { name: 'navigator' }, messageId: 'forbiddenGlobal' },
			],
			filename: CORE_FILE,
		},
		{
			// A forbidden global referenced from a nested function scope — exercises the
			// scope-chain walk up through non-global scopes.
			code: 'function outer() { function inner() { return document.title; } return inner; }',
			errors: [{ data: { name: 'document' }, messageId: 'forbiddenGlobal' }],
			filename: CORE_FILE,
		},
		{
			// A `/* global */`-declared name resolves to the GLOBAL scope; the rule still flags
			// it (exercises the global-scope-resolution branch of `isResolvedToLocal`).
			code: '/* global window */\nwindow.name;',
			errors: [{ data: { name: 'window' }, messageId: 'forbiddenGlobal' }],
			filename: CORE_FILE,
		},
		{
			// `extraGlobals` extends the default forbidden set.
			code: 'fetch("/api");',
			errors: [{ data: { name: 'fetch' }, messageId: 'forbiddenGlobal' }],
			filename: CORE_FILE,
			options: [{ extraGlobals: ['fetch']}],
		},
		{
			// A custom `allowedSubpaths` overrides the default, so a `/browser/` path is no
			// longer exempt and the global is flagged.
			code: 'window.location.href;',
			errors: [{ data: { name: 'window' }, messageId: 'forbiddenGlobal' }],
			filename: 'packages/core/src/storage/browser/Adapter.ts',
			options: [{ allowedSubpaths: ['**/nowhere/**']}],
		},
	],
	valid: [
		{
			// Locally-declared `window` binding shadows the global — not flagged.
			code: 'const window = { inner: 1 }; window.inner;',
			filename: CORE_FILE,
		},
		{
			// Function-parameter binding named `document`.
			code: 'function render(document) { return document.body; }',
			filename: CORE_FILE,
		},
		{
			// An import binding named after a forbidden global resolves to module scope.
			code: 'import { history } from "./router.js"; history.push("/x");',
			filename: CORE_FILE,
		},
		{
			// Forbidden names appearing only as object keys / member properties are not scope
			// references, so they are never flagged.
			code: 'const shim = { document: 1, navigator: 2 }; shim.document + shim.navigator;',
			filename: CORE_FILE,
		},
		{
			// A non-forbidden global is ignored.
			code: 'console.log("ok");',
			filename: CORE_FILE,
		},
		{
			// File under a default `allowedSubpaths` glob (`**/browser/**`) is skipped entirely.
			code: 'window.localStorage; document.title;',
			filename: 'packages/core/src/storage/browser/LocalStorageAdapter.ts',
		},
		{
			// A `**/keyboard/**` path is also exempt by default.
			code: 'new KeyboardEvent("keydown");',
			filename: 'packages/react-signals/src/keyboard/handlers.ts',
		},
	],
});
