/**
 * The engine's error hierarchy — one base class, four categories, and a machine-readable `code` on
 * every instance.
 *
 * @remarks
 * **Why a hierarchy at all.** A consumer handling a failure needs to answer two questions: "is this
 * the engine's error or someone else's?" and "which failure is it?". `instanceof FilterEngineError`
 * answers the first without parsing a message; the category subclass narrows the second to a family
 * (configuration, rule, mode, lifecycle); and `code` pins the exact case as a stable string that
 * survives message rewording, localization and minification.
 *
 * **Why `cause` is the standard ES2022 option.** A wrapped failure (a malformed `RegExp` source, an
 * IndexedDB request error, a failed WASM fetch) is passed as `new FilterEngineError(code, message,
 * { cause })`, so it lands on the built-in `Error.prototype.cause` slot that runtimes, test runners
 * and error reporters already print. A bespoke field would be invisible to all of them.
 *
 * **Why `name` lives on the prototype as a string literal.** Minifiers rewrite class identifiers, so
 * `this.constructor.name` reads `d` in a production bundle. Each class pins its `name` through
 * {@link defineErrorName}, which is also what the worker bridge keys on when it rebuilds an error
 * that crossed a `postMessage` boundary. A prototype property rather than an own field keeps `name`
 * out of `Object.keys(error)` and readable before the subclass constructor body runs.
 *
 * **Isomorphic.** Nothing here touches a browser or Node-only API; the module is safe in every
 * runtime the core targets.
 *
 * @packageDocumentation
 */

import type { FilterEngineErrorCode } from './codes.js';

/**
 * Pin an error class's `name` to a literal that survives minification.
 *
 * @remarks
 * Defined on the prototype, non-enumerable and writable — the same shape `Error.prototype.name`
 * has — so instances inherit it, `Object.keys` stays clean, and a consumer can still override it.
 * Exported for `RuleRegistryError`, which lives beside the registry; not part of the public barrel.
 *
 * @param errorClass - The class whose instances should report `name`
 * @param name - The literal class name, written out so a minifier cannot rewrite it
 * @internal
 */
export function defineErrorName(errorClass: abstract new (...args: never[]) => Error, name: string): void {
	Object.defineProperty(errorClass.prototype, 'name', { configurable: true, value: name, writable: true });
}

// #region docs:filter-engine-error
/**
 * Base class of every error the engine raises.
 *
 * @remarks
 * Catch this to separate engine failures from everything else, then read {@link code} for the exact
 * case. It is thrown directly only for the runtime failures in `FilterEngineRuntimeErrorCode`;
 * every other failure uses one of the four category subclasses.
 *
 * The constructor resets the prototype from `new.target` so `instanceof` stays correct for consumers
 * who transpile to a target where subclassing `Error` loses the subclass prototype.
 *
 * @example
 *   try {
 *     engine.loadConfig(untrustedConfig);
 *   } catch (error) {
 *     if (error instanceof FilterEngineError) report(error.code, error.message, error.cause);
 *     else throw error;
 *   }
 */
export class FilterEngineError extends Error {
	/** Machine-readable failure identifier — stable across releases, unlike `message`. */
	readonly code: FilterEngineErrorCode;

	static {
		defineErrorName(this, 'FilterEngineError');
	}

	/**
	 * @param code - The machine-readable failure identifier
	 * @param message - Human-readable explanation, including how to fix it
	 * @param options - Standard `Error` options; pass `{ cause }` when wrapping another failure
	 */
	constructor(code: FilterEngineErrorCode, message: string, options?: ErrorOptions) {
		super(message, options);
		Object.setPrototypeOf(this, new.target.prototype);
		this.code = code;
	}
}
// #endregion docs:filter-engine-error
