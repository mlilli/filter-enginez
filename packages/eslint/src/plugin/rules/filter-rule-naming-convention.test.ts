/**
 * @remarks
 * RuleTester coverage for `filter-rule-naming-convention`. Exercises both reports (the `*Rule`
 * suffix check with its `Filter$`-strip suggestion, and the `**\/rules/**` location check), the
 * three options (`requireRuleSuffix`, `requireRulesDirectory`, `rulesDirectoryGlob`), the
 * `FilterRule` / `BaseFilterRule` / `AbstractFilterRule` superclass detection, non-subclass and
 * non-Identifier superclasses, and the anonymous-class-expression skip.
 */

import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';

import { filterRuleNamingConvention } from './filter-rule-naming-convention.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
	languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
});

const RULES_FILE = 'packages/core/src/rules/PriceRule.ts';
const NON_RULES_FILE = 'packages/core/src/engine/PriceRule.ts';

ruleTester.run('filter-rule-naming-convention', filterRuleNamingConvention, {
	invalid: [
		{
			// Missing `Rule` suffix; the `Filter` tail is stripped in the suggestion.
			code: 'class PriceFilter extends FilterRule {}',
			errors: [{ data: { className: 'PriceFilter', suggested: 'PriceRule' }, messageId: 'missingSuffix' }],
			filename: RULES_FILE,
		},
		{
			// Missing `Rule` suffix with no `Filter` tail → bare `+ Rule`.
			code: 'class Color extends FilterRule {}',
			errors: [{ data: { className: 'Color', suggested: 'ColorRule' }, messageId: 'missingSuffix' }],
			filename: RULES_FILE,
		},
		{
			// Correctly suffixed but located outside a `**/rules/**` directory.
			code: 'class PriceRule extends FilterRule {}',
			errors: [{ data: { className: 'PriceRule' }, messageId: 'outsideRulesDirectory' }],
			filename: NON_RULES_FILE,
		},
		{
			// Both violations at once — suffix report precedes the location report.
			code: 'class DealerFilter extends FilterRule {}',
			errors: [
				{ data: { className: 'DealerFilter', suggested: 'DealerRule' }, messageId: 'missingSuffix' },
				{ data: { className: 'DealerFilter' }, messageId: 'outsideRulesDirectory' },
			],
			filename: NON_RULES_FILE,
		},
		{
			// A named class expression is checked the same way as a declaration.
			code: 'const RuleImpl = class ColorFilter extends FilterRule {};',
			errors: [{ data: { className: 'ColorFilter', suggested: 'ColorRule' }, messageId: 'missingSuffix' }],
			filename: RULES_FILE,
		},
	],
	valid: [
		{
			// Properly named and located.
			code: 'class PriceRule extends FilterRule {}',
			filename: RULES_FILE,
		},
		{
			// `BaseFilterRule` is a recognized base name.
			code: 'class RangeRule extends BaseFilterRule {}',
			filename: RULES_FILE,
		},
		{
			// `AbstractFilterRule` is a recognized base name.
			code: 'class ExistsRule extends AbstractFilterRule {}',
			filename: RULES_FILE,
		},
		{
			// Not a FilterRule subclass — out of scope entirely.
			code: 'class Widget extends Component {}',
			filename: NON_RULES_FILE,
		},
		{
			// No superclass.
			code: 'class PlainHelper {}',
			filename: NON_RULES_FILE,
		},
		{
			// Non-Identifier superclass (a member expression) is not matched.
			code: 'class Extended extends namespace.Base {}',
			filename: NON_RULES_FILE,
		},
		{
			// Anonymous class expression has no id to check.
			code: 'const Impl = class extends FilterRule {};',
			filename: NON_RULES_FILE,
		},
		{
			// `requireRuleSuffix: false` disables the suffix check.
			code: 'class PriceFilter extends FilterRule {}',
			filename: RULES_FILE,
			options: [{ requireRuleSuffix: false }],
		},
		{
			// `requireRulesDirectory: false` disables the location check.
			code: 'class PriceRule extends FilterRule {}',
			filename: NON_RULES_FILE,
			options: [{ requireRulesDirectory: false }],
		},
		{
			// A custom `rulesDirectoryGlob` accepts an alternate directory.
			code: 'class PriceRule extends FilterRule {}',
			filename: 'packages/core/src/filters/PriceRule.ts',
			options: [{ rulesDirectoryGlob: '**/filters/**' }],
		},
	],
});
