/**
 * Barrel export for the storage layer.
 *
 * @remarks
 * Browser-only adapters live in the `./browser` sub-export
 * (`@filter-enginez/core/storage/browser`) to keep the default entry point isomorphic. See
 * `docs/architecture.md` §16 for the full storage strategy.
 *
 * @packageDocumentation
 */

export type { StorageAdapter } from './StorageAdapter.js';
export { MemoryStorageAdapter } from './MemoryStorageAdapter.js';
