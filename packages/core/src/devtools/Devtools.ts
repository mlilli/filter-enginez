/**
 * `Devtools` — the coordinator class wiring the action log, time-travel, replay, diff,
 * Redux DevTools bridge, and cross-reload persistence into a single `engine.devtools` API.
 *
 * @remarks
 * Per `docs/architecture.md` §10. This is the class behind `engine.devtools.*`, constructed by
 * every `FilterEngine`. `FilterEngine` calls {@link Devtools.recordAction} after every dispatched
 * action and {@link Devtools.init} once at construction; `init` connects the Redux DevTools
 * extension (sending the initial state and routing its time-travel messages to
 * `TimeTravel.jumpTo`) and loads any persisted action log.
 *
 * **`enabled: false`** turns recording off: no action log, no snapshots captured per action
 * (`FilterEngine` skips the capture), no extension connection and no persistence. The
 * time-travel methods stay callable and find nothing to restore.
 *
 * **Failures of the environment are reported, never thrown into the engine.** A storage adapter
 * that fails to load or save the persisted log, or a Redux DevTools extension that throws, reaches
 * `DevtoolsConfig.onError` as a `FilterEngineError` (`DEVTOOLS_PERSISTENCE_FAILED` /
 * `DEVTOOLS_EXTENSION_FAILED`, the original failure as `cause`). Both are side channels: the action
 * being recorded still applies, `ready` still settles and `destroy()` still completes.
 *
 * @packageDocumentation
 */

import type { FilterEngineRuntimeErrorCode } from '../errors/codes.js';
import type { Action } from '../store/Action.js';
import type { Dispatcher } from '../store/Dispatcher.js';
import type { InternalStore } from '../store/InternalStore.js';
import type { EngineSnapshot } from '../store/snapshots.js';

import { FilterEngineError } from '../errors/FilterEngineError.js';
import { ActionLog, type ActionLogEntry, type ActionLogEntryMeta } from './ActionLog.js';
import { DevtoolsPersistence, type DevtoolsPersistenceConfig } from './DevtoolsPersistence.js';
import { diff, type StateDiffEntry } from './Diff.js';
import { ReduxDevtoolsBridge } from './ReduxDevtoolsBridge.js';
import { Replay, type ReplayOptions } from './Replay.js';
import { TimeTravel, type TimeTravelEmit } from './TimeTravel.js';

/**
 * Configuration for the `Devtools` coordinator.
 */
export interface DevtoolsConfig {
	/**
	 * Master switch. Default `true`. `false` records nothing (so undo/redo have nothing to
	 * restore), connects nothing and persists nothing — the setting for production builds that
	 * want no per-action snapshot cost.
	 */
	readonly enabled?: boolean;
	/** Maximum in-memory action log entries. Default 100. */
	readonly actionLogSize?: number;
	/** Display name for the Redux DevTools extension store-picker. */
	readonly reduxDevtoolsName?: string;
	/** Whether to attempt connection to the Redux DevTools extension. Default `true`. */
	readonly bridgeToReduxDevtools?: boolean;
	/** Optional cross-reload persistence. */
	readonly persistence?: DevtoolsPersistenceConfig;
	/**
	 * Receives persistence and Redux DevTools extension failures, as a `FilterEngineError` with
	 * code `DEVTOOLS_PERSISTENCE_FAILED` or `DEVTOOLS_EXTENSION_FAILED` and the original failure as
	 * `cause`. Default: `console.warn`, once per code per engine — enough to notice a full quota or
	 * a broken extension without repeating on every action.
	 */
	readonly onError?: (error: FilterEngineError) => void;
}

/**
 * Devtools coordinator. Owns the action log, time-travel, replay, diff, Redux DevTools
 * bridge, and persistence as composed sub-objects.
 */
export class Devtools<T> {
	readonly actionLog: ActionLog;
	/** Whether recording is on (`DevtoolsConfig.enabled`, default `true`). */
	readonly enabled: boolean;
	readonly persistence: DevtoolsPersistence | null;
	readonly reduxBridge: ReduxDevtoolsBridge | null;
	readonly replayer: Replay<T>;
	readonly timeTravel: TimeTravel<T>;

	/**
	 * The Redux DevTools extension numbers actions 1, 2, 3… in the order they are sent (0 is the
	 * initial state). This maps each sent entry to its number, so a scrub message can be routed to
	 * the entry's CURRENT log index — which drifts from the number as the log evicts its oldest
	 * entries or truncates a branch after a jump. Weak, so evicted entries are not retained.
	 */
	private readonly _extensionIds = new WeakMap<ActionLogEntry, number>();
	private _nextExtensionId = 0;
	private readonly _onError: ((error: FilterEngineError) => void) | undefined;
	private _ready: Promise<void> = Promise.resolve();
	/** Codes the default reporter has already warned about. */
	private readonly _warnedCodes = new Set<FilterEngineRuntimeErrorCode>();

	/**
	 * @param store - The engine's internal store.
	 * @param dispatcher - The engine's dispatcher (for replay).
	 * @param config - Devtools configuration.
	 * @param emitChange - Forwarded to {@link TimeTravel} so undo/redo/jumpTo emit a `'reset'`
	 *   `ChangeEvent` on the owning engine — the same channel dispatched actions use — keeping
	 *   every reactive surface in sync with a time-travel restore. Supplied by `FilterEngine`.
	 * @param beforeRestore - Forwarded to {@link TimeTravel} and {@link Replay}; called before a
	 *   restore or replay writes the store, so the owner can drop caches keyed on engine state
	 *   (`FilterEngine` clears its bitmap, exclusion-graph and simulation caches).
	 */
	constructor(
		store: InternalStore<T>,
		dispatcher: Dispatcher<T>,
		config: DevtoolsConfig = {},
		emitChange?: TimeTravelEmit,
		beforeRestore?: () => void,
	) {
		this.enabled = config.enabled ?? true;
		this._onError = config.onError;
		this.actionLog = new ActionLog(config.actionLogSize ?? 100);
		this.timeTravel = new TimeTravel(store, this.actionLog, emitChange, beforeRestore);
		this.replayer = new Replay(store, dispatcher, this.actionLog, emitChange, beforeRestore);
		this.reduxBridge =
			this.enabled && (config.bridgeToReduxDevtools ?? true)
				? new ReduxDevtoolsBridge(config.reduxDevtoolsName, (cause) => {
					this._report('DEVTOOLS_EXTENSION_FAILED', 'the Redux DevTools extension threw; it is disconnected', cause);
				})
				: null;
		this.persistence = this.enabled && config.persistence
			? new DevtoolsPersistence(config.persistence, (cause) => {
				this._report('DEVTOOLS_PERSISTENCE_FAILED', 'saving the action log failed', cause);
			})
			: null;
	}

	/**
	 * Settles once {@link Devtools.init} has finished loading the persisted action log (at once
	 * when there is no persistence). Await it before scrubbing to an earlier session's entries.
	 */
	get ready(): Promise<void> {
		return this._ready;
	}

	// ─── Time-travel passthrough ───────────────────────────────────────────

	get canRedo(): boolean {
		return this.timeTravel.canRedo;
	}

	get canUndo(): boolean {
		return this.timeTravel.canUndo;
	}

	get currentIndex(): number {
		return this.timeTravel.currentIndex;
	}

	jumpTo(index: number): void {
		this.timeTravel.jumpTo(index);
	}

	redo(): void {
		this.timeTravel.redo();
	}

	undo(): void {
		this.timeTravel.undo();
	}

	// ─── Diff passthrough ──────────────────────────────────────────────────

	/**
	 * Diff the state snapshots at two action-log positions.
	 *
	 * @param fromIndex - Earlier index
	 * @param toIndex - Later index
	 * @returns Array of state-diff edits, or empty array if either index is out of range
	 */
	diff(fromIndex: number, toIndex: number): readonly StateDiffEntry[] {
		const fromEntry = this.actionLog.get(fromIndex);
		const toEntry = this.actionLog.get(toIndex);

		if (!fromEntry || !toEntry) {
			return [];
		}

		return diff(fromEntry.nextStateSnapshot, toEntry.nextStateSnapshot);
	}

	// ─── Replay passthrough ────────────────────────────────────────────────

	replay(fromIndex: number, options?: ReplayOptions): void {
		this.replayer.replay(fromIndex, options);
	}

	// ─── Action recording (called by FilterEngine after every action) ─────

	/**
	 * Record an action with its pre/next snapshots. Appends to the action log, forwards to
	 * Redux DevTools (if connected), and schedules a debounced persistence write (if
	 * configured). Does nothing when {@link Devtools.enabled} is `false`.
	 */
	recordAction(
		action: Action,
		previousStateSnapshot: EngineSnapshot,
		nextStateSnapshot: EngineSnapshot,
		meta?: ActionLogEntryMeta,
	): void {
		if (!this.enabled) {
			return;
		}
		const entry: ActionLogEntry = {
			action,
			nextStateSnapshot,
			previousStateSnapshot,
			timestamp: Date.now(),
			...(meta && { meta }),
		};

		this.actionLog.append(entry);
		if (this.reduxBridge) {
			this._nextExtensionId++;
			this._extensionIds.set(entry, this._nextExtensionId);
			this.reduxBridge.recordAction(action, nextStateSnapshot);
		}
		this.persistence?.scheduleSave(this.actionLog.toArray());
	}

	/**
	 * Initialize devtools — called once by the `FilterEngine` constructor. Sends the initial
	 * state to the Redux DevTools extension and subscribes to its time-travel messages, then
	 * loads the persisted action log (if persistence is configured) ahead of this session's
	 * entries. A storage failure leaves the log with this session's entries only.
	 *
	 * @returns A promise that settles with {@link Devtools.ready}
	 */
	async init(initialSnapshot: EngineSnapshot | null): Promise<void> {
		this.reduxBridge?.init(initialSnapshot);
		this.reduxBridge?.subscribe((message) => {
			this._handleExtensionMessage(message);
		});
		// Assigned before the first `await`, so `ready` reflects the load as soon as `init` returns.
		this._ready = this._loadPersisted();
		await this._ready;
	}

	/**
	 * Tear down — flush pending persistence, disconnect from Redux DevTools. Called by
	 * `engine.destroy()`. A failed final save is reported, not thrown: teardown always completes.
	 */
	async destroy(): Promise<void> {
		await this._ready;
		try {
			await this.persistence?.flushNow(this.actionLog.toArray());
		} catch (error) {
			this._report('DEVTOOLS_PERSISTENCE_FAILED', 'saving the action log on destroy failed', error);
		}
		this.reduxBridge?.disconnect();
	}

	/**
	 * Load the persisted log ahead of this session's entries (see {@link Devtools.init}). Storage
	 * that fails (private mode, quota, a revoked IndexedDB) is reported and leaves this session's log.
	 */
	private async _loadPersisted(): Promise<void> {
		if (!this.persistence) {
			return;
		}
		try {
			this.actionLog.prepend(await this.persistence.load());
		} catch (error) {
			this._report('DEVTOOLS_PERSISTENCE_FAILED', 'loading the persisted action log failed', error);
		}
	}

	/**
	 * Hand a persistence or extension failure to `DevtoolsConfig.onError`, or warn once per code.
	 *
	 * @param code - Which side channel failed.
	 * @param what - What was being attempted, for the message.
	 * @param cause - The original failure.
	 */
	private _report(code: FilterEngineRuntimeErrorCode, what: string, cause: unknown): void {
		const error = new FilterEngineError(code, `devtools: ${what}. The engine is unaffected.`, { cause });

		if (this._onError !== undefined) {
			this._onError(error);
		} else if (!this._warnedCodes.has(code)) {
			this._warnedCodes.add(code);
			(globalThis as { console?: { warn?: (...args: unknown[]) => void }}).console?.warn?.(error);
		}
	}

	/**
	 * Route a Redux DevTools extension message. Scrubbing sends `DISPATCH` with a
	 * `JUMP_TO_STATE` / `JUMP_TO_ACTION` payload naming the extension's action number: 0 (the
	 * initial state) restores the state before the oldest retained entry, and any other number
	 * restores the entry it was sent with, if that entry is still in the log. Anything else is
	 * ignored. The restore is not echoed back to the extension.
	 */
	private _handleExtensionMessage(message: unknown): void {
		const { payload, type } = (message ?? {}) as { payload?: { actionId?: unknown; type?: unknown }; type?: unknown };
		const isJump = payload?.type === 'JUMP_TO_STATE' || payload?.type === 'JUMP_TO_ACTION';

		if (type !== 'DISPATCH' || !isJump || typeof payload.actionId !== 'number') {
			return;
		}
		const { actionId } = payload;

		if (actionId === 0) {
			this.timeTravel.jumpTo(-1);

			return;
		}
		const index = this.actionLog.toArray().findIndex((entry) => this._extensionIds.get(entry) === actionId);

		if (index !== -1) {
			this.timeTravel.jumpTo(index);
		}
	}
}
