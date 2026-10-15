/**
 * Wire-format helpers for the worker bridge — convert worker-side engine objects into
 * postMessage-safe shapes before they cross the Comlink boundary.
 *
 * @remarks
 * Extracted from `WorkerHostedEngine.ts` to keep that module under the file-size cap. These
 * functions own the "serialize / strip the non-cloneable bits" responsibility:
 *
 *   - `toWireEvent` — serializes rule instances + strips heavy before/after arrays out of
 *     `ChangeEvent`s.
 *   - `toWireActionLogEntry` / `deriveWireEntryCore` — flatten an `ActionLogEntry` into a thin
 *     `WireActionLogEntry` summary (no snapshots, no rule instances).
 *   - `summarizeRuleConfig` — cheap one-line config readout for the devtools "args" column.
 *
 * @packageDocumentation
 */

import {
	type ActionLogEntry,
	type ChangeEvent,
	type CompositeRule,
	type FilterRule,
	getRuleTypeName,
} from '@filter-enginez/core';

import type { WireActionLogEntry } from './FilterEngineAsync.js';

/**
 * Convert a `ChangeEvent` from the worker-side engine into a postMessage-safe shape for the
 * main-thread listener.
 *
 * @remarks
 * The raw `ChangeEvent` shape carries data the structuredClone postMessage protocol can't
 * handle:
 *
 *   - **`rule:added` / `rule:removed` / `rule:changed`** — the event payload references
 *     `FilterRule` instances whose `action` field is a function (and which may also carry
 *     non-cloneable internals like a `Fuse` index). Functions can't structuredClone, hence
 *     the original `DataCloneError`. We serialize each instance via `rule.serialize()` here,
 *     casting the result back into the field's nominal type — the main-thread adapter knows
 *     to call `ruleRegistry.deserialize` before exposing the value to consumers reading
 *     `lastChangeEvent.value`.
 *   - **`expression`** — same story: `CompositeRule` is a `FilterRule` subclass; serialize.
 *   - **`sourceData` / `workingSet` / `results`** — the `previous` and `next` arrays can be
 *     150k items each on the wine full tier. Even if they're plain-cloneable, shipping them
 *     across the wire on every event would be enormously wasteful (the adapter already
 *     mirrors source/result state via its own dedicated getter dance). We strip these into
 *     empty arrays — consumers needing the actual contents should read the adapter's signals
 *     (sourceData / workingSet / results) directly.
 *
 * @internal
 */
export function toWireEvent(event: ChangeEvent): ChangeEvent {
	switch (event.type) {
		case 'expression':
			return {
				next: event.next === null
					? null
					: (event.next.serialize() as unknown as CompositeRule),
				previous: event.previous === null
					? null
					: (event.previous.serialize() as unknown as CompositeRule),
				type: 'expression',
			};
		case 'reset':
			return event;
		case 'results':
		case 'sourceData':
		case 'workingSet':
			// Strip the heavy before/after arrays — adapter has its own mirror. Empty arrays
			// satisfy the declared `readonly unknown[]` type; consumers reading these fields
			// from `lastChangeEvent` should pull current state from the adapter's signals
			// instead (sourceData / workingSet / results).
			return { next: [], previous: [], type: event.type };
		case 'rule:added':
		case 'rule:removed':
			return {
				rule: event.rule.serialize() as unknown as FilterRule,
				ruleId: event.ruleId,
				type: event.type,
			};
		case 'rule:changed':
			return {
				next: event.next.serialize() as unknown as FilterRule,
				previous: event.previous.serialize() as unknown as FilterRule,
				ruleId: event.ruleId,
				type: 'rule:changed',
			};
		default:
			// Exhaustiveness check — TypeScript narrows `event` to `never` here when all cases
			// are handled. Cast to satisfy the structural return type if a new event type ever
			// lands without an explicit wire mapping.
			return event;
	}
}

/**
 * The discriminating, payload-derived fields for one wire log entry — everything that varies
 * per action type. The common base (timestamp / source) is assembled by `toWireActionLogEntry`.
 *
 * @internal
 */
interface WireEntryCore {
	readonly groupId?: string;
	readonly ruleId?: string;
	readonly ruleType?: string;
	readonly summary: string;
	readonly type: string;
}

/**
 * Derive the per-action-type discriminating fields (summary + optional ids) for a log entry.
 * Split out from `toWireActionLogEntry` to keep that assembler's cyclomatic complexity low —
 * this function owns the action-type switch; the caller owns the shared base + source spread.
 *
 * @internal
 */
function deriveWireEntryCore(action: ActionLogEntry['action']): WireEntryCore {
	switch (action.type) {
		case 'EXPRESSION_SET':
			return {
				summary: action.payload.expression === null ? 'cleared expression' : 'set expression',
				type: action.type,
			};
		case 'GROUP_ADDED':
			return {
				groupId: action.payload.group.id,
				summary: `added group <${action.payload.group.id}>`,
				type: action.type,
			};
		case 'GROUP_REMOVED':
			return {
				groupId: action.payload.groupId,
				summary: `removed group <${action.payload.groupId}>`,
				type: action.type,
			};
		case 'RESET':
			return { summary: 'reset engine', type: action.type };
		case 'RULE_ADDED':
		case 'RULE_CHANGED': {
			const rule = action.payload.rule;
			// NOT `rule.constructor.name` — a minifier rewrites it, so a production build would show
			// `d <price>` instead of `RangeRule <price>` in the devtools "args" column. Same constraint
			// as `serialize()`'s wire name; `getRuleTypeName` is the one source for both.
			const ruleType = getRuleTypeName(rule);

			return {
				ruleId: action.payload.ruleId,
				ruleType,
				summary: `${ruleType} <${action.payload.ruleId}>${summarizeRuleConfig(rule)}`,
				type: action.type,
			};
		}
		case 'RULE_REMOVED':
			return {
				ruleId: action.payload.ruleId,
				summary: `removed <${action.payload.ruleId}>`,
				type: action.type,
			};
		case 'RULES_CLEARED':
			return { summary: 'cleared all rules', type: action.type };
		case 'SOURCE_DATA_SET':
			return {
				summary: `setSourceData (${action.payload.items.length} items)`,
				type: action.type,
			};
		case 'WORKING_SET_RESET':
			return { summary: 'reset working set to source data', type: action.type };
		case 'WORKING_SET_SET':
			return {
				summary: `setWorkingSet (${action.payload.items.length} items)`,
				type: action.type,
			};
		default: {
			// Exhaustiveness check — TypeScript narrows `action` to `never` here. If a new action
			// type lands, this branch surfaces it at compile time.
			const exhaustive: never = action;

			return { summary: String(exhaustive), type: 'unknown' };
		}
	}
}

/**
 * Convert a worker-side `ActionLogEntry` into a postMessage-safe `WireActionLogEntry`.
 *
 * @remarks
 * Strips the heavy bits:
 *
 *   - `previousStateSnapshot` and `nextStateSnapshot` — full `EngineSnapshot` blobs that
 *     can include the entire sourceData mirror. Stay on the worker; time-travel uses them
 *     via `jumpToDevtoolsIndex` without crossing the boundary.
 *   - The action's `payload.rule` / `payload.expression` — FilterRule instances with
 *     function fields. We extract the ruleId + class name + a human summary string and
 *     drop the rest.
 *
 * The summary line is rendered as the `args` column in the devtools panel — short, scannable,
 * mono-spaced. For rule mutations it includes the rule's class and a brief config readout.
 *
 * @internal
 */
export function toWireActionLogEntry(entry: ActionLogEntry): WireActionLogEntry {
	const source = entry.meta?.source;
	const core = deriveWireEntryCore(entry.action);

	return {
		...core,
		timestamp: entry.timestamp,
		...(source !== undefined && { source }),
	};
}

/**
 * Cheap one-line config summary for a FilterRule instance. Used by `toWireActionLogEntry` to
 * give devtools rows a meaningful "args" column without shipping the full rule instance.
 *
 * @internal
 */
function summarizeRuleConfig(rule: FilterRule): string {
	const cfg = (rule as unknown as { config?: unknown }).config;

	if (cfg === null || cfg === undefined) {
		return '';
	}
	if (typeof cfg === 'string') {
		return ` = ${cfg}`;
	}
	if (typeof cfg === 'number' || typeof cfg === 'boolean' || typeof cfg === 'bigint') {
		return ` = ${String(cfg)}`;
	}
	if (typeof cfg !== 'object') {
		// Functions / symbols — no useful single-line summary.
		return '';
	}
	const obj = cfg as Record<string, unknown>;

	// Try the most common shapes in order — range, inSet, hierarchical, text/fuzzy queries.
	if (typeof obj['min'] === 'number' && 'max' in obj) {
		const max = obj['max'];
		const maxStr = typeof max === 'number' && Number.isFinite(max) ? String(max) : '∞';

		return ` [${String(obj['min'])}, ${maxStr}]`;
	}
	if (Array.isArray(obj['set'])) {
		const set = obj['set'] as readonly unknown[];

		if (set.length === 0) {
			return ' { }';
		}
		if (set.length <= 2) {
			return ` { ${set.map(String).join(', ')} }`;
		}

		return ` { ${String(set[0])}, +${set.length - 1} more }`;
	}
	if (Array.isArray(obj['selected'])) {
		const sel = obj['selected'] as readonly unknown[];

		if (sel.length === 0) {
			return ' (no selection)';
		}

		return ` (${sel.length} selected)`;
	}
	if (typeof obj['query'] === 'string') {
		const q = obj['query'].trim();

		return q === '' ? ' (empty)' : ` "${q.length > 24 ? `${q.slice(0, 24)}…` : q}"`;
	}

	return '';
}
