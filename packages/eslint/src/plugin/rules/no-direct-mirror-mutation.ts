/**
 * `no-direct-mirror-mutation` — flags any call site that dispatches the redux-bridge's
 * `stateUpdated` action (or otherwise reaches into the mirror slice's internal mutator),
 * violating the one-way-sync read-only contract.
 *
 * @remarks
 * Per `docs/architecture.md` §17.2. The redux-bridge mirror's invariant is that exactly ONE
 * code path mutates the mirror: `attachEngineToStore`'s subscribe loop, driven by engine
 * events. Direct `store.dispatch(slice.actions.stateUpdated(...))` calls from consumer code
 * break time-travel coherence (the action log has mirror updates without a corresponding
 * engine action) and let the mirror diverge from the engine. This rule catches it at lint time.
 *
 * **Detection patterns** (all syntactic — no type information needed):
 *
 *   1. Import specifier: `import { stateUpdated } from '@filter-enginez/redux-bridge…'`
 *   2. Slice-action access: any `*.actions.stateUpdated` member expression
 *   3. String-action type: `{ type: 'filters/stateUpdated' }` for each slice name in the
 *      `sliceNames` option (default `['filters']`)
 *   4. Reducer override: `createSlice({ reducers: { stateUpdated: ... } })` outside the bridge
 *      package
 *
 * Files under `allowedSubpaths` (the bridge itself) are skipped.
 *
 * @packageDocumentation
 */

import type { Rule } from 'eslint';
import type * as ESTree from 'estree';

import { globMatchesAny } from '../_internal/globMatch.js';

/**
 * The forbidden action name. The bridge slice uses exactly one mutating action and consumers
 * must NEVER dispatch it directly.
 *
 * @internal
 */
const FORBIDDEN_ACTION_NAME = 'stateUpdated';

/**
 * Module specifier pattern indicating the redux-bridge package. Used by the import-spec check
 * to flag `import { stateUpdated } from '@filter-enginez/redux-bridge/...'`.
 *
 * @internal
 */
const REDUX_BRIDGE_SOURCE_PREFIX = '@filter-enginez/redux-bridge';

/**
 * The rule's options shape.
 */
export interface NoDirectMirrorMutationOptions {
	/**
	 * Slice names to recognize as bridge slices. Used for the string-action-type pattern
	 * (#3 above). Defaults to `['filters']` — the convention assumed by the architecture doc.
	 * Multi-engine apps override with their actual slice names.
	 */
	readonly sliceNames?: readonly string[];

	/**
	 * If the file path matches any of these globs, the rule is skipped. Used to exempt the
	 * bridge package itself (which legitimately dispatches `stateUpdated`).
	 */
	readonly allowedSubpaths?: readonly string[];
}

/**
 * Default `allowedSubpaths` — the redux-bridge package itself is the one legitimate caller.
 */
export const DEFAULT_ALLOWED_SUBPATHS: readonly string[] = [
	'**/packages/redux-bridge/**',
];

/**
 * The rule module.
 */
export const noDirectMirrorMutation: Rule.RuleModule = {
	create(context: Rule.RuleContext): Rule.RuleListener {
		const userOptions = (context.options[0] ?? {}) as NoDirectMirrorMutationOptions;
		const sliceNames = userOptions.sliceNames ?? ['filters'];
		const allowedSubpaths = userOptions.allowedSubpaths ?? DEFAULT_ALLOWED_SUBPATHS;

		// File-level skip: the redux-bridge package itself is the one legitimate caller.
		const filename = context.filename;

		if (globMatchesAny(filename, allowedSubpaths)) {
			return {};
		}

		// Precompute the set of valid `type:` string-literal patterns we want to flag — e.g.
		// for `sliceNames: ['filters', 'wines']` we'd flag `'filters/stateUpdated'` and
		// `'wines/stateUpdated'`. A Set keeps the `type:`-property check O(1) per node.
		const forbiddenActionTypeStrings = new Set<string>(
			sliceNames.map((name) => `${name}/${FORBIDDEN_ACTION_NAME}`),
		);

		/**
		 * Helper: a MemberExpression whose property is the identifier `stateUpdated` AND whose
		 * object is itself a MemberExpression with property `actions`. Catches the canonical
		 * shape `someSlice.actions.stateUpdated` (and its variants like `slice['actions'].stateUpdated`).
		 *
		 * @internal
		 */
		function isActionsStateUpdatedAccess(node: ESTree.MemberExpression): boolean {
			// `.stateUpdated` property check — accept both `x.stateUpdated` and `x['stateUpdated']`.
			const propName = getMemberPropertyName(node);

			if (propName !== FORBIDDEN_ACTION_NAME) {
				return false;
			}
			// The object must itself be a MemberExpression whose property is `actions`.
			const objectNode = node.object;

			if (objectNode.type !== 'MemberExpression') {
				return false;
			}

			return getMemberPropertyName(objectNode) === 'actions';
		}

		return {
			/**
			 * Pattern D — a consumer-defined slice with a `stateUpdated` reducer of its own.
			 * Catches `createSlice({ reducers: { stateUpdated: ... } })` outside the bridge
			 * (the file-level allow-list already exempts bridge internals). The pattern hints
			 * at someone re-implementing the mirror by hand — almost always wrong.
			 */
			CallExpression(node: ESTree.CallExpression): void {
				const callee = node.callee;

				if (callee.type !== 'Identifier') {
					return;
				}
				if (callee.name !== 'createSlice') {
					return;
				}
				const firstArg = node.arguments[0];

				if (firstArg === undefined) {
					return;
				}
				if (firstArg.type !== 'ObjectExpression') {
					return;
				}
				// Find the `reducers:` property inside the createSlice config object.
				const reducersProp = firstArg.properties.find(
					(prop): prop is ESTree.Property =>
						prop.type === 'Property' && getPropertyKeyName(prop) === 'reducers',
				);

				if (reducersProp === undefined) {
					return;
				}
				const reducersValue = reducersProp.value;

				if (reducersValue.type !== 'ObjectExpression') {
					return;
				}
				// Look for a `stateUpdated:` property inside `reducers`.
				for (const innerProp of reducersValue.properties) {
					if (innerProp.type !== 'Property') {
						continue;
					}
					if (getPropertyKeyName(innerProp) !== FORBIDDEN_ACTION_NAME) {
						continue;
					}
					context.report({
						data: { suggestedMethod: 'addRule / setExpression / setSourceData' },
						messageId: 'directMutation',
						node: innerProp.key,
					});
				}
			},

			/**
			 * Pattern C — direct import of the `stateUpdated` symbol from the redux-bridge.
			 * Catches `import { stateUpdated } from '@filter-enginez/redux-bridge/internal'`,
			 * which would otherwise let consumers smuggle the action past every other check.
			 */
			ImportDeclaration(node: ESTree.ImportDeclaration): void {
				const source = node.source.value;

				/* v8 ignore next 3 -- defensive: an ImportDeclaration source is always a string literal at runtime; the guard only narrows ESTree's `Literal.value` union for TypeScript. */
				if (typeof source !== 'string') {
					return;
				}
				if (!source.startsWith(REDUX_BRIDGE_SOURCE_PREFIX)) {
					return;
				}
				for (const specifier of node.specifiers) {
					if (specifier.type !== 'ImportSpecifier') {
						continue;
					}
					const imported = specifier.imported;
					// `imported` is `Identifier` for `{ foo }` / `{ foo as bar }` or `Literal` for
					// `{ 'foo' as bar }` string-literal imports — handle both shapes.
					/* v8 ignore start -- an ImportSpecifier's `imported` is always an Identifier or a string Literal in valid ESM; the `typeof` check + `: null` fallback only narrow ESTree's type union and are unreachable at runtime. */
					const importedName
						= imported.type === 'Identifier' ? imported.name
							: typeof imported.value === 'string' ? imported.value
								: null;
					/* v8 ignore stop */

					if (importedName !== FORBIDDEN_ACTION_NAME) {
						continue;
					}
					context.report({
						data: { suggestedMethod: 'addRule / setExpression / setSourceData' },
						messageId: 'directMutation',
						node: specifier as unknown as ESTree.Node,
					});
				}
			},

			// #region docs:member-and-type-string-visitors
			/**
			 * Pattern A — `*.actions.stateUpdated` member access. The most common direct-dispatch
			 * shape in consumer code: `store.dispatch(filtersSlice.actions.stateUpdated(...))`.
			 * Reported on the `.stateUpdated` property itself for precise editor underlining.
			 */
			MemberExpression(node: ESTree.MemberExpression): void {
				if (isActionsStateUpdatedAccess(node)) {
					context.report({
						data: { suggestedMethod: 'addRule / setExpression / setSourceData' },
						messageId: 'directMutation',
						node: node.property,
					});
				}
			},

			/**
			 * Pattern B — string-action dispatch shape: `{ type: 'filters/stateUpdated', ... }`.
			 * Matches any `type:` property in an object literal whose value is one of the
			 * configured `${sliceName}/stateUpdated` strings. Catches the un-typed dispatch path
			 * (`store.dispatch({ type: 'filters/stateUpdated', payload })`).
			 */
			Property(node: ESTree.Property): void {
				const keyName = getPropertyKeyName(node);

				if (keyName !== 'type') {
					return;
				}
				const value = node.value;

				if (value.type !== 'Literal') {
					return;
				}
				if (typeof value.value !== 'string') {
					return;
				}
				if (!forbiddenActionTypeStrings.has(value.value)) {
					return;
				}
				context.report({
					data: { suggestedMethod: 'addRule / setExpression / setSourceData' },
					messageId: 'directMutation',
					node: value as unknown as ESTree.Node,
				});
			},
			// #endregion docs:member-and-type-string-visitors
		};
	},

	meta: {
		docs: {
			description: "Forbid direct dispatch of the redux-bridge's stateUpdated action — the mirror must only be mutated by `attachEngineToStore`'s subscribe loop",
			recommended: true,
			url: 'https://github.com/mlilli/filter-enginez/blob/main/packages/eslint/README.md#no-direct-mirror-mutation',
		},
		messages: {
			directMutation:
				'Direct mutation of the redux-bridge mirror is forbidden. Use engine.{{suggestedMethod}}() instead — the bridge mirrors the change into the slice automatically.',
		},
		schema: [
			{
				additionalProperties: false,
				properties: {
					allowedSubpaths: { items: { type: 'string' }, type: 'array' },
					sliceNames: { items: { type: 'string' }, type: 'array' },
				},
				type: 'object',
			},
		],
		type: 'problem',
	},
};

/**
 * Resolve the property name of a `MemberExpression`, handling both `x.foo` (Identifier key)
 * and `x['foo']` (Literal key). Returns `null` for computed property accesses we can't
 * statically resolve (e.g., `x[someVar]`).
 *
 * @internal
 */
function getMemberPropertyName(node: ESTree.MemberExpression): string | null {
	const property = node.property;

	if (!node.computed && property.type === 'Identifier') {
		return property.name;
	}
	if (node.computed && property.type === 'Literal' && typeof property.value === 'string') {
		return property.value;
	}

	return null;
}

/**
 * Resolve the property-name key of a `Property` node, handling both shorthand identifier keys
 * and string-literal keys. Returns `null` for computed keys we can't statically resolve.
 *
 * @internal
 */
function getPropertyKeyName(node: ESTree.Property): string | null {
	const key = node.key;

	if (!node.computed && key.type === 'Identifier') {
		return key.name;
	}
	if (key.type === 'Literal' && typeof key.value === 'string') {
		return key.value;
	}

	return null;
}
