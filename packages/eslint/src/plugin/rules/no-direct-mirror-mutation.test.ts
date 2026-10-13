/**
 * @remarks
 * RuleTester coverage for `no-direct-mirror-mutation`. Exercises all four detection patterns
 * (member-access, string-action `type`, import-specifier, consumer `createSlice` reducer
 * override), the `sliceNames` + `allowedSubpaths` options, and the computed-vs-static branches
 * of the `getMemberPropertyName` / `getPropertyKeyName` key resolvers.
 *
 * Two defensive branches carry a `v8 ignore` comment in the rule (§22.3 Form 1): the
 * `typeof source !== 'string'` guard on an import source (always a string literal) and the
 * imported-specifier ternary's `typeof`/`: null` fallbacks (an ImportSpecifier's `imported` is
 * always an Identifier or a string Literal). The `reducers` property lookup narrows through a
 * type-predicate `.find`, so it has no unreachable re-check and needs no ignore.
 */

import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';

import { noDirectMirrorMutation } from './no-direct-mirror-mutation.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
	languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
});

// A consumer-code path (NOT under the redux-bridge package, so the rule is active).
const CONSUMER_FILE = 'packages/examples-react-rtk/src/store.ts';

const MUTATION_ERROR = {
	data: { suggestedMethod: 'addRule / setExpression / setSourceData' },
	messageId: 'directMutation',
} as const;

ruleTester.run('no-direct-mirror-mutation', noDirectMirrorMutation, {
	invalid: [
		// ── Pattern A — `*.actions.stateUpdated` member access ──────────────────────────
		{
			code: 'store.dispatch(filtersSlice.actions.stateUpdated({ count: 1 }));',
			errors: [MUTATION_ERROR],
			filename: CONSUMER_FILE,
		},
		{
			// Computed string-literal property on the outer member (`['stateUpdated']`).
			code: 'filtersSlice.actions["stateUpdated"]({});',
			errors: [MUTATION_ERROR],
			filename: CONSUMER_FILE,
		},
		{
			// Computed string-literal `['actions']` object member.
			code: 'filtersSlice["actions"].stateUpdated({});',
			errors: [MUTATION_ERROR],
			filename: CONSUMER_FILE,
		},

		// ── Pattern B — string-action `type` dispatch ──────────────────────────────────
		{
			code: 'store.dispatch({ type: "filters/stateUpdated", payload: 1 });',
			errors: [MUTATION_ERROR],
			filename: CONSUMER_FILE,
		},
		{
			// Custom `sliceNames` recognizes a non-default slice.
			code: 'store.dispatch({ type: "wines/stateUpdated" });',
			errors: [MUTATION_ERROR],
			filename: CONSUMER_FILE,
			options: [{ sliceNames: ['wines']}],
		},
		{
			// String-literal `"type"` key (exercises the Literal branch of getPropertyKeyName).
			code: 'store.dispatch({ "type": "filters/stateUpdated" });',
			errors: [MUTATION_ERROR],
			filename: CONSUMER_FILE,
		},

		// ── Pattern C — importing the `stateUpdated` symbol ────────────────────────────
		{
			code: 'import { stateUpdated } from "@filter-enginez/redux-bridge/internal";',
			errors: [MUTATION_ERROR],
			filename: CONSUMER_FILE,
		},
		{
			// Aliased import — the imported name is what matters.
			code: 'import { stateUpdated as su } from "@filter-enginez/redux-bridge";',
			errors: [MUTATION_ERROR],
			filename: CONSUMER_FILE,
		},
		{
			// String-literal import specifier (exercises the Literal branch of importedName).
			code: 'import { "stateUpdated" as su } from "@filter-enginez/redux-bridge/internal";',
			errors: [MUTATION_ERROR],
			filename: CONSUMER_FILE,
		},

		// ── Pattern D — consumer `createSlice` re-declaring `stateUpdated` ─────────────
		{
			code: 'createSlice({ name: "x", reducers: { stateUpdated(state, action) { return state; } } });',
			errors: [MUTATION_ERROR],
			filename: CONSUMER_FILE,
		},
	],
	valid: [
		// ── File-level skip — the redux-bridge package is the one legitimate caller ────
		{
			code: 'filtersSlice.actions.stateUpdated({});',
			filename: 'packages/redux-bridge/src/attachEngineToStore.ts',
		},
		{
			// A custom `allowedSubpaths` exempts a non-default location.
			code: 'filtersSlice.actions.stateUpdated({});',
			filename: 'packages/custom-bridge/src/mirror.ts',
			options: [{ allowedSubpaths: ['**/custom-bridge/**']}],
		},

		// ── Pattern A negatives ───────────────────────────────────────────────────────
		{
			// Object is a plain Identifier, not a `*.actions` member.
			code: 'obj.stateUpdated();',
			filename: CONSUMER_FILE,
		},
		{
			// Object is a member, but its property is not `actions`.
			code: 'slice.reducers.stateUpdated;',
			filename: CONSUMER_FILE,
		},
		{
			// Property name is not `stateUpdated`.
			code: 'filtersSlice.actions.setColor({});',
			filename: CONSUMER_FILE,
		},
		{
			// Dynamic computed object member → getMemberPropertyName returns null.
			code: 'foo[bar].stateUpdated;',
			filename: CONSUMER_FILE,
		},
		{
			// Numeric (non-string) computed property → getMemberPropertyName returns null.
			code: 'foo.actions[0];',
			filename: CONSUMER_FILE,
		},

		// ── Pattern B negatives ───────────────────────────────────────────────────────
		{
			code: 'store.dispatch({ payload: 1 });',
			filename: CONSUMER_FILE,
		},
		{
			// `type` value is not a literal.
			code: 'store.dispatch({ type: actionType });',
			filename: CONSUMER_FILE,
		},
		{
			// `type` value is a non-string literal.
			code: 'store.dispatch({ type: 42 });',
			filename: CONSUMER_FILE,
		},
		{
			// A different (non-forbidden) action string.
			code: 'store.dispatch({ type: "filters/setColor" });',
			filename: CONSUMER_FILE,
		},
		{
			// Dynamic computed key → getPropertyKeyName returns null.
			code: 'store.dispatch({ [dynKey]: "filters/stateUpdated" });',
			filename: CONSUMER_FILE,
		},

		// ── Pattern C negatives ───────────────────────────────────────────────────────
		{
			// Source is not the redux-bridge package.
			code: 'import { stateUpdated } from "./local-slice.js";',
			filename: CONSUMER_FILE,
		},
		{
			// Default import — not an ImportSpecifier.
			code: 'import bridge from "@filter-enginez/redux-bridge";',
			filename: CONSUMER_FILE,
		},
		{
			// Namespace import — not an ImportSpecifier.
			code: 'import * as rb from "@filter-enginez/redux-bridge";',
			filename: CONSUMER_FILE,
		},
		{
			// A different (allowed) named import from the bridge.
			code: 'import { attachEngineToStore } from "@filter-enginez/redux-bridge";',
			filename: CONSUMER_FILE,
		},

		// ── Pattern D negatives ───────────────────────────────────────────────────────
		{
			// Callee is a member expression, not a bare `createSlice` identifier.
			code: 'redux.createSlice({ reducers: { stateUpdated() {} } });',
			filename: CONSUMER_FILE,
		},
		{
			// Callee identifier is not `createSlice`.
			code: 'makeSlice({ reducers: { stateUpdated() {} } });',
			filename: CONSUMER_FILE,
		},
		{
			// No arguments.
			code: 'createSlice();',
			filename: CONSUMER_FILE,
		},
		{
			// First argument is not an object expression.
			code: 'createSlice(sliceConfig);',
			filename: CONSUMER_FILE,
		},
		{
			// A spread element in the config is skipped by the `reducers` finder, and no
			// `reducers` key is present.
			code: 'createSlice({ ...defaults, name: "filters" });',
			filename: CONSUMER_FILE,
		},
		{
			// `reducers` value is not an object expression.
			code: 'createSlice({ reducers: sharedReducers });',
			filename: CONSUMER_FILE,
		},
		{
			// Spread + a non-`stateUpdated` reducer inside `reducers`.
			code: 'createSlice({ reducers: { ...shared, setColor(state) { return state; } } });',
			filename: CONSUMER_FILE,
		},
	],
});
