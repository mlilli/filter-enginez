/**
 * rules/perfectionist.js
 * Location: packages/eslint/src/config/rules
 *
 * eslint-plugin-perfectionist sort rules — single source of truth for the
 * project's ordering conventions across object literals, imports, classes,
 * interfaces, type literals, switch cases, and union/intersection types.
 *
 * Used instead of three rules that lack auto-fix:
 *   - `sort-keys` (core ESLint, no auto-fix, no partitions, no customGroups)
 *   - `sort-imports` (core ESLint, no full-declaration sort, no group support)
 *   - `@typescript-eslint/member-ordering` (no auto-fix)
 *
 * All rules share a `type: 'alphabetical'` + `order: 'asc'` + `ignoreCase: true`
 * baseline. Object/interface/type-literal sorts also share `recordShapeGroups`
 * so the same KV record shape sorts identically as a runtime literal, an
 * `interface`, or a `type` alias.
 */

// ─── Shared customGroups for record-shape sorting ────────────────────────────

/**
 * customGroups applied uniformly across `sort-objects`, `sort-interfaces`, and
 * `sort-object-types` so the same record shape sorts the same way whether it
 * appears as an object literal, an interface declaration, or a type alias.
 *
 * Two carve-outs on top of alphabetic:
 *   1. `id` first — the universal "what is this thing" key.
 *   2. `timestamps` last — anything ending in `_at`, `At`, or named `timestamp`.
 *
 * Result: records read top-to-bottom as "id → fields → when".
 */
const recordShapeGroups = [
	{
		elementNamePattern: '^id$',
		groupName: 'id',
	},
	{
		elementNamePattern: ['_at$', 'At$', '^timestamp$'],
		groupName: 'timestamps',
	},
];

const recordShapeGroupOrder = ['id', 'unknown', 'timestamps'];

export const perfectionistRules = {
	// ── Classes ────────────────────────────────────────────────
	// Replaces `@typescript-eslint/member-ordering`. Same intent:
	// statics → public properties → protected → constructor →
	// public methods → protected methods → private — but with
	// auto-fix. Property/method WITHIN each visibility tier sort
	// alphabetically.
	'perfectionist/sort-classes': [
		'error',
		{
			groups: [
				'index-signature',
				'static-property',
				'static-method',
				'public-property',
				'protected-property',
				'private-property',
				'constructor',
				'public-method',
				'protected-method',
				'private-method',
				'unknown',
			],
			ignoreCase: true,
			order: 'asc',
			partitionByComment: true,
			type: 'alphabetical',
		},
	],

	// ── Imports ────────────────────────────────────────────────
	// Sort full import declarations by source category, then
	// alphabetically within category.
	'perfectionist/sort-imports': [
		'error',
		{
			// Group names follow perfectionist v5's `value-*` / `type-*` split:
			// values and type imports are tracked separately so a project
			// can choose to colocate or segregate them.
			groups: [
				'side-effect',
				'type-import',
				['value-builtin', 'value-external'],
				'type-internal',
				'value-internal',
				['type-parent', 'type-sibling', 'type-index'],
				['value-parent', 'value-sibling', 'value-index'],
				'unknown',
			],
			ignoreCase: true,
			internalPattern: ['^~/.+', '^@/.+'],
			// newlinesBetween: 1 (always), 0 (never), 'ignore' (don't enforce).
			// We use 1 to enforce a blank line between import groups for
			// readability; perfectionist auto-fixes to match.
			newlinesBetween: 1,
			order: 'asc',
			type: 'alphabetical',
		},
	],
	// ── Type literals + interfaces ─────────────────────────────
	// Mirrors `sort-objects` so the same KV-record shape sorts the
	// same way whether it appears as a TS interface, type alias,
	// or runtime object literal.
	'perfectionist/sort-interfaces': [
		'error',
		{
			customGroups: recordShapeGroups,
			groups: recordShapeGroupOrder,
			ignoreCase: true,
			order: 'asc',
			partitionByComment: true,
			partitionByNewLine: true,
			type: 'alphabetical',
		},
	],
	// ── Type unions / intersections ────────────────────────────
	// Sorts members of `A | B` and `A & B` types alphabetically.
	'perfectionist/sort-intersection-types': [
		'error',
		{
			ignoreCase: true,
			order: 'asc',
			type: 'alphabetical',
		},
	],

	'perfectionist/sort-named-exports': [
		'error',
		{
			ignoreAlias: false,
			ignoreCase: true,
			order: 'asc',
			type: 'alphabetical',
		},
	],

	'perfectionist/sort-named-imports': [
		'error',
		{
			ignoreAlias: false,
			ignoreCase: true,
			order: 'asc',
			type: 'alphabetical',
		},
	],
	'perfectionist/sort-object-types': [
		'error',
		{
			customGroups: recordShapeGroups,
			groups: recordShapeGroupOrder,
			ignoreCase: true,
			order: 'asc',
			partitionByComment: true,
			partitionByNewLine: true,
			type: 'alphabetical',
		},
	],

	// ── Object literals ────────────────────────────────────────
	// Single-tier sort: alphabetic.
	'perfectionist/sort-objects': [
		'error',
		{
			ignoreCase: true,
			order: 'asc',
			type: 'alphabetical',
		},
	],

	// ── Switch / cases ─────────────────────────────────────────
	// Alphabetic case ordering with `default` always last (perfectionist
	// pins `default:` regardless of sort config). Helps catch missing-
	// case bugs in long event-type switches.
	'perfectionist/sort-switch-case': [
		'error',
		{
			ignoreCase: true,
			order: 'asc',
			type: 'alphabetical',
		},
	],
	'perfectionist/sort-union-types': [
		'error',
		{
			groups: [
				'named',
				'keyword',
				'literal',
				'function',
				'object',
				'tuple',
				'intersection',
				'union',
				'nullish',
			],
			ignoreCase: true,
			order: 'asc',
			type: 'alphabetical',
		},
	],
};
