/**
 * rules/react.js
 * Location: packages/eslint/src/config/rules
 *
 * React / JSX rule deltas — the single source of truth for the project's React
 * house style.
 *
 * Base rules come from the presets spread in `react.js` (the preset assembler):
 *   - `@eslint-react/eslint-plugin` `recommended-type-checked`  (React + DOM + web-API correctness)
 *   - `eslint-plugin-jsx-a11y-x` `strict`                       (a11y best practices)
 *   - `eslint-plugin-react-hooks` `recommended`                 (Rules of Hooks + React Compiler checks)
 *
 * `reactRules` is our delta on top — stricter severities and the house-style rules
 * the presets leave off.
 *
 * ── Carried over from `eslint-plugin-react` ───────────────────────────────────
 *
 * The rules below that start `@eslint-react/` or `stylistic/jsx-` stand in for the
 * `eslint-plugin-react` `react/*` rules, using plugins that support ESLint 10. Seven
 * `react/*` rules have no equivalent in any ESLint-10-compatible plugin and are not
 * enforced (the code follows them by convention):
 * `function-component-definition` (arrow-function components), `jsx-no-bind`,
 * `jsx-max-depth` (6), `jsx-fragments` (`<>` syntax), `jsx-filename-extension`
 * (TypeScript already rejects JSX outside `.tsx`), `jsx-props-no-spread-multi`,
 * and `no-invalid-html-attribute`.
 */
export const reactRules = {
	/**
	 * React correctness. Each rule names the `react/*` rule it succeeds. The ones the
	 * `recommended-type-checked` preset leaves off are switched on here; the rest are
	 * preset rules, listed so the successor mapping stays complete in one place.
	 */
	'@eslint-react/dom-no-dangerously-set-innerhtml': 'error', // react/no-danger
	'@eslint-react/dom-no-missing-button-type': 'error', // react/button-has-type
	'@eslint-react/dom-no-missing-iframe-sandbox': 'error', // react/iframe-missing-sandbox
	'@eslint-react/dom-no-script-url': 'error', // react/jsx-no-script-url
	'@eslint-react/dom-no-unknown-property': 'error', // react/no-unknown-property
	'@eslint-react/dom-no-unsafe-target-blank': 'error', // react/jsx-no-target-blank
	'@eslint-react/jsx-no-children-prop': 'error', // react/no-children-prop
	'@eslint-react/jsx-no-comment-textnodes': 'error', // react/jsx-no-comment-textnodes
	'@eslint-react/jsx-no-useless-fragment': ['error', { allowExpressions: true }], // react/jsx-no-useless-fragment
	'@eslint-react/no-array-index-key': 'error', // react/no-array-index-key
	'@eslint-react/no-duplicate-key': 'error', // react/jsx-key `warnOnDuplicates`
	'@eslint-react/no-unstable-context-value': 'error', // react/jsx-no-constructed-context-values
	'@eslint-react/no-unstable-default-props': 'error', // react/no-object-type-as-default-prop
	'@eslint-react/use-state': 'error', // react/hook-use-state

	/**
	 * Accessibility (jsx-a11y-x) — deltas on top of the strict preset.
	 *
	 * Allow `tabIndex` on `role="group"` (in addition to the default `tabpanel`) so a
	 * scrollable-but-non-interactive region — e.g. a result grid of static cards, or a code block —
	 * can be made keyboard-focusable per WCAG 2.1.1 (axe `scrollable-region-focusable`). `group` is a
	 * non-landmark grouping role that PERMITS an accessible name, so the region can be labelled
	 * without tripping `aria-prohibited-attr`. The one blessed home for this pattern is react-ui's
	 * `<ScrollRegion>`; prefer it over a raw `tabIndex` div.
	 */
	'jsx-a11y-x/no-noninteractive-tabindex': [
		'error',
		{
			allowExpressionValues: true,
			roles: ['group', 'tabpanel'],
			tags: [],
		},
	],

	/**
	 * React Hooks — the classic pair at `error` (the preset ships `exhaustive-deps`
	 * as a warning). The React Compiler checks keep their preset severities, which
	 * `react.js` raises to `error` along with every other preset rule.
	 */
	'react-hooks/exhaustive-deps': 'error',
	'react-hooks/rules-of-hooks': 'error',

	/**
	 * JSX style — `@stylistic` hosts the JSX formatting rules (the `eslint-plugin-react` equivalents).
	 */
	'stylistic/jsx-child-element-spacing': 'error',
	'stylistic/jsx-closing-bracket-location': ['error', 'line-aligned'],
	'stylistic/jsx-closing-tag-location': 'error',
	'stylistic/jsx-curly-brace-presence': [
		'error',
		{
			propElementValues: 'always',
			props: 'never',
		},
	],
	'stylistic/jsx-curly-newline': [
		'error',
		{
			multiline: 'consistent',
			singleline: 'consistent',
		},
	],
	'stylistic/jsx-curly-spacing': ['error', { when: 'never' }],
	'stylistic/jsx-equals-spacing': ['error', 'never'],
	'stylistic/jsx-pascal-case': [
		'error',
		{
			allowAllCaps: true,
			ignore: [],
		},
	],
	'stylistic/jsx-self-closing-comp': [
		'error',
		{
			component: true,
			html: true,
		},
	],
};
