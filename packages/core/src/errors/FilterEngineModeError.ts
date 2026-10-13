/**
 * `FilterEngineModeError` — the category for calls the engine refuses in its current mode:
 * expression mode, a worker-backed engine, or a worker host before or after `init()`.
 *
 * @remarks
 * See `./FilterEngineError.ts` for why the hierarchy exists and how `name` survives minification.
 *
 * @packageDocumentation
 */

import type { FilterEngineModeErrorCode } from './codes.js';

import { defineErrorName, FilterEngineError } from './FilterEngineError.js';

/**
 * The call is invalid in the engine's current mode: `addRule()` while an expression is set (the
 * rule would be silently ignored), a synchronous facility a worker-backed engine cannot provide, or
 * a worker host used before or re-initialized after `init()`.
 */
export class FilterEngineModeError extends FilterEngineError {
	declare readonly code: FilterEngineModeErrorCode;

	static {
		defineErrorName(this, 'FilterEngineModeError');
	}

	/**
	 * @param code - One of {@link FilterEngineModeErrorCode}
	 * @param message - Human-readable explanation, including how to fix it
	 * @param options - Standard `Error` options; pass `{ cause }` when wrapping another failure
	 */
	// eslint-disable-next-line @typescript-eslint/no-useless-constructor -- narrows `code` at construction; the base accepts every code
	constructor(code: FilterEngineModeErrorCode, message: string, options?: ErrorOptions) {
		super(code, message, options);
	}
}
