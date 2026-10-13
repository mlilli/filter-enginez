/**
 * `createEngineBusyStream` — the RxJS sibling of `reactive-signals`' `createEngineBusyTracker`:
 * "is the engine doing user-initiated work?", exposed as a replaying `Observable<boolean>`.
 *
 * @remarks
 * **The problem this solves.** A UI wants its "computing" affordance to light up the INSTANT the user
 * commits a change (slider release, checkbox click) — before the engine call fires. A naive
 * `isBusy = fetchInFlight` boolean can't: the fetch only starts after the engine emits its change
 * event, which on a worker-backed engine is itself one round-trip later. That 30–80ms gap reads as
 * "nothing happening" — exactly the latency the indicator exists to mask.
 *
 * **The version-comparison pattern.** Two monotonic counters:
 *
 *   - `userActionVersion` — bumped synchronously inside every commit handler, BEFORE the engine call,
 *     via {@link EngineBusyStream.markUserAction}.
 *   - `resolvedVersion` — advanced when a derived fetch resolves, to the version that was current when
 *     that fetch was kicked off, via {@link EngineBusyStream.markResolvedAtLeast}.
 *
 * Predicate: `isBusy = userActionVersion > resolvedVersion`. Monotonic + idempotent, so it is robust
 * under render batching and out-of-order / cancelled fetch resolution, where an in-flight counter
 * would get stuck or double-count.
 *
 * **Why a sibling rather than a re-export.** `createEngineBusyTracker` publishes its state as a
 * `@preact/signals-core` signal. Importing it from an RxJS consumer would pull the signals runtime
 * into the graph purely to read a boolean — the same coupling the surface-neutral books boot exists to
 * avoid. The two reactive surfaces are siblings, not layers (compare `createSignalsEngine` and
 * `createRxJsEngine`, which each own their fan-out), so each expresses this in its native idiom. The
 * ~15 lines of counter logic are duplicated deliberately; the *semantics* are the contract, and they
 * are pinned by tests on both sides.
 *
 * Like every other stream in this package, `isBusy$` replays its current value on subscribe, so
 * Angular's `| async` renders the real state on the first tick.
 *
 * @packageDocumentation
 */

import { BehaviorSubject, distinctUntilChanged, type Observable, shareReplay } from 'rxjs';

/**
 * An engine-busy tracker exposing its state as an Observable. Create one per engine instance (or app)
 * and share it across the components that mark actions / resolutions and the ones that read the state.
 */
export interface EngineBusyStream {
	/**
	 * Current busy state as a replaying stream — `true` when a user action has not yet been reflected
	 * in a resolution.
	 */
	readonly isBusy$: Observable<boolean>;
	/**
	 * Increment the user-action version. Call inside a commit handler BEFORE the engine call so the
	 * busy state flips `true` on the same frame the user acts.
	 */
	markUserAction(): void;
	/**
	 * Snapshot the current user-action version. A derived-fetch captures this at fetch-start and passes
	 * it back to {@link EngineBusyStream.markResolvedAtLeast} on resolve.
	 */
	captureCurrentVersion(): number;
	/**
	 * Advance the resolved version to AT LEAST `version`. Monotonic (never regresses, even if a stale
	 * fetch resolves after a newer one) and idempotent.
	 */
	markResolvedAtLeast(version: number): void;
	/**
	 * Current busy state as a plain read — safe outside a subscription, for imperative checks.
	 */
	getIsBusy(): boolean;
	/** Complete the underlying subject. Idempotent. */
	dispose(): void;
}

/**
 * Create a fresh {@link EngineBusyStream}.
 *
 * @returns The tracker.
 *
 * @example
 * ```ts
 * const busy = createEngineBusyStream();
 * // in a commit handler:
 * busy.markUserAction();
 * engine.core.addRule('price', range('price', { min, max }));
 * // in the derived-fetch:
 * const version = busy.captureCurrentVersion();
 * await fetchBundle();
 * busy.markResolvedAtLeast(version);
 * ```
 */
export function createEngineBusyStream(): EngineBusyStream {
	let userActionVersion = 0;
	let resolvedVersion = 0;
	let isDisposed = false;
	const subject = new BehaviorSubject<boolean>(false);
	const isBusy$ = subject.pipe(distinctUntilChanged(), shareReplay({ bufferSize: 1, refCount: false }));

	/** Push the current predicate value, if it changed and we are still live. */
	const recompute = (): void => {
		if (isDisposed) {
			return;
		}
		const isBusyNext = userActionVersion > resolvedVersion;

		if (isBusyNext !== subject.value) {
			subject.next(isBusyNext);
		}
	};

	return {
		captureCurrentVersion: (): number => userActionVersion,
		dispose: (): void => {
			if (isDisposed) {
				return;
			}
			isDisposed = true;
			subject.complete();
		},
		getIsBusy: (): boolean => userActionVersion > resolvedVersion,
		isBusy$,
		markResolvedAtLeast: (version: number): void => {
			if (version > resolvedVersion) {
				resolvedVersion = version;
				recompute();
			}
		},
		markUserAction: (): void => {
			userActionVersion += 1;
			recompute();
		},
	};
}
