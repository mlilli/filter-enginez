/**
 * `createFilterEngineMiddleware` — Redux middleware that intercepts forward-intent actions
 * (consumer-side `engine.someThing` requests dispatched as Redux actions) and routes them to
 * the engine, instead of letting them reach the slice reducer.
 *
 * @remarks
 * Per `docs/architecture.md` §13.2. The forwarding middleware is OPTIONAL — apps that mutate
 * the engine directly (via `engine.addRule(...)`) don't need it at all; the mirror still
 * updates because `attachEngineToStore` listens to `engine.subscribe`. The middleware exists
 * for apps that want the "everything-is-a-Redux-action" affordance: redux-logger logging,
 * Redux DevTools time-travel of consumer intents (not just mirror state), saga / observable
 * integration where Redux actions are the universal event language.
 *
 * **Action shape — the `meta.filterEngine` envelope.** Forward intents are built with the
 * `forwardToEngine(method, payload)` action-creator, producing actions of the shape
 * `{ type: '<prefix>/forward/<method>', meta: { filterEngine: { method, payload } } }`. The
 * middleware reads the `method` + `payload` from `meta.filterEngine` (NOT from `action.payload`)
 * so the forward intent never collides with a reducer's payload contract. The `type` carries
 * the `<prefix>/forward/<method>` string purely for routing + DevTools readability.
 *
 * **Multi-engine routing.** Each middleware instance is scoped to a `prefix` (default
 * `FILTER_ENGINE`). An app running two engines gives each its own prefix and matching
 * `forwardToEngine(..., prefix)` calls; a middleware only handles actions whose `type` begins
 * with its own `<prefix>/forward/`. Anything else passes through to `next()` untouched.
 *
 * This module provides the `forwardToEngine` creator, the `ForwardableMethod` union, and the
 * dispatch switch that routes each forward intent to the matching engine method and swallows it.
 *
 * @packageDocumentation
 */

import type {
	CompositeRule,
	FilterEngine,
	FilterGroup,
	FilterRule,
	RuleId,
} from '@filter-enginez/core';

/**
 * The default forward-action `type` prefix. Apps wiring a single engine never need to override
 * it; multi-engine apps pass a distinct `prefix` to both `createFilterEngineMiddleware` and
 * `forwardToEngine` so each engine's intents route to its own middleware.
 */
export const FORWARD_ACTION_PREFIX_DEFAULT = 'FILTER_ENGINE';

/**
 * Every consumer-side engine mutation that can be forwarded as a Redux action. The literal
 * union is the discriminant for the `meta.filterEngine` envelope below.
 */
export type ForwardableMethod =
	| 'addGroup'
	| 'addRule'
	| 'clearRules'
	| 'removeGroup'
	| 'removeRule'
	| 'reset'
	| 'setExpression'
	| 'setSourceData'
	| 'setWorkingSet';

/**
 * The discriminated `meta.filterEngine` envelope — the method name plus its method-specific
 * payload. Switching on `method` narrows `payload` to the right shape with no casts.
 *
 * @typeParam T - The item type the engine operates over (used by the data-mutation methods).
 */
export type FilterEngineForwardEnvelope<T = unknown> =
	| { readonly method: 'addGroup'; readonly payload: { readonly group: FilterGroup }}
	| { readonly method: 'addRule'; readonly payload: { readonly rule: FilterRule; readonly ruleId: RuleId; }}
	| { readonly method: 'clearRules'; readonly payload?: Record<string, never> }
	| { readonly method: 'removeGroup'; readonly payload: { readonly groupId: string }}
	| { readonly method: 'removeRule'; readonly payload: { readonly ruleId: RuleId }}
	| { readonly method: 'reset'; readonly payload?: Record<string, never> }
	| { readonly method: 'setExpression'; readonly payload: { readonly expr: CompositeRule | null }}
	| { readonly method: 'setSourceData'; readonly payload: { readonly items: readonly T[] }}
	| { readonly method: 'setWorkingSet'; readonly payload: { readonly items: readonly T[] }};

/**
 * The payload type for a given forward method — the inverse mapping used by `forwardToEngine`'s
 * parameter so call sites get method-correct payload checking.
 */
export type ForwardPayload<M extends ForwardableMethod, T = unknown> = Extract<
	FilterEngineForwardEnvelope<T>,
	{ method: M }
> extends { payload?: infer P }
	? P
	: never;

/**
 * A forward-intent Redux action, as produced by `forwardToEngine`.
 *
 * @typeParam M - The forwarded method (discriminant).
 * @typeParam T - The item type the engine operates over.
 */
export interface ForwardAction<M extends ForwardableMethod = ForwardableMethod, T = unknown> {
	// `meta.filterEngine` is the full discriminated envelope union (narrow by `method` to read the
	// method-specific payload). It deliberately does NOT use `Extract<…, { method: M }>`: `Extract`
	// is a conditional type and therefore INVARIANT in `M`, which would make
	// `ForwardAction<'clearRules'>` un-assignable to `ForwardAction<ForwardableMethod>` — so a
	// store's `dispatch(forwardToEngine('clearRules', {}))` would fail to type-check. `M` is kept
	// only in the covariant `type` literal below, which is all the prefix routing needs.
	readonly meta: { readonly filterEngine: FilterEngineForwardEnvelope<T> };
	readonly type: `${string}/forward/${M}`;
}

/**
 * The middleware-API parameter type. The forwarding middleware reads neither `dispatch` nor
 * `getState` (it routes to the engine, not the store), so the parameter is `unknown` — the
 * maximally permissive type. Because function parameters are contravariant, an `unknown` parameter
 * means any host's concrete `MiddlewareAPI` (Redux's `{ dispatch, getState }`, RTK's, …) is
 * assignable here — which is exactly what lets `getDefaultMiddleware().prepend(thisMiddleware)`
 * type-check, without this package taking a dependency on Redux's types. A
 * `Record<string, unknown>` shape would not do: Redux's `MiddlewareAPI` has no string index
 * signature, so it is not assignable to one.
 */
export type MiddlewareApi = unknown;

/**
 * An action as seen by the middleware. Redux guarantees only a `type` field; everything else
 * (our `meta.filterEngine` envelope, a reducer's `payload`, etc.) is unknown until narrowed.
 */
export interface UnknownAction {
	readonly [extraProps: string]: unknown;
	readonly type: unknown;
}

/**
 * Minimal Redux middleware shape — structurally matches `Middleware` from `redux` without
 * requiring a direct dependency on Redux in this package (RTK is a peer dep; Redux comes
 * transitively). `next` and the returned dispatch both flow `unknown` actions through.
 */
export type Middleware = (
	api: MiddlewareApi,
) => (next: (action: unknown) => unknown) => (action: unknown) => unknown;

/**
 * Options for `createFilterEngineMiddleware`.
 *
 * @typeParam T - The item type the engine operates over.
 */
export interface CreateFilterEngineMiddlewareOptions<T> {
	/** The engine to forward intents to. */
	readonly engine: FilterEngine<T>;
	/**
	 * The forward-action `type` prefix this middleware handles. Defaults to
	 * `FORWARD_ACTION_PREFIX_DEFAULT` (`'FILTER_ENGINE'`). Set a distinct prefix per engine in
	 * multi-engine stores so each middleware only handles its own engine's intents.
	 */
	readonly prefix?: string;
}

/**
 * Build a forward-intent action for an engine method. Pair with `createFilterEngineMiddleware`,
 * which intercepts the action and calls the matching engine method.
 *
 * @typeParam M - The forwarded method.
 * @typeParam T - The item type the engine operates over.
 * @param method - The engine method to forward.
 * @param payload - The method-specific payload (use `{}` for the no-payload `clearRules` / `reset`).
 * @param prefix - The `type` prefix (defaults to `FORWARD_ACTION_PREFIX_DEFAULT`). Must match the
 *   prefix the receiving middleware was created with.
 * @returns A forward-intent action carrying the method + payload in `meta.filterEngine`.
 *
 * @example
 *   store.dispatch(forwardToEngine('addRule', { ruleId: 'price', rule: priceRule }));
 *   store.dispatch(forwardToEngine('clearRules', {}));
 */
export function forwardToEngine<M extends ForwardableMethod, T = unknown>(
	method: M,
	payload: ForwardPayload<M, T>,
	prefix: string = FORWARD_ACTION_PREFIX_DEFAULT,
): ForwardAction<M, T> {
	// `as unknown as` (deliberately NOT `as any`): TypeScript can't prove a generic
	// `{ method: M; payload: ForwardPayload<M> }` collapses to the discriminated
	// `Extract<…, { method: M }>` branch, though at every concrete call site it does — the
	// action-creator's typed `method` + `payload` parameters guarantee the runtime shape.
	const filterEngine = { method, payload } as unknown as Extract<
		FilterEngineForwardEnvelope<T>,
		{ method: M }
	>;

	return {
		meta: { filterEngine },
		type: `${prefix}/forward/${method}`,
	};
}

/**
 * Narrow an arbitrary dispatched value to "an action with a string `type`". Redux guarantees
 * a `type` field on real actions, but middleware sees `unknown` (consumers can dispatch any
 * value), so we verify the shape before reaching for `.type` / `.meta`.
 */
function isForwardAction(action: unknown): action is { readonly type: string } & UnknownAction {
	return (
		typeof action === 'object' &&
		action !== null &&
		typeof (action as { type?: unknown }).type === 'string'
	);
}

/**
 * Pull the `meta.filterEngine` forward envelope off an action, or `undefined` when absent.
 * Reads through `unknown` at the serialization boundary (the action's `meta` shape is not
 * statically known) and returns the typed envelope for the dispatch switch to narrow.
 */
function extractEnvelope<T>(action: UnknownAction): FilterEngineForwardEnvelope<T> | undefined {
	const { meta } = action;

	if (typeof meta !== 'object' || meta === null) {
		return undefined;
	}

	return (meta as { filterEngine?: FilterEngineForwardEnvelope<T> }).filterEngine;
}

// #region docs:create-filter-engine-middleware
/**
 * Build the forward-action-intercepting middleware for an engine.
 *
 * @typeParam T - The item type the engine operates over.
 * @param options - The engine to forward to + an optional routing `prefix`.
 * @returns A Redux middleware.
 *
 * @example
 *   const middleware = createFilterEngineMiddleware({ engine });
 *   const store = configureStore({
 *     reducer: { filters: filterSlice.reducer },
 *     middleware: (getDefault) => getDefault().concat(middleware),
 *   });
 *
 *   // Dispatch consumer intents as Redux actions:
 *   store.dispatch(forwardToEngine('addRule', { ruleId: 'price', rule: priceRule }));
 *   // The middleware routes this to engine.addRule(...) and SWALLOWS the action — it never
 *   // reaches the reducer. The mirror update comes from engine.subscribe via attachEngineToStore.
 */
export function createFilterEngineMiddleware<T>(
	options: CreateFilterEngineMiddlewareOptions<T>,
): Middleware {
	const { engine, prefix = FORWARD_ACTION_PREFIX_DEFAULT } = options;
	const matchPrefix = `${prefix}/forward/`;

	return (_api: MiddlewareApi) => (next: (action: unknown) => unknown) => (action: unknown): unknown => {
		// Only intercept actions whose type sits under our prefix's forward namespace; everything
		// else passes through untouched (including this engine's mirror `stateUpdated` action,
		// other engines' forward intents, and ordinary app actions).
		if (!isForwardAction(action) || !action.type.startsWith(matchPrefix)) {
			return next(action);
		}

		const envelope = extractEnvelope<T>(action);

		if (envelope === undefined) {
			// A `<prefix>/forward/*` action with no envelope is malformed — pass it through rather
			// than throwing, so a misconfigured dispatch surfaces as a reducer-level no-op (visible
			// in DevTools) instead of a hard crash inside middleware.
			return next(action);
		}

		switch (envelope.method) {
			case 'addGroup':
				engine.addGroup(envelope.payload.group);

				return;
			case 'addRule':
				engine.addRule(envelope.payload.ruleId, envelope.payload.rule);

				return; // SWALLOW — mirror update comes from engine.subscribe via attachEngineToStore.
			case 'clearRules':
				engine.clearRules();

				return;
			case 'removeGroup':
				engine.removeGroup(envelope.payload.groupId);

				return;
			case 'removeRule':
				engine.removeRule(envelope.payload.ruleId);

				return;
			case 'reset':
				engine.reset();

				return;
			case 'setExpression':
				engine.setExpression(envelope.payload.expr);

				return;
			case 'setSourceData':
				engine.setSourceData(envelope.payload.items);

				return;
			case 'setWorkingSet':
				engine.setWorkingSet(envelope.payload.items);

				return;
			default:
				// Unknown forward method — pass through. Allows consumers to define their own
				// `<prefix>/forward/customMethod` actions that other middleware handles.
				return next(action);
		}
	};
}
// #endregion docs:create-filter-engine-middleware
