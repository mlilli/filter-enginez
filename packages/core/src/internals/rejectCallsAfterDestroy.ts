/**
 * `rejectCallsAfterDestroy` — make every public method of a destroyable class throw
 * `FilterEngineDestroyedError` once its instance reports `isDestroyed`.
 *
 * @remarks
 * **Why wrap the prototype instead of guarding each method body.** The guard has to cover every
 * public method, including the ones added next year. A hand-written check at the top of each body
 * is a list someone forgets to extend; walking the prototype derives the list, so a new public
 * method is guarded the day it is written. It also keeps `FilterEngine.ts` free of thirty
 * identical preambles.
 *
 * **What is left callable.** `constructor`, `destroy` (idempotent by contract — a second call is a
 * no-op, not an error), members whose name starts with `_` (private by convention, and called from
 * inside `destroy()` itself), and accessors (only plain function-valued properties are wrapped, so
 * the `isDestroyed` getter the guard reads stays readable).
 *
 * @packageDocumentation
 */

import { FilterEngineDestroyedError } from '../errors/index.js';

/** The one member the guard reads from an instance. */
interface DestroyAware {
	readonly isDestroyed: boolean;
}

/** Method names that stay callable after `destroy()`. */
const ALWAYS_CALLABLE: ReadonlySet<string> = new Set(['constructor', 'destroy']);

/**
 * Wrap every public method on `prototype` so it throws once the instance is destroyed.
 *
 * @param prototype - The class prototype to patch in place (e.g. `FilterEngine.prototype`)
 * @param className - Used in the error message, written out so it survives minification
 * @returns The names of the methods that were wrapped, for tests that enumerate them
 */
export function rejectCallsAfterDestroy(prototype: DestroyAware, className: string): readonly string[] {
	const guardedMethodNames: string[] = [];

	for (const [methodName, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(prototype))) {
		const method: unknown = descriptor.value;

		if (ALWAYS_CALLABLE.has(methodName) || methodName.startsWith('_') || typeof method !== 'function') {
			continue;
		}
		const guardedMethod = function (this: DestroyAware, ...args: unknown[]): unknown {
			if (this.isDestroyed) {
				throw new FilterEngineDestroyedError(
					'ENGINE_DESTROYED',
					`${className}.${methodName}() was called after destroy(). A destroyed engine has dropped `
					+ `its subscribers and released its devtools, so the call would change state nothing `
					+ `observes. Create a new engine instead of reusing this one.`,
				);
			}

			return (method as (...methodArgs: unknown[]) => unknown).apply(this, args);
		};

		Object.defineProperty(prototype, methodName, { ...descriptor, value: guardedMethod });
		guardedMethodNames.push(methodName);
	}

	return guardedMethodNames;
}
