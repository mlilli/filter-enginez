/**
 * Browser-only `StorageAdapter` implementations.
 *
 * @remarks
 * Exported from `@filter-enginez/core/storage/browser` (see `packages/core/package.json`
 * `exports` map). Consumers explicitly opt in via the sub-path import — keeps the default
 * core entry isomorphic.
 *
 * Ships `LocalStorageAdapter`, `SessionStorageAdapter`, and `IndexedDBAdapter` — the last for
 * power users needing more than localStorage's 5-10MB storage capacity, typically for long-lived
 * devtools snapshot persistence accumulating across many sessions.
 *
 * @example
 *   import { LocalStorageAdapter } from '@filter-enginez/core/storage/browser';
 *
 * @packageDocumentation
 */

export { LocalStorageAdapter } from './LocalStorageAdapter.js';
export { SessionStorageAdapter } from './SessionStorageAdapter.js';
export { IndexedDBAdapter } from './IndexedDBAdapter.js';
