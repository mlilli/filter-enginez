/**
 * `ReduxDevtoolsBridge` — speaks the Redux DevTools extension's JSON-RPC protocol to surface
 * the engine's action log + state snapshots in the standard browser DevTools panel — without
 * requiring a Redux runtime dependency.
 *
 * @remarks
 * Per `docs/architecture.md` §10.6. The bridge does nothing when:
 *   - The Redux DevTools extension is not installed (`__REDUX_DEVTOOLS_EXTENSION__` undefined)
 *   - The engine runs in a non-browser runtime (Node, Cloudflare Workers, etc.)
 *
 * In either case there are no errors and no startup cost: the connection is attempted once, on
 * construction, and without an extension the bridge stays inert.
 *
 * **An extension that throws is reported, then dropped.** A throw from `connect`, `init`, `send`,
 * `subscribe` or `unsubscribe` goes to the `onFailure` callback (the `Devtools` coordinator turns it
 * into a `DEVTOOLS_EXTENSION_FAILED` report) and closes the connection, so a misbehaving extension
 * is reported once and can never break the engine action that was being recorded.
 *
 * Actions and states cross in their plain-JSON form (`snapshotCodec.ts`), so the extension's
 * state and diff panels show each rule's type, field and config. Messages from the extension
 * (time-travel scrubbing) reach `Devtools` through {@link ReduxDevtoolsBridge.subscribe}.
 *
 * @packageDocumentation
 */

import type { Action } from '../store/Action.js';
import type { EngineSnapshot } from '../store/snapshots.js';

import { serializeAction, serializeSnapshot } from './snapshotCodec.js';

/**
 * The plain form of a value for the extension: the codec's output, or — for a state or action
 * holding a rule that cannot serialize (`PredicateRule`) — a stand-in naming why it is absent.
 */
function forExtension<V>(value: V, encode: (input: V) => unknown): unknown {
	try {
		return encode(value);
	} catch {
		return { unserializable: 'holds a rule without a serialized form (PredicateRule)' };
	}
}

/**
 * Minimal interface for the Redux DevTools extension's connection object. The actual
 * extension exposes a richer API; we only use the subset documented in
 * https://github.com/reduxjs/redux-devtools/blob/main/extension/docs/API/Methods.md
 */
interface ReduxDevtoolsConnection {
	init(initialState: unknown): void;
	send(action: unknown, nextState: unknown): void;
	subscribe(listener: (message: unknown) => void): void;
	unsubscribe?(): void;
}

interface ReduxDevtoolsExtension {
	connect(options: { name: string }): ReduxDevtoolsConnection;
}

declare const globalThis: { __REDUX_DEVTOOLS_EXTENSION__?: ReduxDevtoolsExtension };

// #region docs:bridge-class
/**
 * Bridge to the Redux DevTools extension. Sends actions + state snapshots as if it were a
 * Redux store; the extension's UI scrubbing/diffing/replay panels work against the engine.
 */
export class ReduxDevtoolsBridge {
	private _connection: ReduxDevtoolsConnection | null = null;
	private readonly _onFailure: (cause: unknown) => void;

	/**
	 * @param name - Display name shown in the DevTools extension's store-picker.
	 *               Defaults to `'Filter EngineZ'`.
	 * @param onFailure - Receives whatever the extension threw; the connection is closed first.
	 */
	constructor(name = 'Filter EngineZ', onFailure: (cause: unknown) => void = () => undefined) {
		this._onFailure = onFailure;
		const extension = globalThis.__REDUX_DEVTOOLS_EXTENSION__;

		if (!extension) {
			return;
		}
		try {
			this._connection = extension.connect({ name });
		} catch (error) {
			this._onFailure(error);
		}
	}

	/**
	 * Initialize the bridge with the engine's starting state. Call once at engine
	 * construction.
	 */
	init(initialState: EngineSnapshot | null): void {
		this._call((connection) => {
			connection.init(initialState === null ? null : forExtension(initialState, serializeSnapshot));
		});
	}

	/**
	 * Forward an action + post-action state snapshot to the DevTools extension.
	 */
	recordAction(action: Action, nextState: EngineSnapshot): void {
		this._call((connection) => {
			connection.send(
				forExtension(action, (input) => serializeAction(input) ?? { type: input.type }),
				forExtension(nextState, serializeSnapshot),
			);
		});
	}

	/**
	 * Register a listener for DevTools extension messages (`DISPATCH` with a `JUMP_TO_STATE` /
	 * `JUMP_TO_ACTION` payload when the user scrubs). `Devtools.init` subscribes and routes those
	 * to `TimeTravel.jumpTo`. Does nothing when the extension is absent.
	 *
	 * @param listener - Callback invoked with each extension message
	 */
	subscribe(listener: (message: unknown) => void): void {
		this._call((connection) => {
			connection.subscribe(listener);
		});
	}

	/** Disconnect from the extension (called on engine.destroy()). */
	disconnect(): void {
		this._call((connection) => {
			connection.unsubscribe?.();
		});
		this._connection = null;
	}

	/** True if the extension is present and the bridge is live. */
	get isConnected(): boolean {
		return this._connection !== null;
	}

	/**
	 * Run one call against the live connection; on a throw, close the connection and report.
	 *
	 * @param use - The call to make.
	 */
	private _call(use: (connection: ReduxDevtoolsConnection) => void): void {
		if (this._connection === null) {
			return;
		}
		try {
			use(this._connection);
		} catch (error) {
			this._connection = null;
			this._onFailure(error);
		}
	}
}
// #endregion docs:bridge-class
