/**
 * `createEngineBusyTracker` — framework-neutral "is the engine doing user-initiated work?"
 * tracker, using a monotonic version-comparison so the busy state can flip to `true` on the
 * exact frame a user commits a change, before any engine round-trip begins.
 *
 * @remarks
 * **The problem this solves.** A UI wants its "computing" affordance to light up the INSTANT the
 * user commits a change (slider release, checkbox click) — before the engine call fires. A naive
 * `isBusy = fetchInFlight` boolean can't: the fetch only starts after the engine emits its change
 * event, which on a worker-backed engine is itself one round-trip later. That 30-80ms gap reads as
 * "nothing happening" — exactly the latency the indicator exists to mask.
 *
 * **The version-comparison pattern.** Two monotonic counters:
 *
 *   - `userActionVersion` — bumped synchronously inside every commit handler, BEFORE the engine
 *     call, via {@link EngineBusyTracker.markUserAction}.
 *   - `resolvedVersion` — advanced when a derived fetch resolves, to the version that was current
 *     when that fetch was kicked off, via {@link EngineBusyTracker.markResolvedAtLeast}.
 *
 * Predicate: `isBusy = userActionVersion > resolvedVersion`. Monotonic + idempotent, so it's
 * robust under render batching and out-of-order / cancelled fetch resolution (where an in-flight
 * counter would get stuck or double-count).
 *
 * **Framework-neutral.** The tracker is a plain factory exposing both a `@preact/signals-core`
 * `isBusy` signal (for any reactive-graph consumer — React/Vue/Svelte on the signals surface) and
 * a `useSyncExternalStore`-shaped `subscribe`/`getIsBusy` pair (for the React binding
 * `useEngineBusy` in `@filter-enginez/react-signals`). No framework import here.
 *
 * @packageDocumentation
 */

import { type ReadonlySignal, signal } from '@preact/signals-core';

// `console` is universally present in Node, browsers, and workers but isn't in the ES2022 lib
// type defs; declare structurally so the isomorphic (no-DOM-lib) tsconfig compiles.
declare const console: { error(...args: unknown[]): void };

/**
 * A framework-neutral engine-busy tracker. Create one per engine instance (or app) and share it
 * across the components that mark actions / resolutions and the ones that read the busy state.
 */
export interface EngineBusyTracker {
	/**
	 * Increment the user-action version. Call inside a commit handler BEFORE the engine call so
	 * the busy state flips `true` on the same frame the user acts.
	 */
	markUserAction(): void;
	/**
	 * Snapshot the current user-action version. A derived-fetch hook captures this at fetch-start
	 * and passes it back to {@link EngineBusyTracker.markResolvedAtLeast} on resolve.
	 */
	captureCurrentVersion(): number;
	/**
	 * Advance the resolved version to AT LEAST `version`. Monotonic (never regresses, even if a
	 * stale fetch resolves after a newer one) and idempotent.
	 */
	markResolvedAtLeast(version: number): void;
	/**
	 * Current busy state — `true` when a user action hasn't yet been reflected in a resolution.
	 * Plain read; safe outside a reactive context. Pairs with {@link EngineBusyTracker.subscribe}
	 * for `useSyncExternalStore`.
	 */
	getIsBusy(): boolean;
	/**
	 * Subscribe to busy-state changes. Returns an unsubscribe. `useSyncExternalStore`-compatible.
	 */
	subscribe(listener: () => void): () => void;
	/**
	 * The busy state as a `@preact/signals-core` signal, for direct reactive-graph consumption.
	 */
	readonly isBusy: ReadonlySignal<boolean>;
}

/**
 * Create a fresh {@link EngineBusyTracker}.
 *
 * @example
 *   const busy = createEngineBusyTracker();
 *   // in a commit handler:
 *   busy.markUserAction();
 *   engine.core.addRule('price', range('price', { min, max }));
 *   // in the derived-fetch hook:
 *   const v = busy.captureCurrentVersion();
 *   await fetchBundle(); busy.markResolvedAtLeast(v);
 */
export function createEngineBusyTracker(): EngineBusyTracker {
	let userActionVersion = 0;
	let resolvedVersion = 0;
	const listeners = new Set<() => void>();
	// Signal mirror of the predicate, for reactive-graph consumers. The `useSyncExternalStore`
	// channel uses the listener set directly (not `signal.subscribe`) to keep snapshot semantics
	// simple and avoid an immediate-call on subscribe.
	const isBusySignal = signal<boolean>(false);

	const recompute = (): void => {
		const isBusyNext = userActionVersion > resolvedVersion;

		if (isBusyNext !== isBusySignal.peek()) {
			isBusySignal.value = isBusyNext;
		}
		for (const listener of listeners) {
			try {
				listener();
			} catch (err) {
				console.error('[engineBusyTracker] listener threw:', err);
			}
		}
	};

	return {
		captureCurrentVersion(): number {
			return userActionVersion;
		},
		getIsBusy(): boolean {
			return userActionVersion > resolvedVersion;
		},
		isBusy: isBusySignal,
		markResolvedAtLeast(version: number): void {
			if (version > resolvedVersion) {
				resolvedVersion = version;
				recompute();
			}
		},
		markUserAction(): void {
			userActionVersion += 1;
			recompute();
		},
		subscribe(listener: () => void): () => void {
			listeners.add(listener);

			return () => {
				listeners.delete(listener);
			};
		},
	};
}
