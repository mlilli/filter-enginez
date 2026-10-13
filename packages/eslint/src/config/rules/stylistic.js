/**
 * rules/stylistic.js
 * Location: packages/eslint/src/config/rules
 *
 * @stylistic/eslint-plugin formatting rules — single source of truth for JS/TS
 * formatting.
 *
 * Prettier is intentionally NOT used for JS/TS (only for JSON/YAML/CSS/MD)
 * to avoid the dual-tool conflict surface.
 */
export const stylisticRules = {
	'stylistic/array-bracket-newline': ['error', 'consistent'],
	'stylistic/array-bracket-spacing': [
		'error',
		'never',
		{
			objectsInArrays: false,
		},
	],
	'stylistic/array-element-newline': ['error', 'consistent'],
	'stylistic/arrow-parens': ['error', 'always'],
	'stylistic/brace-style': 'error',
	'stylistic/comma-dangle': ['error', 'always-multiline'],
	'stylistic/eol-last': 'error',
	'stylistic/indent': [
		'error',
		'tab',
		{
			MemberExpression: 1,
			SwitchCase: 1,
		},
	],
	'stylistic/keyword-spacing': 'error',
	'stylistic/line-comment-position': 'off',
	'stylistic/new-parens': ['error', 'always'],
	'stylistic/no-trailing-spaces': 'error',
	'stylistic/object-curly-spacing': [
		'error',
		'always',
		{
			arraysInObjects: false,
			objectsInObjects: false,
		},
	],
	'stylistic/one-var-declaration-per-line': 'error',
	'stylistic/padded-blocks': ['error', 'never'],
	// Replaces the deprecated `newline-after-var` + `newline-before-return`.
	// Same behavior: blank line after var/let/const declarations, blank
	// line before `return` statements.
	'stylistic/padding-line-between-statements': [
		'error',
		{ blankLine: 'always', next: '*', prev: ['const', 'let', 'var']},
		{ blankLine: 'any', next: ['const', 'let', 'var'], prev: ['const', 'let', 'var']},
		{ blankLine: 'always', next: 'return', prev: '*' },
	],
	'stylistic/quote-props': ['error', 'as-needed'],
	'stylistic/quotes': [
		'error',
		'single',
		{
			allowTemplateLiterals: 'always',
			avoidEscape: true,
		},
	],
	'stylistic/semi': ['error', 'always'],
	'stylistic/semi-spacing': [
		'error',
		{
			after: true,
			before: false,
		},
	],
	'stylistic/semi-style': ['error', 'last'],
	'stylistic/space-before-blocks': ['error', 'always'],
	'stylistic/space-before-function-paren': [
		'error',
		{
			anonymous: 'always',
			asyncArrow: 'always',
			named: 'never',
		},
	],
	'stylistic/space-in-parens': ['error', 'never'],
	'stylistic/switch-colon-spacing': [
		'error',
		{
			after: true,
			before: false,
		},
	],
	'stylistic/template-curly-spacing': ['error', 'never'],
};
