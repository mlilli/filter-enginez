/**
 * The engine's error hierarchy: `FilterEngineError` and its four category subclasses, plus the
 * `code` unions they carry.
 *
 * @packageDocumentation
 */

export type {
	FilterEngineConfigErrorCode,
	FilterEngineDestroyedErrorCode,
	FilterEngineErrorCode,
	FilterEngineModeErrorCode,
	FilterEngineRuleErrorCode,
	FilterEngineRuntimeErrorCode,
} from './codes.js';
export { FilterEngineConfigError } from './FilterEngineConfigError.js';
export { FilterEngineDestroyedError } from './FilterEngineDestroyedError.js';
export { defineErrorName, FilterEngineError } from './FilterEngineError.js';
export { FilterEngineModeError } from './FilterEngineModeError.js';
export { FilterEngineRuleError } from './FilterEngineRuleError.js';
