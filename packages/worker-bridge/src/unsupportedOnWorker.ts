/**
 * `unsupportedOnWorker` — the error both async reactive adapters throw for a synchronous
 * `engine.core` member that a worker-backed engine cannot serve.
 *
 * @remarks
 * `createSignalsEngineFromAsync` and `createRxJsEngineFromAsync` each expose a synchronous
 * `FilterEngine<T>` shim as `engine.core`, so the write path reads the same on every tier. Most of
 * that surface is served from main-thread mirrors; the rest cannot be — a bitmap index or a
 * synchronous bundle query lives on the other side of a postMessage boundary. Those members exist
 * on the shim and throw this error, rather than being absent: an absent member surfaces as
 * "`applyFiltersAndQuery` is not a function", which names neither the cause nor the fix.
 *
 * One function for both adapters keeps the class, the code and the wording identical across them,
 * the same reason `createAsyncDevtoolsShim` is shared.
 *
 * @packageDocumentation
 */

import { FilterEngineModeError } from '@filter-enginez/core';

/**
 * Throw `MODE_WORKER_UNSUPPORTED` for a synchronous `engine.core` member.
 *
 * @param adapterName - The adapter whose shim was called, so the message names the right one.
 * @param member - The member as the caller wrote it, e.g. `'applyFiltersAndQuery()'`.
 * @param instead - The async calls that answer the same question, if any; the message offers each.
 * @returns Never; the return type lets a getter or method body be just this call.
 * @throws {@link FilterEngineModeError} Always, with code `MODE_WORKER_UNSUPPORTED`.
 */
export function unsupportedOnWorker(adapterName: string, member: string, ...instead: readonly string[]): never {
	const remedy = instead.length === 0
		? 'it has no main-thread mirror.'
		: `await ${instead.map((call) => `\`${call}\``).join(' or ')} instead.`;

	throw new FilterEngineModeError(
		'MODE_WORKER_UNSUPPORTED',
		`${adapterName}: \`engine.core.${member}\` is not available on worker-backed engines; ${remedy}`,
	);
}
