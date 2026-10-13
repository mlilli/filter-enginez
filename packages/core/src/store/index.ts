/**
 * Barrel export for the internal store layer.
 *
 * @remarks
 * The store classes are part of the engine's internals — most consumers interact with them
 * only indirectly via `engine.results`, `engine.activeRuleIds`, etc. The types (`Action`,
 * `EngineSnapshot`, `EngineMode`) ARE part of the public API surface (used by the devtools
 * API and the change-event union).
 *
 * @packageDocumentation
 */

export type { Action, ActionType } from './Action.js';
export type { EngineSnapshot } from './snapshots.js';
export { captureSnapshot, restoreSnapshot } from './snapshots.js';
export { type EngineMode, InternalStore } from './InternalStore.js';
export { Dispatcher } from './Dispatcher.js';
