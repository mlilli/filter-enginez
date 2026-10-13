/**
 * rules/typescript.js
 * Location: packages/eslint/src/config/rules
 *
 * TypeScript-specific rule deltas layered on top of the typescript-eslint presets
 * (recommended → recommendedTypeChecked → strict) applied via `extends:` in `base.js`.
 *
 * This object contains ONLY the deltas — the presets bring the bulk
 * (no-floating-promises, no-unsafe-*, no-misused-promises, ban-ts-comment, etc.).
 * Adding a rule here means one of:
 *
 *   - Turning a preset rule OFF (e.g. `member-ordering`, replaced by
 *     `perfectionist/sort-classes`).
 *   - Customizing a preset rule's options (e.g. `no-explicit-any` with
 *     `fixToUnknown: true`).
 *   - Adding a rule the presets don't include (e.g. `prefer-readonly`,
 *     `promise-function-async`, `naming-convention`).
 *   - Turning off a base ESLint rule whose @typescript-eslint variant
 *     covers the same ground (no-empty-function, no-shadow, no-unused-vars,
 *     no-use-before-define) — see bottom of object.
 *   - Turning off `no-undef` because TypeScript's compiler enforces
 *     undefined-reference checks at the type-system level, more
 *     accurately than ESLint's static-analysis approximation.
 */
export const tsRules = {
	// Custom rule overrides
	'@typescript-eslint/array-type': 'error',
	'@typescript-eslint/consistent-type-imports': [
		'error',
		{
			fixStyle: 'inline-type-imports',
			prefer: 'type-imports',
		},
	],
	// `@typescript-eslint/member-ordering` is intentionally OFF — replaced by
	// `perfectionist/sort-classes` in the perfectionist block. Same intent
	// (statics → public → protected → constructor → methods → private), but with
	// auto-fix and a more expressive group-matching DSL.
	'@typescript-eslint/member-ordering': 'off',
	'@typescript-eslint/naming-convention': [
		'error',
		{
			format: ['PascalCase'],
			leadingUnderscore: 'forbid',
			selector: 'interface',
			trailingUnderscore: 'forbid',
		},
		{
			format: ['camelCase'],
			leadingUnderscore: 'require',
			modifiers: ['private'],
			selector: 'memberLike',
			trailingUnderscore: 'forbid',
		},
		{
			// Boolean variable convention: prefix from the list below, then
			// PascalCase content. typescript-eslint's `prefix` strips the
			// matching prefix BEFORE applying `format` to the remainder, so
			// `isPasswordOk` is checked as `PasswordOk` against PascalCase
			// — which means the OVERALL name reads like camelCase to a
			// human (`isActive`, `hasItem`, `wasSent`). The prefix makes
			// the truthiness-or-falsiness obvious at every call site.
			// Prefix vocabulary (alphabetic): each conveys a distinct kind of
			// boolean meaning so a reader sees the truthiness from the name
			// alone:
			//   can / could       — capability
			//   did / do / does   — past / present action assertion
			//   expects           — invariant assertion
			//   had / has / have  — past / present possession
			//   is                — current state
			//   must              — strong requirement
			//   needs             — required state (something must change)
			//   should            — recommendation
			//   was / were        — past state
			//   will              — future state / intent
			format: ['PascalCase'],
			prefix: [
				'can',
				'did',
				'do',
				'does',
				'expects',
				'had',
				'has',
				'is',
				'must',
				'needs',
				'should',
				'was',
				'will',
			],
			selector: 'variable',
			types: ['boolean'],
		},
		{
			format: ['StrictPascalCase'],
			selector: 'typeParameter',
		},
	],
	'@typescript-eslint/no-explicit-any': [
		'error',
		{
			fixToUnknown: true,
			ignoreRestArgs: true,
		},
	],
	'@typescript-eslint/no-inferrable-types': [
		'error',
		{
			ignoreParameters: true,
			ignoreProperties: true,
		},
	],
	'@typescript-eslint/no-shadow': 'error',
	'@typescript-eslint/no-unnecessary-condition': [
		'error',
		{
			allowConstantLoopConditions: true,
		},
	],
	'@typescript-eslint/no-unused-vars': [
		'error',
		{
			args: 'all',
			argsIgnorePattern: '^_',
			// Mirrors the general-rule pattern (see `generalRules.no-unused-vars`).
			// ESLint v9 defaults `caughtErrors` to `'all'`; without an ignore
			// pattern, `try { … } catch (_e) { /* ignore */ }` would fire on TS
			// files. Keeping the underscore-prefix opt-out lets the same idiom
			// work uniformly across .js, .mjs, and .ts.
			caughtErrors: 'all',
			caughtErrorsIgnorePattern: '^_',
			vars: 'all',
		},
	],
	'@typescript-eslint/no-use-before-define': 'off',
	'@typescript-eslint/prefer-for-of': 'error',
	'@typescript-eslint/prefer-readonly': 'error',
	'@typescript-eslint/promise-function-async': 'error',
	'@typescript-eslint/require-array-sort-compare': 'error',
	'@typescript-eslint/restrict-template-expressions': [
		'error',
		{
			allowBoolean: true,
			allowNullish: true,
			allowNumber: true,
		},
	],
	'@typescript-eslint/return-await': 'error',

	// Turn off the four base ESLint rules whose @typescript-eslint variants
	// own the check on TS files (avoid duplicate firing).
	'no-empty-function': 'off',
	'no-shadow': 'off',
	// `no-undef` has no @typescript-eslint variant — TypeScript's compiler
	// is the check. Turning it off here lets TS handle undefined references
	// without ESLint's lower-resolution static analysis getting in the way.
	'no-undef': 'off',
	'no-unused-vars': 'off',
	'no-use-before-define': 'off',
};
