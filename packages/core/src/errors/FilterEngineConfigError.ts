/**
 * `FilterEngineConfigError` — the category for invalid configuration: config documents, option
 * objects, URL state, worker factories and framework bindings.
 *
 * @remarks
 * See `./FilterEngineError.ts` for why the hierarchy exists and how `name` survives minification.
 *
 * @packageDocumentation
 */

import type { FilterEngineConfigErrorCode } from './codes.js';

import { defineErrorName, FilterEngineError } from './FilterEngineError.js';

/**
 * A configuration value the engine was handed is invalid: a JSON config document (unknown rule
 * reference, unsupported version, missing migration step), an options object (similarity, Bloom filter), a
 * malformed URL-state payload, an unregistered worker factory, or a framework binding read before an
 * engine was provided.
 */
export class FilterEngineConfigError extends FilterEngineError {
	declare readonly code: FilterEngineConfigErrorCode;

	static {
		defineErrorName(this, 'FilterEngineConfigError');
	}

	/**
	 * @param code - One of {@link FilterEngineConfigErrorCode}
	 * @param message - Human-readable explanation, including how to fix it
	 * @param options - Standard `Error` options; pass `{ cause }` when wrapping another failure
	 */
	// eslint-disable-next-line @typescript-eslint/no-useless-constructor -- narrows `code` at construction; the base accepts every code
	constructor(code: FilterEngineConfigErrorCode, message: string, options?: ErrorOptions) {
		super(code, message, options);
	}
}
