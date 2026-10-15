/**
 * `exposeFilterEngineWorker` — the worker-side entry point. Registers named engine factories,
 * builds the Comlink router that delegates every `FilterEngineAsync` method to the constructed
 * engine, and calls `Comlink.expose(...)`.
 *
 * @remarks
 * Per `docs/architecture.md` §15.1. `WorkerHostedEngine.ts` holds the type definitions; this
 * module holds the runtime. The router methods are
 * deliberately NON-async where they have no `await` — they delegate to a synchronous engine
 * call and return the bare value. Comlink's `expose` lifts that value into a `Promise` on the
 * main-thread proxy, so the worker-side handler doesn't need to return one itself. Only `init`
 * (awaits the factory) and `destroy` (awaits engine teardown) are genuinely async. See the
 * `WorkerRouter` type for the linter rationale (`require-await` vs `promise-function-async`).
 *
 * @packageDocumentation
 */

import {
	type ChangeEvent,
	type CompositeRule,
	type FilterBundle,
	type FilterBundleQuery,
	type FilterEngine,
	FilterEngineConfigError,
	FilterEngineModeError,
	type FilterRule,
	type RuleId,
	ruleRegistry,
	type SerializedRule,
} from '@filter-enginez/core';
import { type Endpoint, expose, proxy, transfer } from 'comlink';

import type { WireDevtoolsState } from './FilterEngineAsync.js';
import type { WorkerEngineFactories, WorkerHostedEngine } from './WorkerHostedEngine.js';

import { installErrorTransferHandler } from './errorTransfer.js';
import { devtoolsOf, ensure, registeredFactories } from './hostedEngineAccess.js';
import { toWireActionLogEntry, toWireEvent } from './wireFormat.js';

// Browser-only globals: `self` is the worker's global scope. Declare structurally so the
// isomorphic tsconfig (no DOM lib) compiles. At runtime the worker's `self` provides
// `postMessage` / `addEventListener` that Comlink's `expose` needs. The minimal shape here
// carries the `postMessage` we call directly for the ready-handshake sentinel; the broader
// endpoint surface Comlink needs is bridged via the `Endpoint` cast at the `expose` call.
declare const self: { postMessage(message: unknown): void };

// `console` is universally available (Node, browsers, workers) but not in the ES2022 lib
// type defs. Declare structurally so the isomorphic tsconfig compiles cleanly.
declare const console: {
	error(...args: unknown[]): void;
};

/**
 * Worker-side router shape — the `WorkerHostedEngine` surface with every method's `Promise`
 * return unwrapped to its resolved value.
 *
 * @remarks
 * Comlink's `expose` already lifts synchronous return values into Promises on the main-thread
 * proxy, so the worker-side handlers don't need to return Promises themselves. Writing them as
 * plain synchronous methods (returning the unwrapped value) keeps them honest with the linter:
 * an `async` method with no `await` violates `require-await`, while a non-`async` method that
 * manually returns a Promise violates `promise-function-async`. Returning the bare value sides
 * cleanly with both. The genuinely asynchronous handlers (`init`, `destroy`) keep their
 * `Promise<void>` return and stay `async`.
 *
 * @internal
 */
type UnwrapPromiseReturn<F> = F extends (...args: infer A) => Promise<infer R>
	? (...args: A) => Promise<R> | R
	: F;

type WorkerRouter = {
	[K in keyof WorkerHostedEngine<unknown>]: UnwrapPromiseReturn<WorkerHostedEngine<unknown>[K]>;
};

/**
 * Register one or more named engine factories on a worker, then call `Comlink.expose(...)`.
 *
 * Consumers call this inside their worker file (the one the `worker` they hand `wrapInWorker`
 * was spawned from). The factories run lazily — `init({ factoryName })` from the main thread
 * picks the matching factory and instantiates it.
 *
 * @typeParam ItemTypes - Factory name to the item type its engine holds; inferred from `factories`.
 * @param factories - Map of `{ [factoryName]: factory }`. Each factory keeps its own item type, so a
 *   `WorkerEngineFactory<Wine>` registers as written.
 *
 * @example
 *   // In worker.ts:
 *   import { exposeFilterEngineWorker } from '@filter-enginez/worker-bridge';
 *   import { createFilterEngine } from '@filter-enginez/core';
 *
 *   exposeFilterEngineWorker({
 *     wineEngine: (opts) => createFilterEngine({ sourceData: opts['wines'] as Wine[] }),
 *     listingEngine: (opts) => createFilterEngine({ sourceData: opts['listings'] as Listing[] }),
 *   });
 */
export function exposeFilterEngineWorker<ItemTypes extends Readonly<Record<string, unknown>>>(
	factories: WorkerEngineFactories<ItemTypes>,
): void {
	const registered = registeredFactories(factories);

	// The worker-side state: which factory was picked + the constructed engine. Both null
	// until `init({ factoryName })` from the main thread populates them.
	let engine: FilterEngine<unknown> | undefined;

	/**
	 * The router object Comlink exposes. Every consumer-facing method on `FilterEngineAsync`
	 * gets a thin proxy here that delegates to the constructed engine. Methods called before
	 * `init` runs throw a clear error.
	 */
	const router: WorkerRouter = {
		// ─── Groups ────────────────────────────────────────────────────────
		addGroup(group) {
			ensure(engine).addGroup(group);
		},

		// ─── Rules ─────────────────────────────────────────────────────────
		// `getRule`/`getRules` SERIALIZE the rule instances via `toJSON()` before returning.
		// Rule subclasses (notably `FuzzySearchRule` with its Fuse.js index, and any rule
		// holding RegExp / Map / class instance internals) are NOT structuredClone-safe —
		// returning them directly throws "Unserializable return value" at the postMessage
		// boundary. The serialized JSON form crosses fine; the consumer-side adapter
		// (`createSignalsEngineFromAsync` / `createRxJsEngineFromAsync`) reconstructs real
		// `FilterRule` instances via `ruleRegistry.deserialize`.
		//
		// The type signature says `FilterRule` because it mirrors the `FilterEngineAsync`
		// interface; the wire form is an internal worker-bridge concern, invisible to consumer
		// code through the adapters.
		addRule(ruleId, rule) {
			// `rule` arrives over the wire as a serialized JSON form (see consumer-adapter
			// `.core.addRule` shim — instances can't structuredClone because they hold function
			// fields like the `action` method). Reconstruct via the registry, then hand the
			// real class instance to the engine.
			const reconstructed = ruleRegistry.deserialize(rule as unknown as SerializedRule);

			ensure(engine).addRule(ruleId, reconstructed);
		},
		/**
		 * The single-round-trip bundle method. Runs the core engine's `applyFiltersAndQuery`
		 * then packages all transferable typed arrays into the postMessage transfer list so
		 * the entire bundle ships zero-copy.
		 *
		 * @remarks
		 * **The transferable list.** Comlink's `transfer(value, [...buffers])` accepts ANY
		 * number of `ArrayBuffer`s in the second argument; postMessage then transfers each
		 * one's ownership in a single message. We collect:
		 *
		 *   - `resultIndices.buffer` (the Uint32Array of result indices)
		 *   - For each requested field: `histogram.bucketEdges.buffer` + `histogram.counts.buffer`
		 *
		 * For a query with 4 fields, that's 1 + 4×2 = 9 transferable buffers in one message,
		 * where asking for each fact separately would cost one postMessage apiece.
		 *
		 * **The fresh-allocation pattern.** Same rationale as `getResultIndices`: the engine's
		 * `applyFiltersAndQuery` returns typed arrays it OWNS — transferring them directly
		 * would detach the buffers from the worker's process memory. We allocate fresh
		 * `Uint32Array`/`Float64Array` instances (one-time copy at the worker boundary) so the
		 * engine's internal state stays intact while still giving us transferables to ship.
		 */
		applyFiltersAndQuery(query: FilterBundleQuery = {}) {
			const bundle = ensure(engine).applyFiltersAndQuery(query);

			// Copy + collect transferables. The copy is byte-level memcpy via the typed-array
			// constructor; for the wine corpus's 150k-record full tier, total copy cost
			// is sub-millisecond. The transfer itself is constant-time regardless of size.
			const indicesCopy = new Uint32Array(bundle.resultIndices);
			const transferables: ArrayBuffer[] = [indicesCopy.buffer];

			const fieldsCopy = bundle.fields.map((field) => {
				const edgesCopy = new Float64Array(field.histogram.bucketEdges);
				const countsCopy = new Uint32Array(field.histogram.counts);

				transferables.push(edgesCopy.buffer, countsCopy.buffer);

				return {
					bounds: field.bounds,
					fieldKey: field.fieldKey,
					histogram: { bucketEdges: edgesCopy, counts: countsCopy },
					ruleId: field.ruleId,
				};
			});

			const wireSafe: FilterBundle = {
				// `chipGroups` is plain JSON (no typed arrays); structuredClone handles it
				// fine without transferables. We just pass it through.
				chipGroups: bundle.chipGroups,
				fields: fieldsCopy,
				resultCount: bundle.resultCount,
				resultIndices: indicesCopy,
			};

			return transfer(wireSafe, transferables);
		},
		clearRules() {
			ensure(engine).clearRules();
		},
		// The destroyed engine is KEPT rather than cleared: a later call then reaches the core's own
		// guard and rejects with `FilterEngineDestroyedError`, instead of reading as "before init()".
		async destroy() {
			if (engine) {
				await engine.destroy();
			}
		},

		exportConfig() {
			return ensure(engine).exportConfig();
		},
		getActionLogSnapshot() {
			// The Devtools coordinator owns the action log; each entry is serialized through
			// `toWireActionLogEntry` to strip the non-cloneable snapshot blobs + FilterRule instances.
			return devtoolsOf(engine)?.actionLog.toArray().map(toWireActionLogEntry) ?? [];
		},
		getActiveRuleIds() {
			return ensure(engine).getActiveRuleIds();
		},
		getDevtoolsState() {
			const devtools = devtoolsOf(engine);

			if (devtools === undefined) {
				const empty: WireDevtoolsState = {
					canRedo: false, canUndo: false, currentIndex: -1, total: 0,
				};

				return empty;
			}

			return {
				canRedo: devtools.canRedo,
				canUndo: devtools.canUndo,
				currentIndex: devtools.currentIndex,
				total: devtools.actionLog.size,
			};
		},
		getExpression() {
			const expr = ensure(engine).getExpression();

			return expr === null ? null : (expr.serialize() as unknown as CompositeRule);
		},

		/**
		 * Run the core engine's `getFilteredFieldValuesExcept` and ship the result back as a
		 * transferable Float64Array — zero-copy across the postMessage boundary.
		 *
		 * @remarks
		 * Same wire-shape pattern as `getResultIndices`: we allocate a fresh `Float64Array`
		 * (rather than transferring the engine's own backing buffer) and mark it as
		 * transferable. Engine-side allocations stay intact for future calls; the main thread
		 * receives ownership of a brand new buffer.
		 *
		 * Float64Array.from copies the numbers from the engine's plain array into the typed
		 * buffer — for 100k-item arrays that's a sub-millisecond memcpy; the transfer itself
		 * is constant-time regardless of size.
		 */
		getFilteredFieldValuesExcept(excludeRuleId: RuleId, fieldKey: string) {
			const eng = ensure(engine);
			// The core method's signature requires `fieldKey: keyof T & string` but at the
			// worker boundary we lose the T generic — cast through unknown to bridge the gap.
			const values = (eng as unknown as {
				getFilteredFieldValuesExcept: (id: RuleId, key: string) => readonly number[];
			}).getFilteredFieldValuesExcept(excludeRuleId, fieldKey);
			const buf = Float64Array.from(values);

			return transfer(buf, [buf.buffer]);
		},
		getGroups() {
			return ensure(engine).getGroups();
		},

		getResultCount() {
			return ensure(engine).getResultCount();
		},
		/**
		 * Ship the result-indices Uint32Array to the main thread via a zero-copy postMessage
		 * transfer.
		 *
		 * **Why we copy before transferring.** The engine's `getResultIndices()` returns the
		 * Uint32Array OWNED by its `resultIndices` computed signal. Transferring that buffer
		 * directly would detach it from the worker's process memory — subsequent reads from
		 * inside the worker (e.g., the engine's own `getResults()` projection, or any future
		 * tick of the same computed signal before re-evaluation) would throw or return zeroes.
		 * Allocating a fresh `Uint32Array` whose buffer we OWN keeps the worker's signal-graph
		 * intact while still giving us a transferable to ship.
		 *
		 * The copy itself is byte-level (Uint32Array's constructor accepts another typed-array
		 * and runs the equivalent of a memcpy). At 150k indices × 4 bytes = 600KB, that's a
		 * sub-millisecond cost regardless of the filter result size; the transfer that follows
		 * is constant-time.
		 *
		 * `Comlink.transfer(value, [transferables])` marks the buffer for postMessage's
		 * second-argument transfer list, which is the spec-defined way to move ArrayBuffers
		 * across thread boundaries without copying.
		 */
		getResultIndices() {
			const live = ensure(engine).getResultIndices();
			const copy = new Uint32Array(live);

			return transfer(copy, [copy.buffer]);
		},
		// ─── Results ───────────────────────────────────────────────────────
		getResults() {
			return ensure(engine).getResults();
		},

		getRule(ruleId) {
			const rule = ensure(engine).getRule(ruleId);

			return rule === undefined ? undefined : (rule.serialize() as unknown as FilterRule);
		},
		getRules() {
			const rules = ensure(engine).getRules();
			const serialized = new Map<RuleId, FilterRule>();

			for (const [id, rule] of rules) {
				serialized.set(id, rule.serialize() as unknown as FilterRule);
			}

			return serialized;
		},
		getSourceData() {
			return ensure(engine).getSourceData();
		},

		async init(config, callbacks) {
			if (engine) {
				throw new FilterEngineModeError(
					'MODE_WORKER_ALREADY_INITIALIZED',
					`exposeFilterEngineWorker: init() called twice. The worker hosts one engine `
					+ `for its lifetime; spawn a new worker for a different factory.`,
				);
			}
			const factory = registered.get(config.factoryName);

			if (factory === undefined) {
				throw new FilterEngineConfigError(
					'WORKER_FACTORY_NOT_FOUND',
					`exposeFilterEngineWorker: no factory registered under name '${config.factoryName}'. `
					+ `Registered factories: [${[...registered.keys()].join(', ') || '(none)'}].`,
				);
			}
			// Pass both the serializable options AND any Comlink-proxied callbacks through to
			// the factory. The callbacks object, if present, came across as a Comlink remote
			// — each method call from this worker round-trips back to the main thread via
			// postMessage. Factory code uses them like ordinary async functions.
			engine = await factory(config.options ?? {}, callbacks);
		},

		jumpToDevtoolsIndex(index) {
			devtoolsOf(engine)?.jumpTo(index);
		},

		// ─── JSON config ───────────────────────────────────────────────────
		loadConfig(config) {
			ensure(engine).loadConfig(config);
		},

		redoDevtools() {
			devtoolsOf(engine)?.redo();
		},

		removeGroup(groupId) {
			ensure(engine).removeGroup(groupId);
		},

		removeRule(ruleId) {
			ensure(engine).removeRule(ruleId);
		},

		// ─── Lifecycle ─────────────────────────────────────────────────────
		reset() {
			ensure(engine).reset();
		},
		resetWorkingSet() {
			ensure(engine).resetWorkingSet();
		},

		// ─── Expression ────────────────────────────────────────────────────
		setExpression(expression) {
			// Same serialization dance as `addRule` — a CompositeRule's children are FilterRule
			// instances that don't structuredClone, so the wire form is the recursively-serialized
			// SerializedRule tree (`CompositeRule.serialize`); `ruleRegistry.deserialize` rebuilds
			// the real instance, children and all, here.
			if (expression === null) {
				ensure(engine).setExpression(null);
			} else {
				const reconstructed = ruleRegistry.deserialize(
					expression as unknown as SerializedRule,
				) as CompositeRule;

				ensure(engine).setExpression(reconstructed);
			}
		},

		// ─── Devtools (action log + time-travel) ───────────────────────────
		// The worker is the source of truth — action log + snapshots live here. The main
		// thread reads via `getActionLogSnapshot()` / `getDevtoolsState()` (re-fetched after
		// every engine event) and dispatches time-travel commands via the jump/undo/redo
		// methods. Snapshots themselves never cross the postMessage boundary — only the
		// wire-safe summary used to render rows + the cursor state.

		// ─── Source data + working set ─────────────────────────────────────
		setSourceData(items) {
			ensure(engine).setSourceData(items);
		},

		setWorkingSet(items) {
			ensure(engine).setWorkingSet(items);
		},

		// ─── Simulation ────────────────────────────────────────────────────
		simulate(modification) {
			// `withRule` arrives as a serialized JSON form (rule instances aren't
			// structuredClone-safe). Reconstruct via the registry before passing to the
			// engine's simulate. Other fields are plain data and pass through unchanged.
			let effectiveMod = modification;

			if (modification.withRule !== undefined) {
				const [id, serializedRule] = modification.withRule;
				const reconstructed = ruleRegistry.deserialize(
					serializedRule as unknown as SerializedRule,
				);

				effectiveMod = { ...modification, withRule: [id, reconstructed]};
			}

			return ensure(engine).simulate(effectiveMod);
		},

		/**
		 * Subscribe to engine events. The listener is wrapped in `Comlink.proxy` on the
		 * main-thread side before being sent here, so calling it from this worker dispatches
		 * a postMessage that the main-thread proxy invokes. We unwrap by treating it as a
		 * regular function.
		 *
		 * **The returned Unsubscribe is `proxy()`-wrapped.** Functions can't structuredClone
		 * back to the main thread on their own; without the proxy wrap the worker would throw
		 * "Unserializable return value" the moment the engine's subscribe returned. With the
		 * wrap, the consumer's `await asyncEngine.subscribe(...)` resolves to a Comlink
		 * remote function — calling `unsub()` round-trips a postMessage call to invoke the
		 * real engine-side unsubscribe.
		 */
		subscribe(listener) {
			// **Wire-shape the event before invoking the main-thread listener.** The raw
			// `ChangeEvent` references `FilterRule` / `CompositeRule` instances (with their
			// `action` function field + non-cloneable internals like Fuse indices) AND big
			// before/after arrays for source/working/results events. Forwarding those raw
			// would `DataCloneError` on the rule fields and waste bandwidth on the arrays.
			// `toWireEvent` serializes rules + strips the heavy arrays into a postMessage-
			// safe shape; the adapter on the main side knows how to interpret the wire form.
			const wrapped = (event: ChangeEvent): void => {
				try {
					(listener)(toWireEvent(event));
				} catch (err) {
					console.error('[WorkerHostedEngine] subscribe listener threw:', err);
				}
			};
			const unsub = ensure(engine).subscribe(wrapped);

			return proxy(unsub);
		},

		undoDevtools() {
			devtoolsOf(engine)?.undo();
		},
	};

	// `self` in a worker context is the global scope; Comlink uses its postMessage /
	// addEventListener to handle the proxy traffic. The cast bridges our minimal structural
	// `self` declaration to Comlink's `Endpoint` type at this single edge point — the worker
	// runtime supplies the full endpoint surface (addEventListener / removeEventListener).
	// The error transfer handler goes in first so a rejection keeps its class, `code` and `cause`.
	installErrorTransferHandler();
	expose(router, self as unknown as Endpoint);

	// Post a ready sentinel AFTER `expose` has wired its message listener. The main thread
	// (in `wrapInWorker`) waits for this before sending any init messages. Without this
	// handshake, messages sent from main before the worker module finishes evaluating get
	// silently dropped — observed in Vite `?worker` dev mode where the worker's HMR client
	// + module-worker boot sequence both run before our `expose` listener attaches, and the
	// browser's "queue messages until listener attaches" guarantee doesn't hold across that
	// boundary in practice.
	//
	// The sentinel uses a distinctive marker so it can't collide with Comlink's own
	// message envelope shape.
	/* v8 ignore next 3 -- defensive: `self` is `declare`d (an unverified assertion) as always
	   carrying `postMessage`, and inside a real worker it does — the false branch only fires if
	   this module is evaluated outside a worker context. */
	if (typeof self.postMessage === 'function') {
		self.postMessage({ __filterEnginezWorkerReady: true });
	}
}
