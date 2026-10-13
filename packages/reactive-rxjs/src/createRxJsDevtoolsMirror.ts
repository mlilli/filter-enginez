/**
 * `createRxJsDevtoolsMirror` — the RxJS adapter's local mirror of the worker's action log and
 * devtools cursor.
 *
 * @remarks
 * ### Why this exists
 *
 * The worker's devtools state lives across a postMessage boundary, so the synchronous
 * `engine.core.devtools` surface (built by the shared `createAsyncDevtoolsShim`) needs a local
 * mirror of the action log and cursor to read from. This module is that mirror for the RxJS
 * adapter.
 *
 * ### Why it is its own module
 *
 * `createRxJsEngineFromAsync.ts` is close to the 500-line cap. This is the same split the signals
 * twin makes with its refreshers (`createAsyncMirrorRefreshers.ts`).
 *
 * ### It owns the whole devtools concern, not just the subjects
 *
 * The two mirrors, their refresher, the post-time-travel reconciliation, and the four collaborators
 * the shared shim needs all live here, so none of it lands in the adapter file.
 *
 * @packageDocumentation
 */

import type { ChangeEvent } from '@filter-enginez/core';
import type {
	AsyncDevtoolsShimContext,
	FilterEngineAsync,
	WireActionLogEntry,
	WireDevtoolsState,
} from '@filter-enginez/worker-bridge';

import { BehaviorSubject } from 'rxjs';

/** What {@link createRxJsDevtoolsMirror} needs from the adapter. */
export interface RxJsDevtoolsMirrorContext<T> {
	/** The worker-hosted engine to re-pull from. */
	readonly asyncEngine: FilterEngineAsync<T>;
	/**
	 * Live read of the adapter's disposal flag.
	 *
	 * @remarks
	 * Routed through a call for the same reason the adapter's own `checkDisposed` is: `dispose()`
	 * can flip the flag while a refresh's `await` is in flight, and TypeScript narrows a
	 * closure-captured `let` to its pre-await value.
	 */
	readonly getIsDisposed: () => boolean;
	/** The action log as pulled during the adapter's boot `Promise.all`. */
	readonly initialActionLog: readonly WireActionLogEntry[];
	/** The devtools cursor as pulled during the adapter's boot `Promise.all`. */
	readonly initialDevtoolsState: WireDevtoolsState;
	readonly lastChangeEventSubject: BehaviorSubject<ChangeEvent | null>;
	readonly lastChangeTimestampSubject: BehaviorSubject<number | null>;
	/** The adapter's full-mirror refresher, run after a confirmed time-travel. */
	readonly refreshEverything: () => Promise<void>;
}

/** The two mirror subjects, their refresher, and the shared shim's collaborators. */
export interface RxJsDevtoolsMirror<T> {
	readonly actionLogSubject: BehaviorSubject<readonly WireActionLogEntry[]>;
	/**
	 * The four collaborators `createAsyncDevtoolsShim` needs, ready to hand to `buildCoreShim`.
	 * `adapterName` and `asyncEngine` stay with the shim's construction site.
	 */
	readonly devtoolsShimDeps: Pick<
		AsyncDevtoolsShimContext<T>,
		'applyOptimisticCursor' | 'getActionLog' | 'getDevtoolsState' | 'onTimeTravelSettled'
	>;
	readonly devtoolsStateSubject: BehaviorSubject<WireDevtoolsState>;
	/** Re-pull both mirrors from the worker. Safe to call on every engine event. */
	readonly refreshDevtools: () => Promise<void>;
}

/**
 * Build the adapter's devtools mirror, seeded from the boot pull.
 *
 * @typeParam T - The item type the underlying engine operates over
 * @param ctx - The async engine, the disposal accessor, and the two seed values
 * @returns The two mirror subjects and their refresher
 */
export function createRxJsDevtoolsMirror<T>(
	ctx: RxJsDevtoolsMirrorContext<T>,
): RxJsDevtoolsMirror<T> {
	const {
		asyncEngine,
		getIsDisposed,
		initialActionLog,
		initialDevtoolsState,
		lastChangeEventSubject,
		lastChangeTimestampSubject,
		refreshEverything,
	} = ctx;

	const actionLogSubject = new BehaviorSubject<readonly WireActionLogEntry[]>(initialActionLog);
	const devtoolsStateSubject = new BehaviorSubject<WireDevtoolsState>(initialDevtoolsState);

	/**
	 * Re-pull the worker's action log + cursor into the local mirrors.
	 *
	 * @remarks
	 * Cheap: the wire payload is tens of bytes per entry, capped at the worker's `actionLogSize`
	 * (default 100). Fired after every engine event so a devtools panel sees current state without
	 * subscribing to anything itself.
	 *
	 * Both mirrors are pulled in parallel and emitted together, so a subscriber can never observe a
	 * log from one tick against a cursor from another — the RxJS equivalent of the signals twin's
	 * `batch()` around the same pair.
	 */
	const refreshDevtools = async (): Promise<void> => {
		if (getIsDisposed()) {
			return;
		}
		const [log, state] = await Promise.all([
			asyncEngine.getActionLogSnapshot(),
			asyncEngine.getDevtoolsState(),
		]);

		if (getIsDisposed()) {
			return;
		}
		actionLogSubject.next(log);
		devtoolsStateSubject.next(state);
	};

	/**
	 * Reconcile every mirror with engine truth once a time-travel round trip confirms.
	 *
	 * @remarks
	 * Worker-side `TimeTravel` calls `restoreSnapshot` straight on the store, **bypassing the
	 * dispatcher** — so no `ChangeEvent` is emitted and the main thread only learns a time-travel
	 * succeeded by re-fetching. The shared shim paints the cursor optimistically; this resolves any
	 * drift between that paint and what the engine actually did. Twin of the signals adapter's
	 * `bumpAfterTimeTravel`.
	 */
	const bumpAfterTimeTravel = async (): Promise<void> => {
		await Promise.all([refreshEverything(), refreshDevtools()]);
		if (getIsDisposed()) {
			return;
		}
		lastChangeTimestampSubject.next(Date.now());
		lastChangeEventSubject.next({ type: 'reset' });
	};

	return {
		actionLogSubject,
		devtoolsShimDeps: {
			/**
			 * Write the optimistic cursor AND the last-change tick together.
			 *
			 * @remarks
			 * The signals twin needs `batch()` to make this one render; RxJS needs only these two
			 * `next()` calls **in this order**, because a subscriber that re-renders off
			 * `lastChangeTimestamp$` reads the cursor synchronously when it does. Emitting the tick
			 * first would render the old cursor and flicker the panel's row tint — which is exactly
			 * the failure the shared shim's `applyOptimisticCursor` docblock warns a two-setter
			 * contract would introduce.
			 */
			applyOptimisticCursor: (next: WireDevtoolsState): void => {
				devtoolsStateSubject.next(next);
				lastChangeTimestampSubject.next(Date.now());
			},
			getActionLog: () => actionLogSubject.value,
			getDevtoolsState: () => devtoolsStateSubject.value,
			// `void`ed explicitly: the shared shim declares this `() => void` because it never
			// awaits the settle. Handing it an async function would drop the promise implicitly.
			onTimeTravelSettled: (): void => {
				void bumpAfterTimeTravel();
			},
		},
		devtoolsStateSubject,
		refreshDevtools,
	};
}
