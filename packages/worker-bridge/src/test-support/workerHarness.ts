/**
 * @fileoverview Test-support harness for the `@filter-enginez/worker-bridge` pass-3 suites.
 *
 * @remarks
 * **Import-only scaffolding.** Build-excluded (`tsconfig.build.json` → `test-support/`) and
 * coverage-excluded (root `vitest.config.ts`) under the whole-file test-support exception, so its
 * `vitest` devDep import never ships to `dist` and it isn't coverage-measured.
 *
 * **The in-jsdom "worker".** There's no real `Worker` in jsdom, but Comlink round-trips over a
 * `MessageChannel` (de-risked separately). {@link makeChannelWorker} exposes the given engine
 * factories on `port2` — masqueraded as the worker's global `self`, which is what
 * `exposeFilterEngineWorker` reads for its Comlink `expose` endpoint + ready sentinel — and hands
 * back a `port1`-backed `WorkerLike` for `wrapInWorker` to consume. The two ports form the
 * main-thread ↔ worker bridge.
 *
 * @packageDocumentation
 */

import { type Remote, wrap } from 'comlink';
import { afterEach } from 'vitest';

import type { WorkerEngineFactories, WorkerHostedEngine } from '../WorkerHostedEngine.js';

import { exposeFilterEngineWorker } from '../exposeFilterEngineWorker.js';

/** The minimal worker surface `wrapInWorker` consumes (mirrors its internal `WorkerLike`). */
export interface WorkerLike {
	addEventListener(type: string, listener: (ev: unknown) => void): void;
	postMessage(message: unknown, transfer?: readonly unknown[]): void;
	removeEventListener(type: string, listener: (ev: unknown) => void): void;
	terminate(): void;
}

/**
 * A {@link WorkerLike} plus a test-only affordance for firing synthetic events at the worker
 * port — so a suite can drive `wrapInWorker`'s `error` / `messageerror` diagnostic listeners,
 * which real code only ever sees on genuine worker-module load / clone failures.
 */
export interface ChannelWorker extends WorkerLike {
	/**
	 * Dispatch a synthetic DOM-style event at the underlying worker port. `props` are assigned
	 * onto the dispatched `Event` — e.g. `{ message }` for an `'error'` event or `{ data }` for
	 * a `'messageerror'` event, matching the fields `wrapInWorker`'s listeners read.
	 *
	 * @param type - The event type to dispatch (e.g. `'error'`, `'messageerror'`)
	 * @param props - Optional fields copied onto the event object
	 */
	dispatchWorkerEvent(type: string, props?: Readonly<Record<string, unknown>>): void;
}

/** Port pairs to close after each test. */
const openPorts: MessagePort[] = [];

afterEach(() => {
	while (openPorts.length > 0) {
		openPorts.pop()?.close();
	}
});

/**
 * Wire an in-jsdom worker over a `MessageChannel`: expose `factories` on `port2` (as the worker's
 * `self`) and return a `WorkerLike` over `port1` for `wrapInWorker`.
 *
 * @typeParam ItemTypes - Factory name to its engine's item type, inferred as `exposeFilterEngineWorker` infers it
 * @param factories - The named engine factories to register on the worker side
 * @returns A `WorkerLike` connected to the exposed worker router
 */
export function makeChannelWorker<ItemTypes extends Readonly<Record<string, unknown>>>(
	factories: WorkerEngineFactories<ItemTypes>,
): ChannelWorker {
	const channel = new MessageChannel();
	const { port1, port2 } = channel;

	openPorts.push(port1, port2);

	// `exposeFilterEngineWorker` reads global `self` for its `expose` endpoint + the ready
	// sentinel, both synchronously. Point `self` at port2 for the exposure, then restore.
	const globalRef = globalThis as { self?: unknown };
	const priorSelf = globalRef.self;

	globalRef.self = port2;
	try {
		exposeFilterEngineWorker(factories);
	} finally {
		globalRef.self = priorSelf;
	}

	// Mirror the attached listeners so `dispatchWorkerEvent` can invoke them directly, sidestepping
	// a cross-realm `Event` mismatch (`new Event(...)` under Vitest's jsdom pool isn't the same
	// class `port1.dispatchEvent` expects). The port still receives every real 'message' event.
	const listeners = new Map<string, Set<(ev: unknown) => void>>();

	return {
		addEventListener(type, listener): void {
			let set = listeners.get(type);

			if (!set) {
				set = new Set();
				listeners.set(type, set);
			}
			set.add(listener);
			port1.addEventListener(type, listener);
			// MessagePorts don't deliver until started; start on first listener attach so the
			// already-queued ready sentinel reaches wrapInWorker's handshake listener.
			port1.start();
		},
		dispatchWorkerEvent(type, props): void {
			// A plain event-like object carries the fields the listeners read (`message` / `data`).
			const event = { type, ...props };

			listeners.get(type)?.forEach((listener) => {
				listener(event);
			});
		},
		postMessage(message, transfer): void {
			port1.postMessage(message, (transfer ?? []) as Transferable[]);
		},
		removeEventListener(type, listener): void {
			listeners.get(type)?.delete(listener);
			port1.removeEventListener(type, listener);
		},
		terminate(): void {
			port1.close();
			port2.close();
		},
	};
}

/**
 * Wire an in-jsdom worker and return a RAW Comlink proxy over it — WITHOUT `wrapInWorker`'s
 * auto-`init` step.
 *
 * @remarks
 * The escape hatch the guard-throw suites need. `wrapInWorker` always calls `init` for you
 * exactly once before handing back the facade, which makes three router guards unreachable
 * through the public API: the `init`-twice throw, the unknown-factory throw, and the pre-`init`
 * `ensure()` throw. Driving the worker router directly through this raw proxy lets a test call
 * `init` twice, call it with a bogus factory name, or call an engine method *before* `init` —
 * exercising each guard for real rather than exempting it from coverage.
 *
 * @typeParam T - The item type of the engine the test will `init`
 * @typeParam ItemTypes - Factory name to its engine's item type; every factory builds a `T` unless
 *   the test registers a mixed map
 * @param factories - The named engine factories to register on the worker side
 * @returns The backing {@link ChannelWorker} plus a `Remote<WorkerHostedEngine<T>>` proxy over it
 */
export function wrapRawWorker<T, ItemTypes extends Readonly<Record<string, unknown>> = Readonly<Record<string, T>>>(
	factories: WorkerEngineFactories<ItemTypes>,
): { readonly proxy: Remote<WorkerHostedEngine<T>>; readonly worker: ChannelWorker } {
	const worker = makeChannelWorker(factories);
	// `wrap` accepts the structural `WorkerLike` surface directly (same as `wrapInWorker`).
	const proxy = wrap<WorkerHostedEngine<T>>(worker);

	return { proxy, worker };
}
