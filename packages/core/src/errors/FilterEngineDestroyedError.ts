/**
 * `FilterEngineDestroyedError` — thrown by every public engine method called after `destroy()`.
 *
 * @remarks
 * See `./FilterEngineError.ts` for why the hierarchy exists and how `name` survives minification.
 *
 * @packageDocumentation
 */

import type { FilterEngineDestroyedErrorCode } from './codes.js';

import { defineErrorName, FilterEngineError } from './FilterEngineError.js';

/**
 * A method was called on an engine after `destroy()`. A destroyed engine has dropped its
 * subscribers and flushed its devtools, so a call that "worked" would update state nobody observes;
 * failing loudly surfaces the stale reference instead.
 */
export class FilterEngineDestroyedError extends FilterEngineError {
	declare readonly code: FilterEngineDestroyedErrorCode;

	static {
		defineErrorName(this, 'FilterEngineDestroyedError');
	}

	/**
	 * @param code - Always `'ENGINE_DESTROYED'`; kept as a parameter so every class in the hierarchy
	 *   shares one constructor shape, which the worker bridge relies on to rebuild errors
	 * @param message - Human-readable explanation, naming the method that was called
	 * @param options - Standard `Error` options; pass `{ cause }` when wrapping another failure
	 */
	// eslint-disable-next-line @typescript-eslint/no-useless-constructor -- narrows `code` at construction; the base accepts every code
	constructor(code: FilterEngineDestroyedErrorCode, message: string, options?: ErrorOptions) {
		super(code, message, options);
	}
}
