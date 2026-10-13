/**
 * `DevtoolsPersistence` — cross-reload persistence of the action log via the engine's
 * `StorageAdapter`.
 *
 * @remarks
 * Per `docs/architecture.md` §10.7. Optional feature — only active when consumers pass a
 * `persistence` block to the engine config. Enables "I had it set up perfectly, then
 * refreshed by accident — let me scrub back to where I was yesterday."
 *
 * Two main responsibilities:
 *   1. **Load** the persisted action log when the engine starts (`Devtools.init`, called by the
 *      `FilterEngine` constructor). Loaded entries are placed before this session's entries, so
 *      `engine.devtools.jumpTo` / `undo` can reach the earlier session's states.
 *   2. **Save** the action log on changes, debounced to avoid storage thrash on rapid-fire
 *      toggling, and immediately on `engine.destroy()`.
 *
 * Entries are stored in their plain-JSON form (`snapshotCodec.ts`): rules through
 * `rule.serialize()`, revived through `ruleRegistry.deserialize()` — so any `StorageAdapter`
 * works, including `LocalStorageAdapter` (JSON) and `IndexedDBAdapter` (structured clone).
 * Entries that cannot be stored are skipped: data-replacing actions (`setSourceData`,
 * `setWorkingSet` — the items belong to the application) and entries holding a rule that cannot
 * serialize (`PredicateRule`). On load, entries that are malformed or name a rule type this
 * runtime has not registered are skipped too.
 *
 * @packageDocumentation
 */

import type { StorageAdapter } from '../storage/StorageAdapter.js';
import type { ActionLogEntry } from './ActionLog.js';

import { deserializeEntry, type SerializedActionLogEntry, serializeEntry } from './snapshotCodec.js';

// setTimeout/clearTimeout are host APIs (browser + Node + edge) but not in `lib.es2022.d.ts`.
// Declare the minimal contract inline to avoid pulling DOM/Node types into the isomorphic core.
// Handle is treated as opaque — we only pass it back to clearTimeout, never inspect it. The
// distinct (non-`unknown`) handle type keeps the `| null` union meaningful for the timer guard.
declare const TimeoutHandleBrand: unique symbol;
type TimeoutHandle = { readonly [TimeoutHandleBrand]: true };
declare const setTimeout: (callback: () => void, ms: number) => TimeoutHandle;
declare const clearTimeout: (handle: TimeoutHandle) => void;

/**
 * Configuration for `DevtoolsPersistence`.
 */
export interface DevtoolsPersistenceConfig {
	readonly adapter: StorageAdapter;
	readonly key: string;
	/** Maximum entries to persist (independent of in-memory `maxEntries`). Default 500. */
	readonly maxPersistedEntries?: number;
	/** Debounce window for save writes, in ms. Default 1000. */
	readonly debounceMs?: number;
}

// #region docs:persistence-load-save
/**
 * Persists + rehydrates the engine's action log across page reloads.
 */
export class DevtoolsPersistence {
	private readonly _adapter: StorageAdapter;
	private readonly _debounceMs: number;
	private readonly _key: string;
	private readonly _maxPersistedEntries: number;
	private readonly _onSaveFailure: (cause: unknown) => void;
	private _saveTimeoutId: TimeoutHandle | null = null;

	/**
	 * @param config - Where and how much to persist.
	 * @param onSaveFailure - Receives a debounced save's failure, which has no caller to reject to.
	 */
	constructor(config: DevtoolsPersistenceConfig, onSaveFailure: (cause: unknown) => void = () => undefined) {
		this._onSaveFailure = onSaveFailure;
		this._adapter = config.adapter;
		this._key = config.key;
		this._maxPersistedEntries = config.maxPersistedEntries ?? 500;
		this._debounceMs = config.debounceMs ?? 1000;
	}

	/**
	 * Load the persisted action log, with every rule revived through the rule registry. Returns
	 * an empty array if storage is empty or malformed; skips individual entries that cannot be
	 * revived.
	 */
	async load(): Promise<readonly ActionLogEntry[]> {
		const raw = await this._adapter.load(this._key);

		if (!raw || typeof raw !== 'object') {
			return [];
		}
		const entries = (raw as { entries?: unknown }).entries;

		if (!Array.isArray(entries)) {
			return [];
		}
		const revived: ActionLogEntry[] = [];

		for (const json of entries) {
			const entry = deserializeEntry(json);

			if (entry !== null) {
				revived.push(entry);
			}
		}

		return revived;
	}

	/**
	 * Schedule a debounced save of the action log. Multiple calls within `debounceMs` collapse
	 * into a single write; a failed write goes to `onSaveFailure`.
	 */
	scheduleSave(entries: readonly ActionLogEntry[]): void {
		if (this._saveTimeoutId !== null) {
			clearTimeout(this._saveTimeoutId);
		}
		this._saveTimeoutId = setTimeout(() => {
			this._saveTimeoutId = null;
			this.flushNow(entries).catch(this._onSaveFailure);
		}, this._debounceMs);
	}

	/**
	 * Save the action log immediately, bypassing the debounce. Used on engine destroy /
	 * page-unload to ensure no in-flight writes are lost.
	 */
	async flushNow(entries: readonly ActionLogEntry[]): Promise<void> {
		if (this._saveTimeoutId !== null) {
			clearTimeout(this._saveTimeoutId);
			this._saveTimeoutId = null;
		}
		const encoded: SerializedActionLogEntry[] = [];

		for (const entry of entries) {
			const json = serializeEntry(entry);

			if (json !== null) {
				encoded.push(json);
			}
		}

		await this._adapter.save(this._key, { entries: encoded.slice(-this._maxPersistedEntries) });
	}
	// #endregion docs:persistence-load-save

	/** Wipe the persisted action log. */
	async clear(): Promise<void> {
		await this._adapter.remove(this._key);
	}
}
