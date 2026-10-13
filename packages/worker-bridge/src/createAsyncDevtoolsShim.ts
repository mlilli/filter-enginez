/**
 * `createAsyncDevtoolsShim` — the main-thread `engine.core.devtools` surface for a worker-backed
 * engine, shared by both async reactive adapters.
 *
 * @remarks
 * ### Why this lives in `worker-bridge`
 *
 * `wireFormat.ts` already owns the **outbound** half of this exact contract — `toWireActionLogEntry`
 * / `deriveWireEntryCore` flatten an `ActionLogEntry` into a `WireActionLogEntry`, and
 * `summarizeRuleConfig` is, by its own docblock, "a cheap one-line config readout for the devtools
 * 'args' column". This module is the **inbound** half: rebuild something shaped like core's
 * `Devtools` from `WireActionLogEntry[]` + `WireDevtoolsState`. Both halves of one wire contract in
 * one package is cohesion; splitting them across packages would be the smell.
 *
 * The alternative homes were weighed and rejected — **know why before proposing a different
 * one.** The one that looks cheapest (living in `reactive-signals` and being imported by
 * `reactive-rxjs`) is disqualifying: it makes the RxJS adapter depend on the signals package it
 * exists to be an alternative to, and drags `@preact/signals-core` into the Angular bundle that
 * `angular-rxjs` and the apps built on it deliberately ship without.
 *
 * ### Surface-neutral by construction
 *
 * Nothing in {@link AsyncDevtoolsShimContext} is a `Signal` or an `Observable` — the adapter passes
 * plain functions. That is what lets one module serve a signals adapter and an RxJS one, and it is
 * why `batch()` (a `@preact/signals-core` primitive) cannot and does not appear here.
 *
 * ### The optimistic cursor write, which is the part most likely to be deleted as redundant
 *
 * Worker-side `TimeTravel.jumpTo/undo/redo` calls `restoreSnapshot` straight on the store,
 * **bypassing the dispatcher**, so no `ChangeEvent` is emitted. The main thread only learns a
 * time-travel succeeded by re-fetching. Without the optimistic write the panel's row tint waits a
 * full round trip (~100 ms on a large worker-backed dataset) and both Cmd-Z and the header button
 * feel unresponsive. So this is a read-model with exactly one write.
 *
 * @packageDocumentation
 */

import { FilterEngineModeError } from '@filter-enginez/core';

import type {
	FilterEngineAsync,
	WireActionLogEntry,
	WireDevtoolsState,
} from './FilterEngineAsync.js';

/**
 * The adapter-owned collaborators the devtools shim reads and writes through.
 *
 * @typeParam T - The item type the underlying engine operates over
 */
export interface AsyncDevtoolsShimContext<T> {
	/**
	 * Names the caller in unsupported-surface errors — `'createSignalsEngineFromAsync'` or
	 * `'createRxJsEngineFromAsync'` — so a shared error never names the wrong adapter.
	 */
	readonly adapterName: string;
	/**
	 * Apply the optimistic cursor **and** bump last-change, **atomically**.
	 *
	 * @remarks
	 * **Do not simplify this to a plain `setDevtoolsState` setter.** All three mutators write two pieces of state together, and the signals adapter
	 * wraps them in `batch()` so a consumer using `useLastChange` re-renders **once**, with the new
	 * cursor already visible. `batch` is `@preact/signals-core`'s and cannot cross into this
	 * package, which is the whole reason the boundary sits one level up: the adapter owns _how_ the
	 * pair is applied, this module owns _what_ the next cursor is.
	 *
	 * A two-setter contract does not merely lose a micro-optimization. It splits an update the
	 * panel reads as atomic, so the cursor and the last-change tick land in different frames and
	 * the row tint flickers — on exactly the tier where the round trip is slow enough to see it.
	 *
	 * Keeping `Date.now()` on the adapter side is a testability win worth having.
	 */
	readonly applyOptimisticCursor: (next: WireDevtoolsState) => void;
	/** The worker-hosted engine the time-travel calls dispatch to. */
	readonly asyncEngine: FilterEngineAsync<T>;
	/** Live read of the adapter's action-log mirror. */
	readonly getActionLog: () => readonly WireActionLogEntry[];
	/** Live read of the adapter's devtools-state mirror. */
	readonly getDevtoolsState: () => WireDevtoolsState;
	/**
	 * Refresh every mirror once the worker confirms, so drift between the optimistic cursor and
	 * engine truth resolves. The adapters' `bumpAfterTimeTravel`.
	 */
	readonly onTimeTravelSettled: () => void;
}

/**
 * The read-only view of the worker's action log that the shim exposes.
 *
 * @remarks
 * Matches enough of core's `ActionLog` for a devtools panel to render rows and highlight the
 * cursor. The mutators are present and throw: a panel that calls them is asking to mutate
 * worker-owned state through a main-thread mirror, and failing loudly beats silently diverging.
 */
export interface AsyncActionLogView {
	/** Iteration support, so consumers can `for (const entry of devtools.actionLog)`. */
	[Symbol.iterator]: () => Iterator<WireActionLogEntry>;
	/** Not mirrored — the log is worker-owned. */
	append: () => never;
	/** Not mirrored — the log is worker-owned. */
	clear: () => never;
	readonly currentIndex: number;
	get: (index: number) => WireActionLogEntry | undefined;
	/** Not authoritative — the real cap lives worker-side. */
	readonly maxEntries: number;
	/** Not mirrored — use `jumpTo` on the shim itself. */
	setCurrentIndex: () => never;
	readonly size: number;
	toArray: () => readonly WireActionLogEntry[];
}

/**
 * The main-thread devtools surface for a worker-backed engine.
 *
 * @remarks
 * Reads are synchronous against the adapter's mirrors; the three time-travel mutators paint
 * optimistically and then fire across the postMessage boundary.
 */
export interface AsyncDevtoolsShim {
	readonly actionLog: AsyncActionLogView;
	readonly canRedo: boolean;
	readonly canUndo: boolean;
	readonly currentIndex: number;
	/** No-op — worker-side `Devtools` tears down via `asyncEngine.destroy`. */
	destroy: () => Promise<void>;
	diff: () => never;
	/** No-op — worker-side `Devtools` init already happened during boot. */
	init: () => Promise<void>;
	jumpTo: (index: number) => void;
	readonly persistence: null;
	recordAction: () => never;
	redo: () => void;
	readonly reduxBridge: null;
	replay: () => never;
	readonly replayer: never;
	readonly timeTravel: never;
	undo: () => void;
}

/**
 * Build the shared main-thread devtools shim for a worker-backed reactive adapter.
 *
 * @typeParam T - The item type the underlying engine operates over
 * @param ctx - The adapter's mirror readers, its atomic cursor writer, and the async engine
 * @returns A synchronous devtools surface backed by the adapter's mirrors
 */
export function createAsyncDevtoolsShim<T>(ctx: AsyncDevtoolsShimContext<T>): AsyncDevtoolsShim {
	const {
		adapterName,
		applyOptimisticCursor,
		asyncEngine,
		getActionLog,
		getDevtoolsState,
		onTimeTravelSettled,
	} = ctx;

	/**
	 * Refuse a surface the main thread does not mirror.
	 *
	 * @remarks
	 * The sync `Devtools` class exposes deeper facilities (`replay`, `diff`, `recordAction`,
	 * `reduxBridge`, `persistence`) that access worker-only state with no obvious cross-boundary
	 * shape. Throwing with the surface name beats returning something plausible and wrong.
	 *
	 * @param name - The devtools surface being reached for
	 */
	const devtoolsUnsupported = (name: string): never => {
		throw new FilterEngineModeError(
			'MODE_WORKER_UNSUPPORTED',
			`${adapterName}: \`engine.core.devtools.${name}\` is not mirrored `
			+ `to the main thread. Use \`engine.asyncEngine\` directly or extend the devtools `
			+ `shim if you need this surface.`,
		);
	};

	return {
		get actionLog(): AsyncActionLogView {
			// Snapshot both mirrors once, so every getter on the returned view answers from the
			// same consistent pair rather than re-reading mid-render.
			const log = getActionLog();
			const state = getDevtoolsState();

			return {
				append: () => devtoolsUnsupported('actionLog.append'),
				clear: () => devtoolsUnsupported('actionLog.clear'),
				get currentIndex() {
					return state.currentIndex;
				},
				get: (index: number) => log[index],
				get maxEntries() {
					return Infinity;
				},
				setCurrentIndex: () => devtoolsUnsupported('actionLog.setCurrentIndex'),
				get size() {
					return log.length;
				},
				*[Symbol.iterator]() {
					yield* log;
				},
				toArray: () => log,
			};
		},
		get canRedo(): boolean {
			return getDevtoolsState().canRedo;
		},
		get canUndo(): boolean {
			return getDevtoolsState().canUndo;
		},
		get currentIndex(): number {
			return getDevtoolsState().currentIndex;
		},
		destroy: async (): Promise<void> => { /* no-op — see the interface docblock */ },
		diff: () => devtoolsUnsupported('diff'),
		init: async (): Promise<void> => { /* no-op — see the interface docblock */ },
		/**
		 * Jump the cursor to `index`, painting locally first.
		 *
		 * @remarks
		 * The optimistic cursor is CLAMPED to the log's bounds so the panel never renders an
		 * impossible row, but the **unclamped** `index` is what goes over the wire — the worker's
		 * `TimeTravel` owns that decision, and pre-clamping here would make the main thread's idea
		 * of the log length authoritative over the engine's.
		 *
		 * @param index - The target action-log index
		 */
		jumpTo: (index: number): void => {
			const current = getDevtoolsState();
			const maxIndex = current.total - 1;
			const clamped = Math.max(-1, Math.min(maxIndex, index));

			applyOptimisticCursor({
				...current,
				canRedo: clamped < maxIndex,
				canUndo: clamped >= 0,
				currentIndex: clamped,
			});
			void asyncEngine.jumpToDevtoolsIndex(index).then(onTimeTravelSettled);
		},
		get persistence(): null {
			return null;
		},
		recordAction: () => devtoolsUnsupported('recordAction'),
		redo: (): void => {
			const current = getDevtoolsState();

			if (!current.canRedo) {
				return;
			}
			const nextIndex = current.currentIndex + 1;

			applyOptimisticCursor({
				...current,
				canRedo: nextIndex < current.total - 1,
				canUndo: true,
				currentIndex: nextIndex,
			});
			void asyncEngine.redoDevtools().then(onTimeTravelSettled);
		},
		get reduxBridge(): null {
			return null;
		},
		replay: () => devtoolsUnsupported('replay'),
		get replayer(): never {
			return devtoolsUnsupported('replayer');
		},
		get timeTravel(): never {
			return devtoolsUnsupported('timeTravel');
		},
		undo: (): void => {
			const current = getDevtoolsState();

			if (!current.canUndo) {
				return;
			}
			const nextIndex = current.currentIndex - 1;

			applyOptimisticCursor({
				...current,
				canRedo: true,
				canUndo: nextIndex >= 0,
				currentIndex: nextIndex,
			});
			void asyncEngine.undoDevtools().then(onTimeTravelSettled);
		},
	};
}
