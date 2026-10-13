/**
 * `filter-rule-naming-convention` — encourages two consistency conventions for `FilterRule`
 * subclasses: class names end in `Rule`, and definitions live under a `**\/rules/**` directory.
 *
 * @remarks
 * Per `docs/architecture.md` §17.3. Off-by-default — not every consumer will agree with the
 * convention, and the engine works fine without it. Listed in `configs.strict` (at `warn`) for
 * projects that opt in to the full house style.
 *
 * **The two checks**:
 *
 *   1. **Suffix check**: any class whose direct superclass is `FilterRule` (or `BaseFilterRule` /
 *      `AbstractFilterRule`) must end in `Rule`. Catches `class PriceFilter extends FilterRule { ... }` and reports it as
 *      "PriceFilter should be named PriceRule".
 *   2. **Location check**: the class must live in a file path matching `**\/rules/**`. Catches
 *      one-off custom rules buried in unrelated directories.
 *
 * `ClassDeclaration` + `ClassExpression` visitors run both checks; options
 * `requireRuleSuffix`, `requireRulesDirectory` and `rulesDirectoryGlob` tune them.
 *
 * @packageDocumentation
 */

import type { Rule } from 'eslint';
import type * as ESTree from 'estree';

import { globMatchesPath } from '../_internal/globMatch.js';

/**
 * The base-class name that triggers this rule. A class extending `FilterRule` (directly or
 * via a known intermediate base like `BaseFilterRule` / `AbstractFilterRule`) is in scope.
 *
 * @internal
 */
const FILTER_RULE_BASE_NAMES: ReadonlySet<string> = new Set([
	'FilterRule',
	'BaseFilterRule',
	'AbstractFilterRule',
]);

/**
 * The default location glob — `**\/rules/**` matches any file under any `rules/` directory.
 *
 * @internal
 */
const DEFAULT_RULES_DIRECTORY_GLOB = '**/rules/**';

/**
 * The rule's options shape.
 */
export interface FilterRuleNamingConventionOptions {
	/**
	 * If `false`, the suffix check is disabled (only the location check applies). Default `true`.
	 */
	readonly requireRuleSuffix?: boolean;

	/**
	 * If `false`, the location check is disabled (only the suffix check applies). Default `true`.
	 */
	readonly requireRulesDirectory?: boolean;

	/**
	 * Override the location glob. Defaults to `'**\/rules/**'`.
	 */
	readonly rulesDirectoryGlob?: string;
}

/**
 * The rule module.
 */
export const filterRuleNamingConvention: Rule.RuleModule = {
	create(context: Rule.RuleContext): Rule.RuleListener {
		const userOptions = (context.options[0] ?? {}) as FilterRuleNamingConventionOptions;
		const shouldRequireRuleSuffix = userOptions.requireRuleSuffix ?? true;
		const shouldRequireRulesDirectory = userOptions.requireRulesDirectory ?? true;
		const rulesDirectoryGlob = userOptions.rulesDirectoryGlob ?? DEFAULT_RULES_DIRECTORY_GLOB;

		const filename = context.filename;

		/**
		 * Check whether a class node's superclass identifier matches one of the known FilterRule
		 * base names. Only flags single-level inheritance — transitive ancestry detection would
		 * need cross-file type-flow analysis, which we deliberately avoid (this rule trades
		 * recall for keeping the plugin dep-free + fast).
		 *
		 * @internal
		 */
		function isFilterRuleSubclass(node: ESTree.ClassDeclaration | ESTree.ClassExpression): boolean {
			// `@types/estree` types `superClass` as optional AND nullable — absent on a class with no
			// `extends` clause is `null` in practice, but the optional chain covers both shapes.
			const superClass = node.superClass;

			if (superClass?.type !== 'Identifier') {
				return false;
			}

			return FILTER_RULE_BASE_NAMES.has(superClass.name);
		}

		// #region docs:check-class
		/**
		 * Shared handler for both class-declaration and class-expression nodes. Runs both
		 * configured checks (suffix + location) against the class name and the file path.
		 *
		 * @internal
		 */
		function checkClass(node: ESTree.ClassDeclaration | ESTree.ClassExpression): void {
			if (!isFilterRuleSubclass(node)) {
				return;
			}
			// Anonymous class expressions have no `id`; skip — they can't violate a naming rule
			// because they have no name to violate.
			const id = node.id;

			if (id === null || id === undefined) {
				return;
			}
			const className = id.name;

			if (shouldRequireRuleSuffix && !className.endsWith('Rule')) {
				// Suggest a name — strip a trailing `Filter` if present (a common typo) and
				// append `Rule`. `PriceFilter` → `PriceRule`, `Color` → `ColorRule`.
				const stripped = className.replace(/Filter$/u, '');
				const suggested = `${stripped}Rule`;

				context.report({
					data: { className, suggested },
					messageId: 'missingSuffix',
					node: id as unknown as ESTree.Node,
				});
			}

			if (shouldRequireRulesDirectory && !globMatchesPath(filename, rulesDirectoryGlob)) {
				context.report({
					data: { className },
					messageId: 'outsideRulesDirectory',
					node: id as unknown as ESTree.Node,
				});
			}
		}
		// #endregion docs:check-class

		return {
			ClassDeclaration: checkClass,
			ClassExpression: checkClass,
		};
	},

	meta: {
		docs: {
			description: 'Encourage *Rule class-name suffix + **/rules/** location for FilterRule subclasses',
			recommended: false,
			url: 'https://github.com/mlilli/filter-enginez/blob/main/packages/eslint/README.md#filter-rule-naming-convention',
		},
		messages: {
			missingSuffix:
				"Class '{{className}}' extends FilterRule but doesn't end in 'Rule'. Rename to '{{suggested}}' for consistency with the built-in rule catalog.",
			outsideRulesDirectory:
				"Class '{{className}}' extends FilterRule but isn't in a **/rules/** directory. Move to packages/.../rules/ or src/rules/ to match the convention.",
		},
		schema: [
			{
				additionalProperties: false,
				properties: {
					requireRulesDirectory: { type: 'boolean' },
					requireRuleSuffix: { type: 'boolean' },
					rulesDirectoryGlob: { type: 'string' },
				},
				type: 'object',
			},
		],
		type: 'suggestion',
	},
};
