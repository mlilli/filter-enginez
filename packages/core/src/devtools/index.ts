/**
 * Barrel export for the devtools layer.
 *
 * @remarks
 * The `Devtools` coordinator is the public API surface (consumers access via
 * `engine.devtools.*`). Underlying modules (`ActionLog`, `TimeTravel`, etc.) are exposed
 * for advanced use cases and for the reactive-adapter packages that lift devtools events
 * into signals / observables.
 *
 * @packageDocumentation
 */

export { Devtools, type DevtoolsConfig } from './Devtools.js';
export { ActionLog, type ActionLogEntry, type ActionLogEntryMeta } from './ActionLog.js';
export { TimeTravel } from './TimeTravel.js';
export { diff, type StateDiffEntry } from './Diff.js';
export { Replay, type ReplayOptions } from './Replay.js';
export { ReduxDevtoolsBridge } from './ReduxDevtoolsBridge.js';
export {
	DevtoolsPersistence,
	type DevtoolsPersistenceConfig,
} from './DevtoolsPersistence.js';
