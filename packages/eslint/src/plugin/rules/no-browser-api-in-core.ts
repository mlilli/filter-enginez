/**
 * `no-browser-api-in-core` — flags references to browser-only globals in source files that
 * belong to isomorphic packages, where such references would silently break Node / Cloudflare
 * Workers / Deno / edge-runtime targets.
 *
 * @remarks
 * Per `docs/architecture.md` §17.1 and the isomorphic-boundary rule in `CONTRIBUTING.md`.
 * The isomorphic packages (those using the `nodeIsomorphic` preset) must work in any JS runtime;
 * this rule is the static gate that keeps a browser global out of them.
 *
 * A single `Program:exit` scope-walk checks each reference against the forbidden set and skips
 * shadowed locals via `isResolvedToLocal` (so a `const window = ...` binding is not flagged),
 * rather than a naive `Identifier`-name match.
 *
 * **The forbidden set.** A pragmatic list (not exhaustive) covering the high-traffic
 * accidents. `Worker`, `BroadcastChannel`, `IndexedDB` etc. are not flagged here — they're
 * handled by their respective opt-in browser sub-exports and don't tend to be reached for
 * accidentally. The rule meta accepts an `extraGlobals` option for consumer projects that
 * want to extend the list.
 *
 * **Browser sub-export escape hatch.** Files matching `allowedSubpaths` (default
 * `['**\/storage/browser/**', '**\/browser/**', '**\/keyboard/**']`) are skipped — those paths are intentionally
 * browser-only and exported under explicit sub-paths (e.g.,
 * `@filter-enginez/core/storage/browser`).
 *
 * @packageDocumentation
 */

import type { Rule, Scope } from 'eslint';
import type * as ESTree from 'estree';

import { globMatchesAny } from '../_internal/globMatch.js';

// #region docs:default-lists-and-options
/**
 * The default set of forbidden browser globals.
 */
export const DEFAULT_FORBIDDEN_GLOBALS: readonly string[] = [
	'window',
	'document',
	'localStorage',
	'sessionStorage',
	'history',
	'navigator',
	'XMLHttpRequest',
	'HTMLElement',
	'KeyboardEvent',
	'MouseEvent',
	'CustomEvent',
];

/**
 * The default `allowedSubpaths` patterns — file paths matching these are exempt from the rule
 * because they're already gated behind browser-only sub-exports.
 */
export const DEFAULT_ALLOWED_SUBPATHS: readonly string[] = [
	'**/storage/browser/**',
	'**/browser/**',
	'**/keyboard/**',
];

/**
 * The rule's options shape.
 */
export interface NoBrowserApiInCoreOptions {
	/** Additional globals to forbid (consumer-specific). Appended to the default set. */
	readonly extraGlobals?: readonly string[];
	/** Glob patterns matching files exempt from the rule. Overrides the default if set. */
	readonly allowedSubpaths?: readonly string[];
}
// #endregion docs:default-lists-and-options

/**
 * The rule module.
 */
export const noBrowserApiInCore: Rule.RuleModule = {
	create(context: Rule.RuleContext): Rule.RuleListener {
		// #region docs:resolve-options-and-skip
		// Resolve the rule options against the defaults — `context.options[0]` is the user-passed
		// object or `undefined`. The shape is `NoBrowserApiInCoreOptions` per the schema above.
		const userOptions = (context.options[0] ?? {}) as NoBrowserApiInCoreOptions;
		const extraGlobals = userOptions.extraGlobals ?? [];
		const allowedSubpaths = userOptions.allowedSubpaths ?? DEFAULT_ALLOWED_SUBPATHS;

		// Build the forbidden-globals set once per file invocation. A Set gives O(1) membership
		// checks against the per-Identifier-node walks below.
		const forbiddenGlobals = new Set<string>([...DEFAULT_FORBIDDEN_GLOBALS, ...extraGlobals]);

		// File-level skip: if the file lives under one of the allowed sub-paths (e.g.,
		// `core/src/storage/browser/`), the rule is a no-op for the entire file.
		const filename = context.filename;

		if (globMatchesAny(filename, allowedSubpaths)) {
			return {};
		}
		// #endregion docs:resolve-options-and-skip

		/**
		 * Walk the scope chain from a reference's scope outward; return `true` if the name is
		 * defined as a local binding ANYWHERE in the chain (var, let, const, function param,
		 * import binding, etc.). When `true`, the identifier reference is to the local — not to
		 * a true global — and should NOT be flagged.
		 *
		 * @remarks
		 * `Scope.Reference.resolved` is the ESLint-resolved variable when present; we double-
		 * check by walking the scope chain explicitly because some patterns (e.g., TypeScript
		 * `declare const window: ...`) may not resolve cleanly through the standard analyzer.
		 */
		function isResolvedToLocal(reference: Scope.Reference): boolean {
			if (reference.resolved !== null) {
				// `resolved` points to the variable record; if its scope isn't the global scope,
				// the reference is to a local binding.
				const resolvedScope = reference.resolved.scope;

				if (resolvedScope.type !== 'global') {
					return true;
				}
			}
			// Fallback: walk the scope chain from the reference's scope upward looking for a
			// matching binding by name. Catches `declare const` patterns and TypeScript-flavored
			// shadowing that the analyzer may not surface through `resolved`.
			let currentScope: Scope.Scope | null = reference.from;

			while (currentScope !== null && currentScope.type !== 'global') {
				/* v8 ignore next 3 -- reachable only under the typescript-eslint parser's `declare const` shadowing (an unresolved reference plus a matching scope binding); the espree-based RuleTester cannot emit it, and we add no TS-parser devDep. */
				if (currentScope.set.has(reference.identifier.name)) {
					return true;
				}
				currentScope = currentScope.upper;
			}

			return false;
		}

		/**
		 * Walk every scope in the program (recursively descending into nested scopes) and check
		 * each unresolved reference against the forbidden-globals set. Reports a problem on the
		 * actual identifier node so the editor underlines the right thing.
		 */
		function walkScope(scope: Scope.Scope): void {
			for (const reference of scope.references) {
				const name = reference.identifier.name;

				if (!forbiddenGlobals.has(name)) {
					continue;
				}
				if (isResolvedToLocal(reference)) {
					continue;
				}
				context.report({
					data: { name },
					messageId: 'forbiddenGlobal',
					node: reference.identifier as unknown as ESTree.Node,
				});
			}
			for (const childScope of scope.childScopes) {
				walkScope(childScope);
			}
		}

		return {
			/**
			 * Single-pass walk at `Program:exit` — by that point ESLint's scope analyzer has
			 * resolved every reference, so the `Scope.Reference.resolved` link is reliable.
			 */
			'Program:exit'(): void {
				const sourceCode = context.sourceCode;
				const globalScope = sourceCode.scopeManager.globalScope;

				/* v8 ignore next 3 -- defensive: `scopeManager.globalScope` is always populated after ESLint parses a file; the null guard cannot be reached in practice. */
				if (globalScope === null) {
					return;
				}
				walkScope(globalScope);
			},
		};
	},

	meta: {
		docs: {
			description: 'Forbid browser-only globals in isomorphic packages — they silently break Node / Cloudflare Workers / Deno / edge-runtime targets',
			recommended: false,
			url: 'https://github.com/mlilli/filter-enginez/blob/main/packages/eslint/README.md#no-browser-api-in-core',
		},
		messages: {
			forbiddenGlobal:
				"Browser global '{{name}}' is forbidden in the isomorphic core. Move this code to a /browser/ sub-export or guard the access via `typeof {{name}} !== 'undefined'`.",
		},
		schema: [
			{
				additionalProperties: false,
				properties: {
					allowedSubpaths: {
						items: { type: 'string' },
						type: 'array',
					},
					extraGlobals: {
						items: { type: 'string' },
						type: 'array',
					},
				},
				type: 'object',
			},
		],
		type: 'problem',
	},
};
