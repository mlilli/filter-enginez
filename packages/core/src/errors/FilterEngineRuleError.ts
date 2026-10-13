/**
 * `FilterEngineRuleError` — the category for unusable rule classes and serialized rules;
 * `RuleRegistryError` extends it.
 *
 * @remarks
 * See `./FilterEngineError.ts` for why the hierarchy exists and how `name` survives minification.
 *
 * @packageDocumentation
 */

import type { FilterEngineRuleErrorCode } from './codes.js';

import { defineErrorName, FilterEngineError } from './FilterEngineError.js';

/**
 * A rule class or a serialized rule is unusable: an unknown or duplicate registry type, a class
 * without a `ruleTypeName`, a rule that cannot serialize (`PredicateRule`), a serialized config of
 * the wrong shape, or a rule id the acceleration layer has no rule for.
 */
export class FilterEngineRuleError extends FilterEngineError {
	declare readonly code: FilterEngineRuleErrorCode;

	static {
		defineErrorName(this, 'FilterEngineRuleError');
	}

	/**
	 * @param code - One of {@link FilterEngineRuleErrorCode}
	 * @param message - Human-readable explanation, including how to fix it
	 * @param options - Standard `Error` options; pass `{ cause }` when wrapping another failure
	 */
	// eslint-disable-next-line @typescript-eslint/no-useless-constructor -- narrows `code` at construction; the base accepts every code
	constructor(code: FilterEngineRuleErrorCode, message: string, options?: ErrorOptions) {
		super(code, message, options);
	}
}
