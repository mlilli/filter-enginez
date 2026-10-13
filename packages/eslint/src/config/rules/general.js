/**
 * rules/general.js
 * Location: packages/eslint/src/config/rules
 *
 * General rules that apply to all file types (TS + JS + MJS).
 */

// ─── Cap-is-new Exception Patterns ───────────────────────────────────────────

const capIsNewExceptionPatterns = ['^HTML', '^Serialize', 'Event$'];

/**
 * General rules that apply to all file types (TS + JS + MJS).
 */
export const generalRules = {
	'block-scoped-var': 'error',
	'class-methods-use-this': [
		'error',
		{
			// Scope the rule to method declarations only. Class-field arrow
			// properties (e.g. `public close = async () => …`) are a legitimate
			// pattern for bound callbacks and for stateless stubs on mock
			// classes where referencing `this` would be contrived. ESLint 8.1+
			// defaults this to `true`, which flags even `() => {}` fields that
			// don't read `this` — stricter than the rule's original "methods
			// should use this" intent.
			enforceForClassFields: false,
		},
	],
	complexity: ['error', 20],
	curly: 'error',
	eqeqeq: [
		'error',
		'always',
		{
			null: 'ignore',
		},
	],
	'max-classes-per-file': ['error', 2],
	'max-len': [
		'error',
		{
			code: 150,
			ignoreComments: true,
			ignoreRegExpLiterals: true,
			ignoreStrings: true,
			ignoreTemplateLiterals: true,
			ignoreTrailingComments: true,
			ignoreUrls: true,
			tabWidth: 1,
		},
	],
	'max-lines': [
		'error',
		{
			max: 500,
			skipBlankLines: true,
		},
	],
	'new-cap': [
		'error',
		{
			capIsNew: true,
			capIsNewExceptionPattern: capIsNewExceptionPatterns.join('|'),
			capIsNewExceptions: ['Component', 'DateTimeFormat', 'Directive', 'FromEventTarget', 'Injectable', 'KeyboardEvent', 'Pipe'],
			newIsCap: true,
			newIsCapExceptions: [],
			properties: true,
		},
	],
	'newline-per-chained-call': [
		'error',
		{
			ignoreChainWithDepth: 2,
		},
	],
	'no-case-declarations': 'error',
	'no-console': [
		'error',
		{
			allow: ['error', 'warn'],
		},
	],
	'no-constructor-return': 'error',
	'no-debugger': 'error',
	'no-dupe-args': 'error',
	'no-dupe-else-if': 'error',
	'no-dupe-keys': 'error',
	'no-duplicate-case': 'error',
	'no-duplicate-imports': 'error',
	'no-empty': 'error',
	'no-empty-character-class': 'error',
	'no-empty-function': 'error',
	'no-eval': 'error',
	// `noFallthroughCasesInSwitch: false` in tsconfig.json means TS won't catch
	// accidental fallthrough — ESLint owns that here. The commentPattern lets
	// you opt-in to intentional fallthrough with `// falls through` (or any of
	// `fallthrough` / `fallsthrough` / `fall through`). Stacked empty cases
	// (`case 'a': case 'b':`) are always allowed regardless.
	'no-fallthrough': ['error', { commentPattern: '^\\s*falls?\\s?through' }],
	'no-invalid-regexp': 'error',
	'no-invalid-this': 'error',
	'no-irregular-whitespace': 'error',
	'no-labels': 'error',
	'no-multiple-empty-lines': [
		'error',
		{
			max: 2,
			maxBOF: 1,
			maxEOF: 0,
		},
	],
	'no-prototype-builtins': 'error',
	'no-redeclare': 'error',
	'no-self-assign': 'error',
	'no-shadow': 'error',
	'no-this-before-super': 'error',
	'no-throw-literal': 'error',
	'no-undef': 'error',
	'no-unreachable': 'error',
	'no-unsafe-finally': 'error',
	'no-unsafe-negation': 'error',
	'no-unsafe-optional-chaining': 'error',
	'no-unused-expressions': 'error',
	'no-unused-vars': [
		'error',
		{
			args: 'all',
			argsIgnorePattern: '^_',
			// ESLint v9+ defaults caughtErrors to 'all' (was 'none' in v8).
			// Without an ignore pattern, even `try { … } catch (_) { /* ignore */ }`
			// fires this rule. Mirror the variable-side pattern so the
			// underscore prefix opt-out works for catch bindings too.
			caughtErrors: 'all',
			caughtErrorsIgnorePattern: '^_',
			vars: 'all',
			varsIgnorePattern: '^_',
		},
	],
	'no-use-before-define': 'error',
	'no-var': 'error',
	'prefer-arrow-callback': 'error',
	'prefer-const': 'error',
	'prefer-spread': 'error',
	'prefer-template': 'error',
	radix: 'error',
	// `sort-imports` and `sort-keys` are intentionally OFF — replaced by
	// eslint-plugin-perfectionist's auto-fixable equivalents in the
	// perfectionist block. The core rules can't auto-fix and they
	// can't model partitions or customGroups, both of which we rely on.
	//
	// `sort-vars` is also intentionally NOT set — it only fires on
	// multi-var declarations like `const a = 1, b = 2;`, which our
	// `stylistic/one-var-declaration-per-line` rule already forbids.
	// Setting `sort-vars` would be dead config since the surface it
	// checks is already eliminated by the upstream rule.
	'sort-imports': 'off',
	'sort-keys': 'off',
};
