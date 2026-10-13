/**
 * How the worker router reaches the engine a factory built: the registered factories by name, the
 * before-`init` guard, and the devtools coordinator.
 *
 * @remarks
 * Kept apart from `exposeFilterEngineWorker.ts`, whose length is the router itself — one thin
 * delegating method per `FilterEngineAsync` member — so that file stays a readable table of
 * methods and these access rules sit together, in one place, with their reasons.
 *
 * @packageDocumentation
 */

import { type ActionLogEntry, type FilterEngine, FilterEngineModeError } from '@filter-enginez/core';

import type { WorkerEngineFactories, WorkerEngineFactory } from './WorkerHostedEngine.js';

/**
 * The slice of the core's `Devtools` coordinator the router drives.
 *
 * @internal
 */
export interface HostedDevtools {
	readonly actionLog: { readonly size: number; toArray(): readonly ActionLogEntry[] };
	readonly canRedo: boolean;
	readonly canUndo: boolean;
	readonly currentIndex: number;
	jumpTo(index: number): void;
	redo(): void;
	undo(): void;
}

/**
 * The hosted engine's devtools coordinator, or `undefined` when the engine has none.
 *
 * @remarks
 * Read structurally because a factory may return any object with the engine's surface — a test
 * double or a wrapper — and such an object need not carry `devtools`. Without one, the router's
 * devtools views are empty and its time-travel calls are no-ops, rather than throwing.
 *
 * @param engine - The hosted engine, or `undefined` before `init`.
 * @returns The coordinator, if the engine has one.
 * @throws {@link FilterEngineModeError} `MODE_WORKER_NOT_INITIALIZED` before `init`.
 * @internal
 */
export function devtoolsOf(engine: FilterEngine<unknown> | undefined): HostedDevtools | undefined {
	return (ensure(engine) as { readonly devtools?: HostedDevtools }).devtools;
}

/**
 * The registered factories, by name, with their item types erased.
 *
 * @remarks
 * Two reasons for the copy. **Own names only:** looking a name up on the factories object itself
 * would find `toString` or `constructor` on its prototype, so `init({ factoryName: 'toString' })`
 * would call an `Object.prototype` method as a factory instead of rejecting with
 * `WORKER_FACTORY_NOT_FOUND`. **Erasure:** past `init`, the worker only moves items across the
 * postMessage boundary as structured clones and never inspects one, so the router holds a
 * `FilterEngine<unknown>`. The per-name item type has already done its job — at the call site, where
 * it checked each factory against the engine it builds — and the engine's invariance is exactly why
 * that widening needs the explicit conversion below rather than an assignment.
 *
 * @param factories - The map handed to `exposeFilterEngineWorker`.
 * @returns Name to factory, own enumerable names only.
 * @internal
 */
export function registeredFactories<ItemTypes extends Readonly<Record<string, unknown>>>(
	factories: WorkerEngineFactories<ItemTypes>,
): ReadonlyMap<string, WorkerEngineFactory<unknown>> {
	return new Map(
		Object.keys(factories).map((name) => [
			name,
			factories[name as keyof ItemTypes] as unknown as WorkerEngineFactory<unknown>,
		]),
	);
}

/**
 * Throw a clear error if a method is called before `init` populated the engine.
 *
 * @internal
 */
export function ensure<T>(engine: FilterEngine<T> | undefined): FilterEngine<T> {
	if (!engine) {
		throw new FilterEngineModeError(
			'MODE_WORKER_NOT_INITIALIZED',
			'exposeFilterEngineWorker: engine method called before init(). The main-thread '
			+ '`wrapInWorker` calls `init` first; consumers calling worker methods directly must '
			+ 'await init themselves before any other call.',
		);
	}

	return engine;
}
